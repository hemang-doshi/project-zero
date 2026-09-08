package runtime

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"
)

func TestNewDisplaySupersedesAlreadyDispatchedRetry(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	r.Enroll(context.Background(), "desk", "fp", []string{"display.render", "display.clear"})
	now := time.Now()
	r.Now = func() time.Time { return now }
	for _, c := range []string{"display.render", "display.clear"} {
		command(t, r, c, "grants.set", map[string]any{"principal": "owner", "capability": c, "target": "desk", "state": "ALWAYS_ALLOWED"})
	}
	command(t, r, "old", "capabilities.invoke", map[string]any{"node": "desk", "capability": "display.render", "input": map[string]any{"project": "Old"}})
	r.Pending(context.Background(), "desk")
	command(t, r, "new", "capabilities.invoke", map[string]any{"node": "desk", "capability": "display.clear", "input": map[string]any{}})
	now = now.Add(10 * time.Second)
	work, e := r.Pending(context.Background(), "desk")
	if e != nil || len(work) != 1 || work[0].ID != "new" {
		t.Fatalf("stale retry can overwrite latest: %+v %v", work, e)
	}
	r.Result(context.Background(), "desk", "new", "SUCCEEDED", json.RawMessage(`{}`))
	if e = r.Restore(context.Background(), "desk", "fresh"); e != nil {
		t.Fatal(e)
	}
	work, e = r.Pending(context.Background(), "desk")
	if e != nil || len(work) != 1 || work[0].Capability != "display.clear" {
		t.Fatalf("restored old render: %+v %v", work, e)
	}
}
func TestExpiredSessionGrantDoesNotDispatch(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	r.Enroll(context.Background(), "desk", "fp", []string{"display.render"})
	now := time.Now()
	r.Now = func() time.Time { return now }
	command(t, r, "grant", "grants.set", map[string]any{"principal": "owner", "capability": "display.render", "target": "desk", "state": "SESSION_ALLOWED", "expires": now.Add(time.Second).Format(time.RFC3339Nano)})
	command(t, r, "render", "capabilities.invoke", map[string]any{"node": "desk", "capability": "display.render", "input": map[string]any{}})
	now = now.Add(2 * time.Second)
	work, e := r.Pending(context.Background(), "desk")
	if e != nil || len(work) != 0 {
		t.Fatalf("expired grant dispatched: %v %v", work, e)
	}
}
