// Command activity-server serves the embedded Botge Activity through Discord's proxy.
package main

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/MrewyOrg/Botge/activity/server/internal/origin"
	"github.com/MrewyOrg/Botge/activity/server/internal/site"
)

// run validates configuration and loads the site before binding on all interfaces.
func run(ctx context.Context, getenv func(string) string,
	listen func(context.Context, string, string) (net.Listener, error), files fs.FS,
	logger *slog.Logger,
) error {
	port, err := strconv.ParseUint(getenv("PORT"), 10, 16)
	if err != nil || port == 0 {
		return errors.New("PORT must be a decimal integer between 1 and 65535")
	}
	publicKey := getenv("DISCORD_ACTIVITY_PUBLIC_KEY")
	handler, err := origin.NewHandler(files, publicKey, time.Now, logger)
	if err != nil {
		return fmt.Errorf("prepare activity origin: %w", err)
	}
	listener, err := listen(ctx, "tcp", ":"+strconv.FormatUint(port, 10))
	if err != nil {
		return fmt.Errorf("open activity listener: %w", err)
	}
	return origin.Serve(ctx, listener, handler)
}

// exitCode logs a startup or listener failure and selects the process status.
func exitCode(err error, logger *slog.Logger) int {
	if err != nil {
		logger.Error("activity server stopped", "error", err)
		return 1
	}
	return 0
}

// main connects the server lifecycle to process signals and reports its exit code.
func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	logger := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	var listen net.ListenConfig
	code := exitCode(run(ctx, os.Getenv, listen.Listen, site.Files(), logger), logger)
	stop()
	os.Exit(code)
}
