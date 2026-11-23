package origin

import (
	"bytes"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

const scriptPath = "/assets/app-abcdefgh.js"

// testHandler builds the sample origin with a fixed clock and a caller-owned log sink.
func testHandler(t *testing.T, log io.Writer) http.Handler {
	t.Helper()
	handler, err := NewHandler(fixtureSite(), fixturePublicKey(), func() time.Time {
		return time.Unix(fixtureNow, 0)
	}, slog.New(slog.NewJSONHandler(log, nil)))
	if err != nil {
		t.Fatal(err)
	}
	return handler
}

func TestStartupValidation(t *testing.T) {
	logger := slog.New(slog.DiscardHandler)
	if _, err := NewHandler(fixtureSite(), "invalid", time.Now, logger); err == nil {
		t.Fatal("accepted invalid public key")
	}
	if _, err := NewHandler(fstest.MapFS{}, fixturePublicKey(), time.Now, logger); err == nil {
		t.Fatal("accepted invalid staged site")
	}
}

func TestRouteOrder(t *testing.T) {
	handler := testHandler(t, io.Discard)
	for _, row := range []struct {
		method, path string
		signed       bool
		code         int
	}{
		{"GET", "/healthz", false, 204},
		{"HEAD", "/healthz", false, 204},
		{"POST", "/healthz", false, 405},
		{"GET", "/%68ealthz", false, 401},
		{"GET", "/healthz/", true, 404},
		{"GET", "/missing", false, 401},
		{"POST", "/", false, 401},
		{"POST", "/missing", true, 405},
		{"HEAD", "/catalog.json", false, 401},
		{"GET", "/index.html", false, 401},
		{"GET", scriptPath, false, 401},
		{"GET", scriptPath + ".br", false, 401},
		{"GET", scriptPath + ".br", true, 404},
		{"GET", "/dist/manifest.json", true, 404},
		{"GET", "/assets/", true, 404},
		{"GET", "/assets//app-abcdefgh.js", true, 404},
		{"GET", "/assets%2Fapp-abcdefgh.js", true, 404},
		{"GET", "/assets/%61pp-abcdefgh.js", true, 404},
		{"GET", "/assets/../index.html", true, 404},
		{"GET", "/%2e/index.html", true, 404},
		{"GET", "http://example.test/index.html", true, 404},
	} {
		request := httptest.NewRequestWithContext(t.Context(), row.method, row.path, nil)
		if row.signed {
			request.Header = signedHeaders()
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != row.code || response.Body.Len() != 0 {
			t.Errorf("%s %s returned %d with %d bytes, want %d with no body",
				row.method, row.path, response.Code, response.Body.Len(), row.code)
		}
		for name, want := range map[string]string{
			"Cache-Control":          "no-store",
			"Referrer-Policy":        "no-referrer",
			"X-Content-Type-Options": "nosniff",
		} {
			if got := response.Header().Get(name); got != want {
				t.Errorf("%s returned %s %q, want %q", row.path, name, got, want)
			}
		}
		if row.code == 405 && response.Header().Get("Allow") != "GET, HEAD" {
			t.Errorf("%s lacks a method allowance", row.path)
		}
	}
}

func TestRepresentationsAndConditionalRequests(t *testing.T) {
	handler := testHandler(t, io.Discard)
	request := func(method, path, encoding, etag string, signed bool) *httptest.ResponseRecorder {
		r := httptest.NewRequestWithContext(t.Context(), method, path, nil)
		if signed {
			r.Header = signedHeaders()
		}
		r.Header.Set("Accept-Encoding", encoding)
		r.Header.Set("If-None-Match", etag)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	html := request("GET", "/", "", "", true)
	if html.Code != 200 || html.Body.String() != "<html>Activity</html>" ||
		html.Header().Get("Content-Security-Policy") != contentSecurityPolicy ||
		html.Header().Get("Cache-Control") != "no-store" ||
		html.Header().Get("Content-Type") != "text/html; charset=utf-8" {
		t.Fatalf("unexpected HTML response: %v %q", html.Header(), html.Body.String())
	}
	encoded := request("GET", scriptPath+"?ignored=yes", "gzip, br", "", true)
	if encoded.Code != 200 || encoded.Body.String() != "br js" ||
		encoded.Header().Get("Content-Encoding") != "br" ||
		encoded.Header().Get("Content-Length") != "5" ||
		encoded.Header().Get("Vary") != "Accept-Encoding" ||
		encoded.Header().Get("Cache-Control") != "private, max-age=31536000, immutable" {
		t.Fatalf("unexpected encoded response: %v %q", encoded.Header(), encoded.Body.String())
	}
	head := request("HEAD", scriptPath, "gzip, br", "", true)
	if head.Code != 200 || head.Body.Len() != 0 || head.Header().Get("Content-Length") != "5" {
		t.Fatal("HEAD did not return the same representation headers")
	}
	tag := encoded.Header().Get("ETag")
	cached := request(http.MethodGet, scriptPath, "br", "W/"+tag, true)
	if cached.Code != http.StatusNotModified || cached.Body.Len() != 0 {
		t.Fatal("signed conditional request did not validate")
	}
	unsigned := request(http.MethodGet, scriptPath, "br", tag, false)
	if unsigned.Code != http.StatusUnauthorized || unsigned.Body.Len() != 0 {
		t.Fatal("unsigned conditional request passed authentication")
	}
	if different := request("GET", scriptPath, "gzip", tag, true); different.Code != 200 ||
		different.Header().Get("ETag") == tag {
		t.Fatal("conditional request reused a different encoding's validator")
	}
	if catalog := request("GET", "/catalog.json", "", "", true); catalog.Code != 200 ||
		catalog.Header().Get("Cache-Control") != "no-store" ||
		catalog.Header().Get("Content-Type") != "application/json" {
		t.Fatal("catalog response metadata changed")
	}
	excluded := request(http.MethodGet, "/catalog.json", "br, identity;q=0", "*", true)
	if excluded.Code != http.StatusNotAcceptable {
		t.Fatal("accepted a request without an eligible representation")
	}
}

type interruptedResponse struct{ *httptest.ResponseRecorder }

func (interruptedResponse) Write([]byte) (int, error) {
	return 1, errors.New("secret from writer")
}

func TestRequestLogs(t *testing.T) {
	var log bytes.Buffer
	handler := testHandler(t, &log)
	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/?private=query", nil)
	request.Header = signedHeaders()
	writer := interruptedResponse{ResponseRecorder: httptest.NewRecorder()}
	handler.ServeHTTP(writer, request)
	for _, value := range []string{
		`"route":"content"`, `"status":200`, `"duration":`, `"bytes":1`,
	} {
		if !strings.Contains(log.String(), value) {
			t.Errorf("missing sanitized request metadata %s", value)
		}
	}
	for _, secret := range []string{
		"private=query", "secret from writer", request.Header.Get("X-Signature-Ed25519"),
	} {
		if strings.Contains(log.String(), secret) {
			t.Fatal("request contents reached logs")
		}
	}
}
