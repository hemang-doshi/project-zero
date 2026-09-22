package protocol

import (
	"strings"
	"testing"
	"time"
)

func TestBoundary(t *testing.T) {
	good := `{"zero":"0.1","type":"node.heartbeat","id":"1","time":"2026-09-08T12:00:00Z","source":"node:desk","body":{},"future":true}`
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	if _, e := Decode([]byte(good), "node:desk", now); e != nil {
		t.Fatal(e)
	}
	for _, bad := range []string{strings.Replace(good, `"0.1"`, `"9.0"`, 1), strings.Replace(good, `"node:desk"`, `"node:other"`, 1), strings.Repeat("x", MaxFrame+1), `{}`, strings.Replace(good, `"body":{}`, `"body":null`, 1)} {
		if _, e := Decode([]byte(bad), "node:desk", now); e == nil {
			t.Fatalf("accepted %s", bad[:min(len(bad), 80)])
		}
	}
}
