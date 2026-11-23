// Package site contains the deterministic build produced by the Activity staging command.
package site

import (
	"embed"
	"io/fs"
)

// content contains the private staged manifest and encoded assets.
//
//go:embed dist
var content embed.FS

// Files exposes the embedded site rooted at its private dist directory.
func Files() fs.FS { return content }
