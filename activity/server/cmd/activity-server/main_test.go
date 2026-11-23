package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"syscall"
	"testing"
	"testing/fstest"
	"time"

	"github.com/MrewyOrg/Botge/activity/server/internal/site"
)

// publicHex encodes the public half of a synthetic signing key for server configuration.
func publicHex(key ed25519.PrivateKey) string {
	return hex.EncodeToString(key[ed25519.SeedSize:])
}

func TestStartupConfiguration(t *testing.T) {
	key := publicHex(ed25519.NewKeyFromSeed(make([]byte, ed25519.SeedSize)))
	logger := slog.New(slog.DiscardHandler)
	refused := errors.New("listen refused")
	for _, row := range []struct {
		name, port, key string
		files           fs.FS
		listen          bool
	}{
		{"missing port", "", key, fstest.MapFS{}, false},
		{"zero port", "0", key, fstest.MapFS{}, false},
		{"out of range port", "65536", key, fstest.MapFS{}, false},
		{"signed port", "+1", key, fstest.MapFS{}, false},
		{"invalid key", "8080", "invalid", site.Files(), false},
		{"missing site", "8080", key, fstest.MapFS{}, false},
		{"listener refusal", "8080", key, site.Files(), true},
	} {
		t.Run(row.name, func(t *testing.T) {
			ctx := t.Context()
			values := map[string]string{"PORT": row.port, "DISCORD_ACTIVITY_PUBLIC_KEY": row.key}
			called := false
			listen := func(gotCtx context.Context, network, address string) (net.Listener, error) {
				called = true
				if gotCtx != ctx {
					t.Error("listener did not receive the startup context")
				}
				if network != "tcp" || address != ":8080" {
					t.Errorf("listen(%q, %q), want tcp and :8080", network, address)
				}
				return nil, refused
			}
			getenv := func(name string) string { return values[name] }
			err := run(ctx, getenv, listen, row.files, logger)
			if called != row.listen {
				t.Errorf("listener called = %t, want %t", called, row.listen)
			}
			if err == nil {
				t.Error("run returned nil, want a startup error")
			}
			if row.listen && !errors.Is(err, refused) {
				t.Errorf("run returned %v, want wrapped listener refusal", err)
			}
		})
	}
}

func TestEmbeddedBinary(t *testing.T) {
	work := t.TempDir()
	binary := filepath.Join(work, "activity-server")
	coverage := os.Getenv("BOTGE_GO_COVERDIR")
	if coverage == "" {
		coverage = t.TempDir()
	}
	build := exec.CommandContext(t.Context(), "go", "build", "-mod=readonly", "-race", "-cover",
		"-covermode=atomic", "-coverpkg=./...", "-o", binary, "./cmd/activity-server")
	build.Dir = "../.."
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build activity server: %v\n%s", err, output)
	}
	key := ed25519.NewKeyFromSeed(make([]byte, ed25519.SeedSize))
	env := append(os.Environ(),
		"DISCORD_ACTIVITY_PUBLIC_KEY="+publicHex(key), "GOCOVERDIR="+coverage,
	)
	invalid := exec.CommandContext(t.Context(), binary)
	invalid.Env = append(slices.Clone(env), "PORT=0")
	var failed *exec.ExitError
	if _, err := invalid.Output(); !errors.As(err, &failed) || failed.ExitCode() != 1 {
		t.Fatalf("invalid config returned %v", err)
	}

	port := loopbackPort(t)
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	process := exec.CommandContext(ctx, binary)
	process.Env = append(slices.Clone(env), "PORT="+port)
	if err := process.Start(); err != nil {
		t.Fatal(err)
	}
	exited := make(chan error, 1)
	go func() { exited <- process.Wait() }()

	transport := &http.Transport{DisableCompression: true}
	defer transport.CloseIdleConnections()
	client := &http.Client{Timeout: time.Second, Transport: transport}
	address := "http://127.0.0.1:" + port
	waitForHealth(t, client, address)
	assertEmbeddedFiles(t, client, address, key)
	if err := process.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-exited:
		if err != nil {
			t.Fatalf("shutdown failed: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("process did not shut down")
	}
}

// loopbackPort asks the OS for a free port to pass to the test subprocess.
func loopbackPort(t *testing.T) string {
	t.Helper()
	var config net.ListenConfig
	listener, err := config.Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	_, port, err := net.SplitHostPort(listener.Addr().String())
	if err := errors.Join(err, listener.Close()); err != nil {
		t.Fatal(err)
	}
	return port
}

// waitForHealth polls the local origin until it starts responding or the probe times out.
func waitForHealth(t *testing.T, client *http.Client, address string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address+"/healthz", nil)
	if err != nil {
		t.Fatal(err)
	}
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	for {
		response, err := client.Do(request)
		if err == nil {
			if err := response.Body.Close(); err != nil {
				t.Fatal(err)
			}
			if response.StatusCode == http.StatusNoContent {
				return
			}
		}
		select {
		case <-ctx.Done():
			t.Fatalf("GET /healthz did not return %d before the deadline", http.StatusNoContent)
		case <-ticker.C:
		}
	}
}

// assertEmbeddedFiles compares each signed response with the staged identity representation.
func assertEmbeddedFiles(
	t *testing.T, client *http.Client, address string, key ed25519.PrivateKey,
) {
	t.Helper()
	files := site.Files()
	manifest, err := fs.ReadFile(files, "dist/manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	var paths map[string]json.RawMessage
	if err := json.Unmarshal(manifest, &paths); err != nil {
		t.Fatal(err)
	}
	paths[""] = paths["index.html"]
	for path := range paths {
		name := path
		if name == "" {
			name = "index.html"
		}
		expected, err := fs.ReadFile(files, "dist/identity/"+name)
		if err != nil {
			t.Fatal(err)
		}
		target := address + "/" + path
		request, err := http.NewRequestWithContext(t.Context(), http.MethodGet, target, nil)
		if err != nil {
			t.Fatal(err)
		}
		stamp := time.Now().Unix()
		payload, err := json.Marshal(map[string]int64{
			"created_at": stamp, "expires_at": stamp + 60,
		})
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("X-Signature-Ed25519", hex.EncodeToString(ed25519.Sign(key, payload)))
		request.Header.Set("X-Discord-Proxy-Payload", base64.RawURLEncoding.EncodeToString(payload))
		request.Header.Set("X-Signature-Timestamp", strconv.FormatInt(stamp, 10))
		response, err := client.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		actual, readErr := io.ReadAll(response.Body)
		if err := errors.Join(readErr, response.Body.Close()); err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != http.StatusOK {
			t.Errorf("GET /%s returned status %d, want %d",
				path, response.StatusCode, http.StatusOK)
		}
		if !bytes.Equal(actual, expected) {
			t.Errorf("GET /%s body differs from staged asset (%d bytes, want %d)",
				path, len(actual), len(expected))
		}
	}
}
