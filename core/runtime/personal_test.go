package runtime

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func registerProject(t *testing.T, r *Runtime, id string) {
	t.Helper()
	path := t.TempDir()
	if err := os.Mkdir(filepath.Join(path, ".git"), 0700); err != nil {
		t.Fatal(err)
	}
	command(t, r, "register-"+id, "projects.add", map[string]any{"id": id, "name": id, "path": path, "aliases": []string{id + " alias"}})
}
func TestRegisteredSessionEndRestartAndLegacyDisplay(t *testing.T) {
	path := filepath.Join(t.TempDir(), "zero.db")
	r := openTest(t, path)
	registerProject(t, r, "zero")
	now := time.Now()
	r.Now = func() time.Time { return now }
	r.Enroll(context.Background(), "desk", "fp", []string{"display.render"})
	command(t, r, "grant", "grants.set", map[string]any{"principal": "owner", "capability": "display.render", "target": "desk", "state": "ALWAYS_ALLOWED"})
	command(t, r, "start", "session.start", map[string]any{"project_id": "zero"})
	first := session(t, r)
	now = now.Add(10 * time.Second)
	command(t, r, "same", "session.start", map[string]any{"project_id": "zero"})
	if session(t, r).Revision != first.Revision {
		t.Fatal("same project restarted session")
	}
	command(t, r, "end", "session.end", nil)
	ended := session(t, r)
	if ended.State != "IDLE" || ended.ElapsedMS != 10000 {
		t.Fatalf("%+v", ended)
	}
	command(t, r, "again", "session.start", map[string]any{"project_id": "zero"})
	if session(t, r).ElapsedMS != 0 {
		t.Fatal("new session inherited time")
	}
	before := session(t, r)
	command(t, r, "replay", "events.replay", nil)
	if session(t, r) != before {
		t.Fatal("rebuild changed session")
	}
	r.Close()
	r = openTest(t, path)
	r.Now = func() time.Time { return now }
	if session(t, r) != before {
		t.Fatal("restart lost session")
	}
}
func TestProjectRemovalAndDryRun(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	registerProject(t, r, "zero")
	command(t, r, "start", "session.start", map[string]any{"project_id": "zero"})
	if _, e := r.Execute(context.Background(), "owner", Request{ID: "remove", Op: "projects.remove", Body: json.RawMessage(`{"id":"zero"}`)}); e == nil {
		t.Fatal("removed active project")
	}
	if _, e := r.Execute(context.Background(), "owner", Request{ID: "dryend", Op: "session.end", Body: json.RawMessage(`{}`), DryRun: true}); e != nil {
		t.Fatal(e)
	}
	if session(t, r).State != "RUNNING" {
		t.Fatal("dry run ended focus")
	}
}
func TestContextOverrideClearAndRebuild(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	registerProject(t, r, "zero")
	command(t, r, "start", "session.start", map[string]any{"project_id": "zero"})
	command(t, r, "assert", "context.assert", map[string]any{"dimension": "attention", "value": "meeting", "expected_revision": 0})
	view, e := r.Context(context.Background())
	if e != nil || view["attention"].Value != "meeting" {
		t.Fatalf("override: %v %v", view, e)
	}
	command(t, r, "clear", "context.clear", map[string]any{"dimension": "attention", "expected_revision": 1})
	view, e = r.Context(context.Background())
	if e != nil || view["attention"].Value != "focused" {
		t.Fatalf("clear: %v %v", view, e)
	}
	command(t, r, "rebuild", "events.replay", nil)
	view, e = r.Context(context.Background())
	if e != nil || view["attention"].Value != "focused" {
		t.Fatal("replay lost context")
	}
}

func TestHybridDisplayNegotiationKeepsLegacyPayload(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	ctx := context.Background()
	r.Enroll(ctx, "old", "a", []string{"display.render"})
	r.Enroll(ctx, "new", "b", []string{"display.render"})
	for _, id := range []string{"old", "new"} {
		command(t, r, "grant-"+id, "grants.set", map[string]any{"principal": "owner", "capability": "display.render", "target": id, "state": "ALWAYS_ALLOWED"})
	}
	if e := r.Advertise(ctx, "new", json.RawMessage(`{"capabilities":["display.render"],"render_schema":"0.2"}`)); e != nil {
		t.Fatal(e)
	}
	command(t, r, "start", "session.start", map[string]any{"project": "Zero"})
	old, _ := r.Pending(ctx, "old")
	newer, _ := r.Pending(ctx, "new")
	if len(old) != 1 || len(newer) != 1 {
		t.Fatal("missing work")
	}
	var a, b map[string]any
	json.Unmarshal(old[0].Input, &a)
	json.Unmarshal(newer[0].Input, &b)
	if _, ok := a["agent"]; ok {
		t.Fatal("legacy payload changed")
	}
	if b["agent"] != "UNAVAILABLE" {
		t.Fatalf("%v", b)
	}
}

func TestContextCompareAndSetRejectsStaleOverride(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	command(t, r, "first", "context.assert", map[string]any{"dimension": "attention", "value": "focused", "expected_revision": 0})
	_, e := r.Execute(context.Background(), "owner", Request{ID: "stale", Op: "context.assert", Body: json.RawMessage(`{"dimension":"attention","value":"meeting","expected_revision":0}`)})
	if e == nil {
		t.Fatal("stale context overwrite succeeded")
	}
	current, _ := r.Context(context.Background())
	if current["attention"].Value != "focused" {
		t.Fatal("rejected change mutated context")
	}
}
