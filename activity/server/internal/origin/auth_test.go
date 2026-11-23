package origin

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"
)

const fixtureNow = 1700000000

func fixturePrivateKey() ed25519.PrivateKey {
	return ed25519.NewKeyFromSeed(make([]byte, ed25519.SeedSize))
}

func fixturePublicKey() string {
	return hex.EncodeToString(fixturePrivateKey()[ed25519.SeedSize:])
}

func signedHeaders() http.Header {
	payload := []byte(`{"created_at":1700000000,"expires_at":1700000060}`)
	return makeProof(hex.EncodeToString(ed25519.Sign(fixturePrivateKey(), payload)),
		base64.StdEncoding.EncodeToString(payload), "1700000000")
}

func makeProof(signature, payload, timestamp string) http.Header {
	headers := make(http.Header)
	headers.Set("X-Signature-Ed25519", signature)
	headers.Set("X-Discord-Proxy-Payload", payload)
	headers.Set("X-Signature-Timestamp", timestamp)
	return headers
}

func TestProxySignatureVectors(t *testing.T) {
	bytes, err := os.ReadFile("testdata/proxy-authentication.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		PublicKey string `json:"publicKey"`
		Now       int64  `json:"now"`
		Vectors   []struct {
			Name      string `json:"name"`
			Signature string `json:"signature"`
			Payload   string `json:"payload"`
			Timestamp string `json:"timestamp"`
			Accepted  bool   `json:"accepted"`
		} `json:"vectors"`
	}
	if err := json.Unmarshal(bytes, &fixture); err != nil {
		t.Fatal(err)
	}
	key, err := parsePublicKey(fixture.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	for _, vector := range fixture.Vectors {
		t.Run(vector.Name, func(t *testing.T) {
			proof := makeProof(vector.Signature, vector.Payload, vector.Timestamp)
			if got := authenticated(key, proof, fixture.Now); got != vector.Accepted {
				t.Errorf("authenticated returned %t, want %t", got, vector.Accepted)
			}
		})
	}
}

func TestRejectAmbiguousProof(t *testing.T) {
	key, err := parsePublicKey(fixturePublicKey())
	if err != nil {
		t.Fatal(err)
	}
	for name, values := range signedHeaders() {
		duplicate := signedHeaders()
		duplicate.Add(name, values[0])
		if authenticated(key, duplicate, fixtureNow) {
			t.Errorf("accepted multiple %s headers", name)
		}
		missing := signedHeaders()
		missing.Del(name)
		if authenticated(key, missing, fixtureNow) {
			t.Errorf("accepted missing %s", name)
		}
	}
	for _, signature := range []string{
		strings.Repeat("g", 128), strings.Repeat("0", 128), "invalid!", "YW\nJj",
	} {
		proof := signedHeaders()
		proof.Set("X-Signature-Ed25519", signature)
		if authenticated(key, proof, fixtureNow) {
			t.Errorf("accepted invalid signature %q", signature)
		}
	}
}

func TestPublicKey(t *testing.T) {
	for _, value := range []string{"", "aa", strings.Repeat("x", 64)} {
		if _, err := parsePublicKey(value); err == nil {
			t.Errorf("accepted invalid key %q", value)
		}
	}
}
