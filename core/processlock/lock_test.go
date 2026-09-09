package processlock

import (
	"path/filepath"
	"testing"
)

func TestExclusiveUntilClose(t *testing.T) {
	p := filepath.Join(t.TempDir(), "runtime.lock")
	a, e := Acquire(p)
	if e != nil {
		t.Fatal(e)
	}
	if b, e := Acquire(p); e == nil {
		b.Close()
		t.Fatal("second daemon acquired data directory")
	}
	a.Close()
	b, e := Acquire(p)
	if e != nil {
		t.Fatal(e)
	}
	b.Close()
}
