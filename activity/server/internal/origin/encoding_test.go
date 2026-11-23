package origin

import "testing"

func TestEncodings(t *testing.T) {
	all := map[encoding]representation{identity: {}, gzip: {}, brotli: {}}
	for _, row := range []struct {
		header string
		want   encoding
	}{
		{"", identity},
		{"foo", identity},
		{"gzip", gzip},
		{"Br, gzip", brotli},
		{"gzip;q=0.75, br;q=0.5, identity;q=0.25", gzip},
		{"gzip;q=0.9", identity},
		{"gzip; Q = 1.000", gzip},
		{"*;q=1, br;q=0", gzip},
		{"*;q=0, identity;q=0.1", identity},
		{"identity;q=0, *;q=0", ""},
		{"*;q=0", ""},
		{"br,br;q=0, gzip;q=0.9, identity;q=0", gzip},
		{"gzip;q=0.25, gzip;q=1, identity;q=0.75", identity},
		{"br;q=2.0, br;q=0.0000, br;q=0./, br;q=0.x, br;q=1.01", identity},
		{"gzip;x=1, gzip;q, identity;q=0", ""},
		{"gzip;q=0., identity;q=0", ""},
	} {
		if got := chooseEncoding([]string{row.header}, all); got != row.want {
			t.Errorf("%q selected %q, want %q", row.header, got, row.want)
		}
	}
	onlyGzip := map[encoding]representation{gzip: {}}
	if got := chooseEncoding([]string{"br", "gzip"}, onlyGzip); got != gzip {
		t.Errorf("fallback selected %q", got)
	}
}

func FuzzEncodingNegotiation(f *testing.F) {
	for _, value := range []string{
		"", "br, gzip", "*;q=0", "br;q=0, *;q=1", "gzip;q=0.75, identity;q=0.1",
	} {
		f.Add(value, uint8(7))
	}
	f.Fuzz(func(t *testing.T, header string, mask uint8) {
		available := make(map[encoding]representation)
		for bit, coding := range []encoding{identity, gzip, brotli} {
			if mask&(1<<bit) != 0 {
				available[coding] = representation{}
			}
		}
		chosen := chooseEncoding([]string{header}, available)
		if chosen == "" {
			return
		}
		if _, ok := available[chosen]; !ok {
			t.Fatalf("selected unavailable coding %q", chosen)
		}
		weights := encodingWeights([]string{header})
		weight, explicit := weights[chosen]
		wildcard, present := weights["*"]
		if !explicit {
			weight = wildcard
			if chosen == identity && (!present || wildcard != 0) {
				weight = fullWeight
			}
		}
		if weight <= 0 {
			t.Fatalf("selected unacceptable coding %q", chosen)
		}
	})
}
