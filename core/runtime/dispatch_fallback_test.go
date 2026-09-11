package runtime

// Pre-install confirmations for the gated connection poll (Task 28 Fix C).
//
// Revocation enumeration (writers of the answers Known/Pending give):
//   nodes.revoke  -> UPDATE nodes SET revoked=1, commits, publishes
//                   nodes+invocations+approvals (actions.go nodes.revoke)
//   re-enroll     -> DELETE + re-INSERT, commits, publishes nodes
//                   (runtime.go Enroll; also the only fingerprint rotation)
//   grants.set    -> commits, publishes grants (covers DENIED and any edit;
//                   SESSION_ALLOWED *expiry* itself is derived, see below)
//   lease-expiry  -> derived read-only (queryList status, queueSession
//                   filter); never touches the revoked bit Known reads.
// Every hard-revocation path commits, so the gated loop sees it as a
// revision bump within 100ms; the 1s fallback covers the rest.
//
// Writer-less Pending triggers (transitions with zero DB writes):
//   T1 deadline passes -> EXPIRED (24h display invoke, 2min approval window)
//   T2 SESSION_ALLOWED grant expires -> decision flips -> REJECTED
//   T4 outbox next_at backoff (2^attempt s, min 2s) expires -> redispatch
// Record-SET changes (outbox/invocation INSERT/DELETE/UPDATE) all happen in
// committing paths (invoke, approvals, nodes.revoke, Result, Pending
// itself), so they ride the revision path. Attempt>=5 TIMED_OUT is not
// writer-less: attempts only change in a Pending commit that bumps the
// revision. Fresh display content always arrives as a new invocation
// (invoke cancels superseded display rows), so backoff redispatch only
// retries failed deliveries and its <=1s delay sits inside the backoff's
// own >=2s granularity.

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func enrollGranted(t *testing.T, r *Runtime, id string) {
	t.Helper()
	if e := r.Enroll(context.Background(), id, "fp", []string{"display.render"}); e != nil {
		t.Fatal(e)
	}
	command(t, r, "grant-"+id, "grants.set", map[string]string{"principal": "owner", "capability": "display.render", "target": id, "state": "ALWAYS_ALLOWED"})
}

// Every hard-revocation path commits: the gated loop observes it as a
// revision advance on its next 100ms tick.
func TestRevocationPathsBumpRevision(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	ctx := context.Background()
	enrollGranted(t, r, "desk")
	if !r.Known(ctx, "desk", "fp") {
		t.Fatal("enrolled node unknown")
	}
	rev0 := r.Updates.Revision()
	command(t, r, "deny", "grants.set", map[string]string{"principal": "owner", "capability": "display.render", "target": "desk", "state": "DENIED"})
	if r.Updates.Revision() == rev0 {
		t.Fatal("grants.set did not bump revision")
	}
	rev1 := r.Updates.Revision()
	command(t, r, "revoke", "nodes.revoke", map[string]any{"node": "desk"})
	if r.Updates.Revision() == rev1 {
		t.Fatal("nodes.revoke did not bump revision")
	}
	if r.Known(ctx, "desk", "fp") {
		t.Fatal("revoked node still known")
	}
}

// Lease-expiry is not a Known input: a node silent past the 90s lease keeps
// its revoked bit, so the gated loop's answers stay correct with no poll.
func TestLeaseAgedNodeRemainsKnown(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	ctx := context.Background()
	now := time.Now()
	r.Now = func() time.Time { return now }
	enrollGranted(t, r, "desk")
	if e := r.Seen(ctx, "desk"); e != nil {
		t.Fatal(e)
	}
	now = now.Add(2 * time.Hour)
	nodes, e := r.List(ctx, "nodes")
	if e != nil {
		t.Fatal(e)
	}
	status := ""
	for _, n := range nodes {
		if n["id"] == "desk" {
			status, _ = n["status"].(string)
		}
	}
	if status != "OFFLINE" {
		t.Fatalf("expected lease-aged OFFLINE, got %q", status)
	}
	if !r.Known(ctx, "desk", "fp") {
		t.Fatal("lease-aged node no longer known")
	}
}

// Representative writer-less trigger T4: the backoff expires with no writer,
// and the next Pending call — the one the 1s fallback exists to make —
// redispatches.
func TestPendingRedispatchesAfterBackoff(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	ctx := context.Background()
	now := time.Now()
	r.Now = func() time.Time { return now }
	enrollGranted(t, r, "desk")
	command(t, r, "cap", "capabilities.invoke", map[string]any{"node": "desk", "capability": "display.render", "input": map[string]any{"project": "Zero"}})
	work, e := r.Pending(ctx, "desk")
	if e != nil || len(work) != 1 || work[0].Attempt != 1 {
		t.Fatalf("first dispatch: %v %v", work, e)
	}
	now = now.Add(3 * time.Second)
	work, e = r.Pending(ctx, "desk")
	if e != nil || len(work) != 1 || work[0].Attempt != 2 {
		t.Fatalf("backoff redispatch: %v %v", work, e)
	}
}

// Writer-less trigger T1: the 24h display deadline passes with no writer,
// and the next Pending call expires the invocation.
func TestPendingExpiresPastDeadline(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	ctx := context.Background()
	now := time.Now()
	r.Now = func() time.Time { return now }
	enrollGranted(t, r, "desk")
	command(t, r, "cap", "capabilities.invoke", map[string]any{"node": "desk", "capability": "display.render", "input": map[string]any{"project": "Zero"}})
	if _, e := r.Pending(ctx, "desk"); e != nil {
		t.Fatal(e)
	}
	now = now.Add(25 * time.Hour)
	work, e := r.Pending(ctx, "desk")
	if e != nil || len(work) != 0 {
		t.Fatalf("expected expiry, got: %v %v", work, e)
	}
	rows, e := r.List(ctx, "invocations")
	if e != nil {
		t.Fatal(e)
	}
	found := false
	for _, row := range rows {
		if row["id"] == "cap" && row["status"] == "EXPIRED" {
			found = true
		}
	}
	if !found {
		t.Fatalf("invocation not expired: %v", rows)
	}
}
