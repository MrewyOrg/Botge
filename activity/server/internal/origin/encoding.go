package origin

import (
	"strings"
)

// encoding names a representation directory and its HTTP content coding.
type encoding string

const (
	// identity is the original build file without a content coding.
	identity encoding = "identity"
	// gzip is the gzip representation.
	gzip encoding = "gzip"
	// brotli is the Brotli representation.
	brotli encoding = "br"
	// fullWeight is the largest HTTP quality value in thousandths.
	fullWeight = 1000
)

// quality parses an HTTP quality weight in thousandths without floating-point rounding.
func quality(value string) int {
	value = strings.TrimSpace(value)
	whole, fraction, _ := strings.Cut(value, ".")
	if (whole != "0" && whole != "1") || len(fraction) > 3 {
		return 0
	}
	var weight int
	for _, digit := range fraction + strings.Repeat("0", 3-len(fraction)) {
		if digit < '0' || digit > '9' {
			return 0
		}
		weight = weight*10 + int(digit-'0')
	}
	if whole == "1" {
		if weight != 0 {
			return 0
		}
		return fullWeight
	}
	return weight
}

// encodingWeights reads all list members and honors exclusions in repeated entries.
func encodingWeights(lines []string) map[encoding]int {
	weights := make(map[encoding]int)
	for _, line := range lines {
		for item := range strings.SplitSeq(line, ",") {
			name, parameter, hasParameter := strings.Cut(item, ";")
			coding := encoding(strings.ToLower(strings.TrimSpace(name)))
			weight := fullWeight
			if hasParameter {
				key, value, _ := strings.Cut(parameter, "=")
				weight = 0
				if strings.EqualFold(strings.TrimSpace(key), "q") {
					weight = quality(value)
				}
			}
			if previous, listed := weights[coding]; listed {
				weight = min(weight, previous)
			}
			weights[coding] = weight
		}
	}
	return weights
}

// chooseEncoding selects an available coding by weight, preferring Brotli on ties.
func chooseEncoding(lines []string, available map[encoding]representation) encoding {
	weights := encodingWeights(lines)
	wildcard, hasWildcard := weights["*"]
	if _, explicit := weights[identity]; !explicit && (!hasWildcard || wildcard != 0) {
		weights[identity] = fullWeight
	}
	var chosen encoding
	var best int
	for _, coding := range [...]encoding{brotli, gzip, identity} {
		weight, explicit := weights[coding]
		if !explicit {
			weight = wildcard
		}
		if _, exists := available[coding]; exists && weight > best {
			chosen, best = coding, weight
		}
	}
	return chosen
}
