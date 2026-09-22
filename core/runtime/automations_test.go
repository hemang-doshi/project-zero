package runtime

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"
)

func TestReminderDedupPauseDowntimeAndDisable(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	now := time.Now()
	r.Now = func() time.Time { return now }
	command(t, r, "start", "session.start", map[string]any{"project": "Zero"})
	command(t, r, "enable", "policies.apply", map[string]any{"id": "focus-break"})
	now = now.Add(45 * time.Minute)
	if e := r.TickAutomations(context.Background()); e != nil {
		t.Fatal(e)
	}
	r.TickAutomations(context.Background())
	rows, e := r.List(context.Background(), "firings")
	if e != nil || len(rows) != 1 {
		t.Fatalf("%v %v", rows, e)
	}
	command(t, r, "pause", "session.pause", nil)
	now = now.Add(3 * time.Hour)
	r.TickAutomations(context.Background())
	rows, _ = r.List(context.Background(), "firings")
	if len(rows) != 1 {
		t.Fatal("paused reminder")
	}
	command(t, r, "resume", "session.resume", nil)
	now = now.Add(3 * time.Hour)
	r.TickAutomations(context.Background())
	rows, _ = r.List(context.Background(), "firings")
	if len(rows) != 2 {
		t.Fatal("downtime replay storm")
	}
	command(t, r, "disable", "policies.disable", map[string]any{"id": "focus-break"})
	now = now.Add(time.Hour)
	r.TickAutomations(context.Background())
	rows, _ = r.List(context.Background(), "firings")
	if len(rows) != 2 {
		t.Fatal("disabled rule fired")
	}
}

func TestDisableCancellationSurvivesRebuild(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	now := time.Now()
	r.Now = func() time.Time { return now }
	command(t, r, "start", "session.start", map[string]any{"project": "Zero"})
	command(t, r, "enable", "policies.apply", map[string]any{"id": "focus-break"})
	now = now.Add(45 * time.Minute)
	r.TickAutomations(context.Background())
	command(t, r, "disable", "policies.disable", map[string]any{"id": "focus-break"})
	command(t, r, "rebuild", "events.replay", nil)
	var state string
	if e := r.db.QueryRow("SELECT json_extract(value,'$.state') FROM entities WHERE kind='firing'").Scan(&state); e != nil || state != "CANCELLED" {
		t.Fatalf("%s %v", state, e)
	}
}

func TestNotificationClaimCannotRepeatOrOutliveDisable(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	now := time.Now()
	r.Now = func() time.Time { return now }
	command(t, r, "start", "session.start", map[string]any{"project": "Zero"})
	command(t, r, "enable", "policies.apply", map[string]any{"id": "focus-break"})
	now = now.Add(45 * time.Minute)
	r.TickAutomations(context.Background())
	var id string
	r.db.QueryRow("SELECT key FROM entities WHERE kind='firing'").Scan(&id)
	command(t, r, "claim", "notifications.claim", map[string]any{"id": id})
	b, _ := json.Marshal(map[string]any{"id": id})
	if _, e := r.Execute(context.Background(), "owner", Request{ID: "second-claim", Op: "notifications.claim", Body: b}); e == nil {
		t.Fatal("duplicate delivery claim")
	}
	command(t, r, "disable", "policies.disable", map[string]any{"id": "focus-break"})
	if _, e := r.Execute(context.Background(), "owner", Request{ID: "third-claim", Op: "notifications.claim", Body: b}); e == nil {
		t.Fatal("disabled delivery")
	}
}
