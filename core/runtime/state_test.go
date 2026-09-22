package runtime

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
)

func TestStateCASAndRebuild(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	command(t, r, "state1", "state.set", map[string]any{"key": "desk.note", "value": "ready", "expected_revision": 0})
	_, e := r.Execute(context.Background(), "owner", Request{ID: "stale", Op: "state.set", Body: json.RawMessage(`{"key":"desk.note","value":"stale","expected_revision":0}`)})
	if e == nil {
		t.Fatal("stale write accepted")
	}
	r.db.Exec("DELETE FROM state_values")
	command(t, r, "replay", "events.replay", nil)
	rows, e := r.List(context.Background(), "state")
	if e != nil || len(rows) != 1 || string(rows[0]["value"].(json.RawMessage)) != `"ready"` {
		t.Fatalf("%v %v", rows, e)
	}
}
