package runtime

import (
	"context"
	"encoding/json"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func openTest(t *testing.T, path string) *Runtime {
	t.Helper()
	r, e := Open(path)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { r.Close() })
	return r
}
func command(t *testing.T, r *Runtime, id, op string, body any) Response {
	t.Helper()
	b, _ := json.Marshal(body)
	v, e := r.Execute(context.Background(), "owner", Request{ID: id, Op: op, Body: b})
	if e != nil {
		t.Fatal(e)
	}
	return v
}
func session(t *testing.T, r *Runtime) Session {
	t.Helper()
	s, e := r.Session(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	return s
}

// Losing the transaction or counting paused time breaks these assertions.
func TestSessionRestartAndDuplicate(t *testing.T) {
	p := filepath.Join(t.TempDir(), "zero.db")
	r := openTest(t, p)
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	r.Now = func() time.Time { return now }
	command(t, r, "start", "session.start", map[string]any{"project": "Project Zero"})
	now = now.Add(12 * time.Second)
	command(t, r, "pause", "session.pause", nil)
	now = now.Add(time.Hour)
	command(t, r, "pause", "session.pause", nil)
	if s := session(t, r); s.State != "PAUSED" || s.ElapsedMS != 12000 {
		t.Fatalf("%+v", s)
	}
	r.Close()
	r2 := openTest(t, p)
	r2.Now = func() time.Time { return now }
	if s := session(t, r2); s.ElapsedMS != 12000 {
		t.Fatalf("restart: %+v", s)
	}
	command(t, r2, "resume", "session.resume", nil)
	now = now.Add(5 * time.Second)
	if s := session(t, r2); s.ElapsedMS != 17000 {
		t.Fatalf("resume: %+v", s)
	}
	before := session(t, r2)
	command(t, r2, "rebuild", "events.replay", nil)
	if after := session(t, r2); before != after {
		t.Fatalf("replay: %+v != %+v", before, after)
	}
}

func TestDuplicateKeyCannotChangePayload(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	command(t, r, "same", "session.start", map[string]any{"project": "Zero"})
	_, e := r.Execute(context.Background(), "owner", Request{ID: "same", Op: "session.pause", Body: json.RawMessage(`null`)})
	if e == nil {
		t.Fatal("idempotency key reused with changed effect")
	}
}

func TestDryRunDoesNotWrite(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	_, e := r.Execute(context.Background(), "owner", Request{ID: "preview", Op: "session.start", Body: json.RawMessage(`{"project":"Zero"}`), DryRun: true})
	if e != nil {
		t.Fatal(e)
	}
	if s := session(t, r); s.State != "IDLE" {
		t.Fatalf("dry run changed state: %+v", s)
	}
	rows, e := r.List(context.Background(), "events")
	if e != nil || len(rows) != 0 {
		t.Fatalf("dry-run events: %v %v", rows, e)
	}
}

func TestButtonDeduplicationAndConcurrentInputs(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	command(t, r, "start", "session.start", map[string]any{"project": "Zero"})
	if e := r.Enroll(context.Background(), "desk", "fingerprint", []string{"display.render", "display.clear"}); e != nil {
		t.Fatal(e)
	}
	command(t, r, "grant", "grants.set", map[string]any{"principal": "node:desk", "capability": "session.toggle", "target": "runtime", "state": "ALWAYS_ALLOWED"})
	var wg sync.WaitGroup
	errs := make(chan error, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, e := r.Execute(context.Background(), "node:desk", Request{ID: "button:boot1:1", Op: "session.toggle", Body: json.RawMessage(`{}`)})
			errs <- e
		}()
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	if s := session(t, r); s.State != "PAUSED" {
		t.Fatalf("duplicate toggles: %+v", s)
	}
	command(t, r, "revoke", "nodes.revoke", map[string]any{"node": "desk"})
	_, e := r.Execute(context.Background(), "node:desk", Request{ID: "button:boot1:2", Op: "session.toggle", Body: json.RawMessage(`{}`)})
	if e == nil {
		t.Fatal("revoked node invoked effect")
	}
}

func TestApprovalBoundToEffectAndRevocation(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	if e := r.Enroll(context.Background(), "desk", "fp", []string{"display.render"}); e != nil {
		t.Fatal(e)
	}
	v := command(t, r, "render", "capabilities.invoke", map[string]any{"node": "desk", "capability": "display.render", "input": map[string]any{"project": "Zero"}})
	if v.Status != "WAITING_APPROVAL" {
		t.Fatalf("new capability bypassed approval: %+v", v)
	}
	command(t, r, "approve", "approvals.approve", map[string]any{"id": v.ID})
	command(t, r, "deny", "grants.set", map[string]any{"principal": "owner", "capability": "display.render", "target": "desk", "state": "DENIED"})
	if work, e := r.Pending(context.Background(), "desk"); e != nil || len(work) != 0 {
		t.Fatalf("deny bypassed on dispatch: %v %v", work, e)
	}
}

func TestLatestQueueAndDurableResult(t *testing.T) {
	p := filepath.Join(t.TempDir(), "zero.db")
	r := openTest(t, p)
	r.Enroll(context.Background(), "desk", "fp", []string{"display.render"})
	command(t, r, "grant", "grants.set", map[string]any{"principal": "owner", "capability": "display.render", "target": "desk", "state": "ALWAYS_ALLOWED"})
	for _, id := range []string{"one", "two"} {
		command(t, r, id, "capabilities.invoke", map[string]any{"node": "desk", "capability": "display.render", "input": map[string]any{"project": id}})
	}
	work, e := r.Pending(context.Background(), "desk")
	if e != nil || len(work) != 1 || work[0].ID != "two" {
		t.Fatalf("latest: %v %v", work, e)
	}
	if e = r.Result(context.Background(), "desk", "two", "SUCCEEDED", json.RawMessage(`{}`)); e != nil {
		t.Fatal(e)
	}
	r.Close()
	r2 := openTest(t, p)
	work, e = r2.Pending(context.Background(), "desk")
	if e != nil || len(work) != 0 {
		t.Fatalf("completed work redelivered: %v %v", work, e)
	}
}
