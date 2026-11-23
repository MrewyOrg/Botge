package origin

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"sync"
	"testing"
	"time"
)

// listenLocally opens a test-only listener on a port allocated by the OS.
func listenLocally(t *testing.T) net.Listener {
	t.Helper()
	var config net.ListenConfig
	listener, err := config.Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	return listener
}

func TestServeAndShutdown(t *testing.T) {
	listener := listenLocally(t)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	handler := testHandler(t, io.Discard)
	done := make(chan error, 1)
	go func() { done <- Serve(ctx, listener, handler) }()
	// Give each request its own connection so parallel dials cannot leave idle sockets behind.
	transport := &http.Transport{DisableCompression: true, DisableKeepAlives: true}
	defer transport.CloseIdleConnections()
	client := &http.Client{Timeout: time.Second, Transport: transport}
	var requests sync.WaitGroup
	for range 8 {
		requests.Go(func() {
			address := "http://" + listener.Addr().String() + "/"
			request, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
			if err != nil {
				t.Error(err)
				return
			}
			request.Header = signedHeaders()
			response, err := client.Do(request)
			if err != nil {
				t.Error(err)
				return
			}
			body, readErr := io.ReadAll(response.Body)
			closeErr := response.Body.Close()
			if err := errors.Join(readErr, closeErr); err != nil {
				t.Error(err)
				return
			}
			const wantBody = "<html>Activity</html>"
			if response.StatusCode != http.StatusOK || string(body) != wantBody {
				t.Errorf("GET / returned %d with %q, want 200 with %q",
					response.StatusCode, body, wantBody)
			}
		})
	}
	requests.Wait()
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestListenerFailure(t *testing.T) {
	listener := listenLocally(t)
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	if err := Serve(t.Context(), listener, http.NotFoundHandler()); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("Serve returned %v, want net.ErrClosed", err)
	}
}

func TestShutdownDeadline(t *testing.T) {
	listener := listenLocally(t)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	entered := make(chan struct{})
	release := make(chan struct{})
	defer close(release)
	handler := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		close(entered)
		<-release
	})
	done := make(chan error, 1)
	go func() { done <- serve(ctx, listener, handler, 10*time.Millisecond) }()
	client := &http.Client{Timeout: time.Second}
	address := "http://" + listener.Addr().String()
	request, err := http.NewRequestWithContext(t.Context(), http.MethodGet, address, nil)
	if err != nil {
		t.Fatal(err)
	}
	var requestDone sync.WaitGroup
	requestDone.Go(func() {
		response, err := client.Do(request)
		if err == nil {
			if err := response.Body.Close(); err != nil {
				t.Error(err)
			}
		}
	})
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("test request never reached the server")
	}
	cancel()
	if err := <-done; !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("serve returned %v on shutdown, want context.DeadlineExceeded", err)
	}
	requestDone.Wait()
}
