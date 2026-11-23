package origin

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
)

// allowedClockSkew is the maximum future creation time in seconds.
const allowedClockSkew = 30

// maxSafeInteger is the JavaScript safe-integer bound for Discord proxy claims.
const maxSafeInteger = 1<<53 - 1

// parsePublicKey decodes Discord's hexadecimal Ed25519 key before the server starts.
func parsePublicKey(value string) (ed25519.PublicKey, error) {
	key, err := hex.DecodeString(value)
	if err != nil || len(key) != ed25519.PublicKeySize {
		return nil, errors.New("DISCORD_ACTIVITY_PUBLIC_KEY must be a 64-character hexadecimal key")
	}
	return key, nil
}

// singleHeader returns one exact field value or an empty string for an ambiguous field.
func singleHeader(headers http.Header, name string) string {
	values := headers.Values(name)
	if len(values) != 1 {
		return ""
	}
	return values[0]
}

// decodeBase64 accepts the standard and URL-safe alphabets, with or without padding.
func decodeBase64(value string) []byte {
	if strings.ContainsAny(value, "\r\n") {
		return nil
	}
	encoding := base64.StdEncoding
	if strings.ContainsAny(value, "-_") {
		encoding = base64.URLEncoding
	}
	if !strings.Contains(value, "=") {
		encoding = encoding.WithPadding(base64.NoPadding)
	}
	decoded, err := encoding.Strict().DecodeString(value)
	if err != nil {
		return nil
	}
	return decoded
}

// decodeSignature accepts either of the encodings documented by Discord.
func decodeSignature(value string) []byte {
	if len(value) != hex.EncodedLen(ed25519.SignatureSize) {
		return decodeBase64(value)
	}
	signature, err := hex.DecodeString(value)
	if err != nil {
		return nil
	}
	return signature
}

// safeInteger reads a non-null JSON number within the JavaScript safe-integer range.
func safeInteger(raw json.RawMessage) (int64, bool) {
	var value *float64
	if err := json.Unmarshal(raw, &value); err != nil || value == nil {
		return 0, false
	}
	if math.Trunc(*value) != *value || math.Abs(*value) > maxSafeInteger {
		return 0, false
	}
	return int64(*value), true
}

// authenticated verifies the original signed bytes before reading exact claim names.
func authenticated(key ed25519.PublicKey, headers http.Header, now int64) bool {
	signature := decodeSignature(singleHeader(headers, "X-Signature-Ed25519"))
	payload := decodeBase64(singleHeader(headers, "X-Discord-Proxy-Payload"))
	if len(signature) != ed25519.SignatureSize || len(payload) == 0 ||
		!ed25519.Verify(key, payload, signature) {
		return false
	}
	var claims map[string]json.RawMessage
	if err := json.Unmarshal(payload, &claims); err != nil {
		return false
	}
	created, valid := safeInteger(claims["created_at"])
	if !valid || strconv.FormatInt(created, 10) != singleHeader(headers, "X-Signature-Timestamp") ||
		created > now+allowedClockSkew {
		return false
	}
	expires, valid := safeInteger(claims["expires_at"])
	return valid && expires > max(now, created)
}
