package runtime

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

// A node that has not been seen within the lease must not accumulate new
// render invocations/outbox rows while it is offline; only live nodes do.
func TestOfflineNodeReceivesNoQueuedDisplays(t *testing.T) {
	ctx := context.Background()
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	now := time.Now()
	r.Now = func() time.Time { return now }
	for _, id := range []string{"offline", "online"} {
		if e := r.Enroll(ctx, id, id, []string{"display.render"}); e != nil {
			t.Fatal(e)
		}
		command(t, r, "grant-"+id, "grants.set", map[string]any{"principal": "owner", "capability": "display.render", "target": id, "state": "ALWAYS_ALLOWED"})
	}
	if _, e := r.db.ExecContext(ctx, "UPDATE nodes SET last_seen=? WHERE id='offline'", now.Add(-time.Hour).UTC().Format(time.RFC3339Nano)); e != nil {
		t.Fatal(e)
	}
	if e := r.Seen(ctx, "online"); e != nil {
		t.Fatal(e)
	}
	command(t, r, "start", "session.start", map[string]any{"project": "Zero"})
	if work, e := r.Pending(ctx, "offline"); e != nil || len(work) != 0 {
		t.Fatalf("offline node queued %d (err %v)", len(work), e)
	}
	if work, e := r.Pending(ctx, "online"); e != nil || len(work) != 1 {
		t.Fatalf("online node queued %d (err %v)", len(work), e)
	}
}
