package runtime

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func TestPresenceAndRePairAfterRevocation(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	ctx := context.Background()
	now := time.Now()
	r.Now = func() time.Time { return now }
	r.Enroll(ctx, "desk", "old", []string{"display.render"})
	r.Seen(ctx, "desk")
	now = now.Add(65 * time.Second)
	rows, _ := r.List(ctx, "nodes")
	if rows[0]["status"] != "SUSPECT" {
		t.Fatalf("%v", rows)
	}
	now = now.Add(30 * time.Second)
	rows, _ = r.List(ctx, "nodes")
	if rows[0]["status"] != "OFFLINE" {
		t.Fatalf("%v", rows)
	}
	command(t, r, "revoke", "nodes.revoke", map[string]any{"node": "desk"})
	if e := r.Enroll(ctx, "desk", "new", []string{"display.render"}); e != nil {
		t.Fatal(e)
	}
	if r.Known(ctx, "desk", "old") || !r.Known(ctx, "desk", "new") {
		t.Fatal("old identity retained")
	}
}
