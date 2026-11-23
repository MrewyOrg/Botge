package origin

import (
	"context"
	"errors"
	"net"
	"net/http"
	"time"
)

// Serve takes ownership of listener and handles HTTP traffic until it fails or ctx is canceled.
// It gives active requests five seconds to finish and returns any listener or shutdown error.
func Serve(ctx context.Context, listener net.Listener, handler http.Handler) error {
	return serve(ctx, listener, handler, 5*time.Second)
}

// serve uses an injectable shutdown budget for testing stalled requests.
func serve(ctx context.Context, listener net.Listener, handler http.Handler,
	shutdownBudget time.Duration,
) error {
	server := http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	finished := make(chan error, 1)
	go func() { finished <- server.Serve(listener) }()
	select {
	case err := <-finished:
		return listenResult(err)
	case <-ctx.Done():
		// Give requests a fresh deadline after the process context has been canceled.
		shutdown, cancel := context.WithTimeout(context.WithoutCancel(ctx), shutdownBudget)
		defer cancel()
		err := server.Shutdown(shutdown)
		return errors.Join(err, server.Close(), listenResult(<-finished))
	}
}

// listenResult treats the standard shutdown result as a successful exit.
func listenResult(err error) error {
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}
