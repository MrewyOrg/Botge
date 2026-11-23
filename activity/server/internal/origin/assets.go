package origin

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"strings"
)

// filenameCharacters lists the bytes allowed inside each public filename segment.
const filenameCharacters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-"

// assetSpec describes a public file and its private representations in the staged manifest.
type assetSpec struct {
	MIME          string     `json:"mime"`          // MIME is the original content type.
	Fingerprinted bool       `json:"fingerprinted"` // Fingerprinted marks URLs with build hashes.
	Encodings     []encoding `json:"encodings"`     // Encodings lists the stored representations.
}

// representation holds one immutable response body and its strong validator.
type representation struct {
	body []byte // body is the byte sequence to transfer for this coding.
	etag string // etag varies with both the coding and its bytes.
}

// asset binds the original content metadata to its available representations.
type asset struct {
	mime          string                      // mime is the original content type.
	fingerprinted bool                        // fingerprinted permits long-lived private caching.
	variants      map[encoding]representation // variants is populated once before listening.
}

// loadAssets reads and validates the embedded site before receiving requests.
func loadAssets(files fs.FS) (map[string]asset, error) {
	manifest, err := fs.ReadFile(files, "dist/manifest.json")
	if err != nil {
		return nil, fmt.Errorf("read site manifest: %w", err)
	}
	var specs map[string]assetSpec
	if err := json.Unmarshal(manifest, &specs); err != nil {
		return nil, fmt.Errorf("decode site manifest: %w", err)
	}
	assets := make(map[string]asset, len(specs)+1)
	for name, spec := range specs {
		entry, err := readAsset(files, name, spec)
		if err != nil {
			return nil, err
		}
		assets["/"+name] = entry
	}
	index, found := assets["/index.html"]
	if !found {
		return nil, errors.New("site manifest has no index.html")
	}
	assets["/"] = index
	return assets, nil
}

// readAsset verifies the manifest entry and hashes each available representation once.
func readAsset(files fs.FS, name string, spec assetSpec) (asset, error) {
	if !publicName(name) || spec.MIME == "" {
		return asset{}, fmt.Errorf("invalid public file in site manifest: %q", name)
	}
	variants := make(map[encoding]representation, len(spec.Encodings))
	for _, coding := range spec.Encodings {
		switch coding {
		case identity, gzip, brotli:
		default:
			return asset{}, fmt.Errorf("unknown site encoding: %q", coding)
		}
		body, err := fs.ReadFile(files, "dist/"+string(coding)+"/"+name)
		if err != nil {
			return asset{}, fmt.Errorf("read %s representation of %q: %w", coding, name, err)
		}
		etag := fmt.Sprintf(`"%s-%x"`, coding, sha256.Sum256(body))
		variants[coding] = representation{body: body, etag: etag}
	}
	if _, found := variants[identity]; !found {
		return asset{}, fmt.Errorf("site file has no original representation: %q", name)
	}
	return asset{mime: spec.MIME, fingerprinted: spec.Fingerprinted, variants: variants}, nil
}

// publicName rejects path spellings outside the staged ASCII filename contract.
func publicName(name string) bool {
	if !fs.ValidPath(name) {
		return false
	}
	for part := range strings.SplitSeq(name, "/") {
		if strings.HasPrefix(part, ".") || strings.HasPrefix(part, "_") {
			return false
		}
		for _, c := range part {
			if !strings.ContainsRune(filenameCharacters, c) {
				return false
			}
		}
	}
	return !strings.HasSuffix(name, ".map") && !strings.HasSuffix(name, ".br") &&
		!strings.HasSuffix(name, ".gz")
}

// notModified matches the selected representation using weak If-None-Match comparison.
func notModified(lines []string, etag string) bool {
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "*" {
			return true
		}
		for line != "" {
			tag, quoted := strings.CutPrefix(strings.TrimPrefix(line, "W/"), `"`)
			if !quoted {
				break
			}
			value, rest, closed := strings.Cut(tag, `"`)
			rest = strings.TrimSpace(rest)
			if !closed || (rest != "" && !strings.HasPrefix(rest, ",")) {
				break
			}
			if `"`+value+`"` == etag {
				return true
			}
			line = strings.TrimSpace(strings.TrimPrefix(rest, ","))
		}
	}
	return false
}
