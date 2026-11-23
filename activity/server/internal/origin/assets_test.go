package origin

import (
	"errors"
	"io/fs"
	"net/url"
	"testing"
	"testing/fstest"
)

// fixtureSite creates an independent asset inventory with synthetic encoded representations.
func fixtureSite() fstest.MapFS {
	return fstest.MapFS{
		"dist/manifest.json": {Data: []byte(`{
"index.html":{"mime":"text/html; charset=utf-8","encodings":["identity","br","gzip"]},
"catalog.json":{"mime":"application/json","encodings":["identity"]},
"assets/app-abcdefgh.js":{
	"mime":"text/javascript; charset=utf-8",
	"fingerprinted":true,"encodings":["identity","br","gzip"]
}
}`)},
		"dist/identity/index.html":             {Data: []byte("<html>Activity</html>")},
		"dist/br/index.html":                   {Data: []byte("br html")},
		"dist/gzip/index.html":                 {Data: []byte("gzip html")},
		"dist/identity/catalog.json":           {Data: []byte("[]")},
		"dist/identity/assets/app-abcdefgh.js": {Data: []byte("console.log('Activity')")},
		"dist/br/assets/app-abcdefgh.js":       {Data: []byte("br js")},
		"dist/gzip/assets/app-abcdefgh.js":     {Data: []byte("gzip js")},
	}
}

func TestBadSite(t *testing.T) {
	for name, manifest := range map[string]string{
		"bad JSON":        "{",
		"no index":        `{}`,
		"no type":         `{"index.html":{"encodings":["identity"]}}`,
		"hidden file":     `{".env":{"mime":"text/plain","encodings":["identity"]}}`,
		"unknown coding":  `{"index.html":{"mime":"text/html","encodings":["deflate"]}}`,
		"absent original": `{"index.html":{"mime":"text/html","encodings":["br"]}}`,
		"absent file":     `{"absent.html":{"mime":"text/html","encodings":["identity"]}}`,
	} {
		t.Run(name, func(t *testing.T) {
			files := fixtureSite()
			files["dist/manifest.json"] = &fstest.MapFile{Data: []byte(manifest)}
			_, err := loadAssets(files)
			if err == nil {
				t.Fatal("accepted invalid staged site")
			}
			if name == "absent file" && !errors.Is(err, fs.ErrNotExist) {
				t.Errorf("loadAssets returned %v, want fs.ErrNotExist", err)
			}
		})
	}
	if _, err := loadAssets(fstest.MapFS{}); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("loadAssets with no manifest returned %v, want fs.ErrNotExist", err)
	}
}

func TestPublicNames(t *testing.T) {
	for _, name := range []string{
		"../foo.js", "assets//main.js", ".env", "_headers", "assets/a%20b.js",
		"a.js.map", "a.js.br", "a.js.gz", "assets/ä.js",
	} {
		if publicName(name) {
			t.Errorf("accepted unsafe name %q", name)
		}
	}
}

func TestETagList(t *testing.T) {
	for _, row := range []struct {
		header string
		match  bool
	}{
		{`*`, true},
		{`W/"old", "live"`, true},
		{`W/"live"`, true},
		{`"old,*,tag"`, false},
		{`invalid`, false},
		{`"unclosed`, false},
		{`"live"junk`, false},
		{`"other", "missing"`, false},
	} {
		if got := notModified([]string{row.header}, `"live"`); got != row.match {
			t.Errorf("%s matched %t, want %t", row.header, got, row.match)
		}
	}
}

func FuzzAssetLookup(f *testing.F) {
	files := fixtureSite()
	assets, err := loadAssets(files)
	if err != nil {
		f.Fatal(err)
	}
	for _, seed := range []string{
		"/", "/index.html", "/assets/app-abcdefgh.js", "/catalog.json",
		"/assets/%2fapp-abcdefgh.js", "/assets//app-abcdefgh.js", "/dist/manifest.json",
	} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, path string) {
		target, err := url.ParseRequestURI(path)
		if err != nil {
			return
		}
		path = requestPath(target)
		if _, found := assets[path]; !found {
			return
		}
		if path == "/" {
			path = "/index.html"
		}
		if !publicName(path[1:]) || !fs.ValidPath(path[1:]) {
			t.Fatalf("lookup accepted an ambiguous path %q", path)
		}
		if _, err := fs.Stat(files, "dist/identity"+path); err != nil {
			t.Fatalf("lookup resolved outside the manifest inventory: %v", err)
		}
	})
}
