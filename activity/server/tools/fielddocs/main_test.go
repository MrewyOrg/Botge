package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFieldComments(t *testing.T) {
	path := filepath.Join(t.TempDir(), "fixture.go")
	const source = `package fixture

type embedded struct{}

type record struct {
	// count keeps the number of entries.
	count int
	label string // label is shown in the report.
	private bool
	Exported int
	embedded
	// nested holds the secondary settings.
	nested struct {
		//go:generate echo ignored
		missing string
	}
}`
	if err := os.WriteFile(path, []byte(source), 0o600); err != nil {
		t.Fatal(err)
	}
	err := check(strings.NewReader(path + "\n"))
	if err == nil {
		t.Fatal("accepted undocumented struct fields")
	}
	want := []string{":9:2:", ":10:2:", ":11:2:", ":15:3:"}
	got := strings.Split(err.Error(), "\n")
	if len(got) != len(want) {
		t.Fatalf("got %d diagnostics, want %d: %v", len(got), len(want), err)
	}
	for i, offset := range want {
		if !strings.Contains(got[i], offset) {
			t.Errorf("got %q, want position %q", got[i], offset)
		}
	}
}
