// Package origin authenticates and serves the embedded Discord Activity.
package origin

import (
	"crypto/ed25519"
	"io/fs"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// contentSecurityPolicy restricts Activity HTML to the origin and inline image data.
const contentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self'; " +
	"img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; " +
	"form-action 'none'"

// handler serves an immutable site and verifies Discord's signature on each content request.
type handler struct {
	assets map[string]asset  // assets is the exact public path inventory.
	key    ed25519.PublicKey // key verifies Discord proxy claims.
	now    func() time.Time  // now supplies the authentication clock.
	logger *slog.Logger      // logger records request metadata without request contents.
}

// NewHandler validates the site and public key before the caller opens a listener.
// The handler uses now to check proof freshness and logger to record sanitized request metadata.
func NewHandler(files fs.FS, publicKey string, now func() time.Time,
	logger *slog.Logger,
) (http.Handler, error) {
	key, err := parsePublicKey(publicKey)
	if err != nil {
		return nil, err
	}
	assets, err := loadAssets(files)
	if err != nil {
		return nil, err
	}
	return &handler{assets: assets, key: key, now: now, logger: logger}, nil
}

// requestPath accepts only literal origin-form paths, including the health route.
func requestPath(target *url.URL) string {
	if target.IsAbs() || target.EscapedPath() != target.Path {
		return ""
	}
	return target.Path
}

// ServeHTTP applies response headers and logs the status and transferred byte count.
func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	headers := w.Header()
	headers.Set("X-Content-Type-Options", "nosniff")
	headers.Set("Referrer-Policy", "no-referrer")
	headers.Set("Cache-Control", "no-store")
	class, status, body := h.response(headers, r)
	w.WriteHeader(status)
	var size int
	if r.Method != http.MethodHead && len(body) != 0 {
		var err error
		size, err = w.Write(body)
		if err != nil {
			h.logger.WarnContext(r.Context(), "activity response interrupted")
		}
	}
	h.logger.LogAttrs(r.Context(), slog.LevelInfo, "activity request",
		slog.String("route", class), slog.Int("status", status),
		slog.Duration("duration", time.Since(start)), slog.Int("bytes", size))
}

// response verifies proof before consulting the asset inventory or conditional headers.
func (h *handler) response(headers http.Header, r *http.Request) (string, int, []byte) {
	path := requestPath(r.URL)
	methodAllowed := r.Method == http.MethodGet || r.Method == http.MethodHead
	if path == "/healthz" {
		if !methodAllowed {
			headers.Set("Allow", "GET, HEAD")
			return "health", http.StatusMethodNotAllowed, nil
		}
		return "health", http.StatusNoContent, nil
	}
	if !authenticated(h.key, r.Header, h.now().Unix()) {
		return "unauthenticated", http.StatusUnauthorized, nil
	}
	if !methodAllowed {
		headers.Set("Allow", "GET, HEAD")
		return "content", http.StatusMethodNotAllowed, nil
	}
	entry, found := h.assets[path]
	if !found {
		return "missing", http.StatusNotFound, nil
	}
	status, body := assetResponse(headers, r.Header, entry)
	return "content", status, body
}

// assetResponse selects a representation and applies its cache policy and validator.
func assetResponse(headers, request http.Header, entry asset) (int, []byte) {
	headers.Set("Vary", "Accept-Encoding")
	coding := chooseEncoding(request.Values("Accept-Encoding"), entry.variants)
	if coding == "" {
		return http.StatusNotAcceptable, nil
	}
	selected := entry.variants[coding]
	headers.Set("Content-Type", entry.mime)
	if strings.HasPrefix(entry.mime, "text/html") {
		headers.Set("Content-Security-Policy", contentSecurityPolicy)
	} else if entry.fingerprinted {
		headers.Set("Cache-Control", "private, max-age=31536000, immutable")
	}
	headers.Set("ETag", selected.etag)
	if notModified(request.Values("If-None-Match"), selected.etag) {
		return http.StatusNotModified, nil
	}
	if coding != identity {
		headers.Set("Content-Encoding", string(coding))
	}
	headers.Set("Content-Length", strconv.Itoa(len(selected.body)))
	return http.StatusOK, selected.body
}
