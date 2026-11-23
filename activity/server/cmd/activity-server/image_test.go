package main

import (
	"context"
	"crypto/ed25519"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// TestActivityImage runs the production image built from the same source as the staged assets.
func TestActivityImage(t *testing.T) {
	image := os.Getenv("BOTGE_ACTIVITY_IMAGE")
	if image == "" {
		t.Skip("set BOTGE_ACTIVITY_IMAGE to a locally built Activity origin image")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	if user := dockerOutput(ctx, t, "image", "inspect", "--format", "{{.Config.User}}",
		"--", image); user != "65532:65532" {
		t.Fatalf("image user = %q, want 65532:65532", user)
	}
	invalid := exec.CommandContext(ctx, "docker", "run", "--rm", "--pull=never",
		"--platform=linux/amd64", "--env", "DISCORD_ACTIVITY_PUBLIC_KEY=", "--", image)
	var failed *exec.ExitError
	if output, err := invalid.CombinedOutput(); !errors.As(err, &failed) || failed.ExitCode() != 1 {
		t.Fatalf("startup without a public key: want exit 1, got %v\n%s", err, output)
	}

	key := ed25519.NewKeyFromSeed(make([]byte, ed25519.SeedSize))
	container := dockerOutput(ctx, t, "create", "--pull=never", "--platform=linux/amd64",
		"--read-only", "--publish", "127.0.0.1::8080",
		"--env", "DISCORD_ACTIVITY_PUBLIC_KEY="+publicHex(key), "--", image)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if output, err := exec.CommandContext(ctx, "docker", "rm", "-f", container).
			CombinedOutput(); err != nil {
			t.Errorf("remove activity test container: %v\n%s", err, output)
		}
	})
	dockerOutput(ctx, t, "start", container)
	address := "http://" + dockerOutput(ctx, t, "port", container, "8080/tcp")
	transport := &http.Transport{DisableCompression: true}
	defer transport.CloseIdleConnections()
	client := &http.Client{Timeout: time.Second, Transport: transport}
	waitForHealth(t, client, address)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address+"/", nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	if err := response.Body.Close(); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unsigned GET / = %d, want 401", response.StatusCode)
	}
	assertEmbeddedFiles(t, client, address, key)
	dockerOutput(ctx, t, "stop", "--time", "5", container)
	if status := dockerOutput(ctx, t, "wait", container); status != "0" {
		t.Fatalf("container exit after SIGTERM = %s, want 0", status)
	}
}

// dockerOutput runs a test container command and reports failures at the caller.
func dockerOutput(ctx context.Context, t *testing.T, args ...string) string {
	t.Helper()
	output, err := exec.CommandContext(ctx, "docker", args...).CombinedOutput()
	if err != nil {
		t.Fatalf("docker %s: %v\n%s", args[0], err, output)
	}
	return strings.TrimSpace(string(output))
}
