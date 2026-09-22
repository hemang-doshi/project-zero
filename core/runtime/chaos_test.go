package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"testing"
	"time"
)

func TestRepeatedRestartReplayPreservesCommittedState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "zero.db")
	r := openTest(t, path)
	now := time.Date(2026, 9, 8, 0, 0, 0, 0, time.UTC)
	r.Now = func() time.Time { return now }
	command(t, r, "start", "session.start", map[string]any{"project": "Zero"})
	for i := 0; i < 30; i++ {
		now = now.Add(time.Second)
		op := "session.pause"
		if i%2 == 1 {
			op = "session.resume"
		}
		command(t, r, fmt.Sprint(i), op, nil)
		before := session(t, r)
		r.Close()
		r = openTest(t, path)
		r.Now = func() time.Time { return now }
		command(t, r, fmt.Sprintf("replay%d", i), "events.replay", nil)
		if got := session(t, r); got != before {
			t.Fatalf("restart %d: %+v != %+v", i, got, before)
		}
	}
	if session(t, r).ElapsedMS != 15000 {
		t.Fatalf("wrong accumulated duration: %+v", session(t, r))
	}
}
func TestFailedProjectionWriteRollsBackEventAndCommand(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	_, e := r.db.Exec(`CREATE TRIGGER fail_projection BEFORE INSERT ON state_values BEGIN SELECT RAISE(ABORT,'disk failure'); END`)
	if e != nil {
		t.Fatal(e)
	}
	_, e = r.Execute(context.Background(), "owner", Request{ID: "start", Op: "session.start", Body: json.RawMessage(`{"project":"Zero"}`)})
	if e == nil {
		t.Fatal("acknowledged failed transaction")
	}
	rows, _ := r.List(context.Background(), "events")
	if len(rows) != 0 {
		t.Fatal("partial event persisted")
	}
	r.db.Exec(`DROP TRIGGER fail_projection`)
	command(t, r, "start", "session.start", map[string]any{"project": "Zero"})
	if session(t, r).State != "RUNNING" {
		t.Fatal("failed command was incorrectly deduped")
	}
}
