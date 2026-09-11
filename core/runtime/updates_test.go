package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestUpdatesCoalescesDomainsAfterPublish(t *testing.T) {
	u := NewUpdates()
	initial, events, cancel := u.Subscribe()
	defer cancel()
	if initial.Revision != 0 {
		t.Fatal(initial)
	}
	u.Publish("session", "nodes", "session")
	u.Publish("integrations")
	select {
	case event := <-events:
		if !reflect.DeepEqual(event.Domains, []string{"integrations", "nodes", "session"}) || event.Revision != 2 || event.Timestamp.IsZero() {
			t.Fatalf("%+v", event)
		}
		if event.Encoded() != nil {
			t.Fatal("coalesced update kept publish-time bytes")
		}
	case <-time.After(time.Second):
		t.Fatal("missing update")
	}
	select {
	case event := <-events:
		t.Fatalf("uncoalesced update: %+v", event)
	default:
	}
}

func TestUpdatesSharesSerializedEventBytes(t *testing.T) {
	u := NewUpdates()
	first, a, cancelA := u.Subscribe()
	defer cancelA()
	_, b, cancelB := u.Subscribe()
	defer cancelB()
	if first.Encoded() != nil {
		t.Fatal("ready update carries publish bytes")
	}
	u.Publish("nodes")
	var events []Update
	for _, ch := range []<-chan Update{a, b} {
		select {
		case event := <-ch:
			events = append(events, event)
		case <-time.After(time.Second):
			t.Fatal("missing update")
		}
	}
	expected, err := json.Marshal(events[0])
	if err != nil {
		t.Fatal(err)
	}
	if string(events[0].Encoded()) != string(expected) {
		t.Fatalf("shared bytes differ from wire bytes: %s vs %s", events[0].Encoded(), expected)
	}
	if reflect.ValueOf(events[0].Encoded()).Pointer() != reflect.ValueOf(events[1].Encoded()).Pointer() {
		t.Fatal("publish serialized per subscriber instead of sharing bytes")
	}
}

func TestUpdatesSlowSubscribersAndConcurrentCancellation(t *testing.T) {
	u := NewUpdates()
	_, slow, cancelSlow := u.Subscribe()
	defer cancelSlow()
	var wg sync.WaitGroup
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, cancel := u.Subscribe()
			for range 100 {
				u.Publish("nodes")
			}
			cancel()
			cancel()
		}()
	}
	wg.Wait()
	if event := <-slow; event.Revision != 2000 || u.Revision() != 2000 {
		t.Fatal(event)
	}
	cancelSlow()
	if _, ok := <-slow; ok {
		t.Fatal("cancelled subscription left open")
	}
}

func TestExecutePublishesOnlyCommittedUpdate(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	_, events, cancel := r.Updates.Subscribe()
	defer cancel()
	ctx := context.Background()
	if _, err := r.Execute(ctx, "owner", Request{ID: "rejected", Op: "session.pause", Body: json.RawMessage(`{}`)}); err == nil {
		t.Fatal("expected rejection")
	}
	if _, err := r.Execute(ctx, "owner", Request{ID: "dry", Op: "session.start", Body: json.RawMessage(`{"project":"Zero"}`), DryRun: true}); err != nil {
		t.Fatal(err)
	}
	if r.Updates.Revision() != 0 {
		t.Fatal("rejected/dry run published")
	}
	command(t, r, "start", "session.start", map[string]string{"project": "Zero"})
	select {
	case event := <-events:
		if event.Revision != 1 || !slices.Contains(event.Domains, "session") {
			t.Fatal(event)
		}
		if s := session(t, r); s.State != "RUNNING" {
			t.Fatal("published before committed session", s)
		}
	case <-time.After(time.Second):
		t.Fatal("committed session update missing")
	}
	command(t, r, "start", "session.start", map[string]string{"project": "Zero"})
	select {
	case event := <-events:
		t.Fatal("duplicate published", event)
	default:
	}
}

func TestExecuteFailedCommitDoesNotUpdate(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	// A deferred foreign-key violation permits all writes but rejects COMMIT.
	_, err := r.db.Exec(`CREATE TABLE commit_guard(id TEXT REFERENCES commands(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER reject_commit AFTER INSERT ON commands BEGIN INSERT INTO commit_guard VALUES('missing'); END;`)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := r.Execute(context.Background(), "owner", Request{ID: "start", Op: "session.start", Body: json.RawMessage(`{"project":"Zero"}`)}); err == nil {
		t.Fatal("expected failed commit")
	}
	if r.Updates.Revision() != 0 {
		t.Fatal("failed commit published")
	}
}

func TestUpdatesNodeLifecycleAndAutomation(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	ctx := context.Background()
	assertChange := func(domain string, mutation func() error) {
		t.Helper()
		before := r.Updates.Revision()
		_, events, cancel := r.Updates.Subscribe()
		defer cancel()
		if err := mutation(); err != nil {
			t.Fatal(err)
		}
		select {
		case event := <-events:
			if event.Revision != before+1 || !slices.Contains(event.Domains, domain) {
				t.Fatal(event)
			}
		case <-time.After(time.Second):
			t.Fatalf("missing %s update", domain)
		}
	}
	assertChange("nodes", func() error { return r.Enroll(ctx, "desk", "private-fingerprint", []string{"display.render"}) })
	assertChange("nodes", func() error { return r.Seen(ctx, "desk") })
	assertChange("node_profiles", func() error {
		return r.Advertise(ctx, "desk", json.RawMessage(`{"capabilities":["display.render"],"render_schema":"0.2"}`))
	})
	command(t, r, "grant", "grants.set", map[string]string{"principal": "owner", "capability": "display.render", "target": "desk", "state": "ALWAYS_ALLOWED"})
	command(t, r, "render", "capabilities.invoke", map[string]any{"node": "desk", "capability": "display.render", "input": map[string]string{"project": "Zero"}})
	assertChange("invocations", func() error { _, err := r.Pending(ctx, "desk"); return err })
	assertChange("invocations", func() error { return r.Result(ctx, "desk", "render", "SUCCEEDED", json.RawMessage(`{}`)) })
	before := r.Updates.Revision()
	if err := r.Result(ctx, "desk", "render", "SUCCEEDED", json.RawMessage(`{}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Pending(ctx, "desk"); err != nil {
		t.Fatal(err)
	}
	if err := r.Seen(ctx, "missing"); err != nil {
		t.Fatal(err)
	}
	if r.Updates.Revision() != before {
		t.Fatal("no-op node mutation published")
	}
	command(t, r, "policy", "policies.apply", map[string]string{"id": "focus-break"})
	command(t, r, "start", "session.start", map[string]string{"project": "Zero"})
	now := r.Now().Add(46 * time.Minute)
	r.Now = func() time.Time { return now }
	assertChange("firings", func() error { return r.TickAutomations(ctx) })
}

func TestCockpitSnapshotBoundedAndDisplaySafe(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	ctx := context.Background()
	for i := range 120 {
		command(t, r, fmt.Sprintf("state-%03d", i), "state.set", map[string]any{"key": fmt.Sprintf("desk.%03d", i), "value": map[string]string{"secret": "DO-NOT-DISPLAY"}, "expected_revision": 0})
	}
	if err := r.Enroll(ctx, "desk", "DO-NOT-DISPLAY-FINGERPRINT", []string{"display.render"}); err != nil {
		t.Fatal(err)
	}
	command(t, r, "connect", "integrations.connect", map[string]string{"id": "spotify"})
	body, _ := json.Marshal(Integration{ID: "spotify", Status: "ONLINE", ObservedAt: r.Now().UTC(), Data: map[string]string{"track": "Hello\u001b[31m", "token": "DO-NOT-DISPLAY-TOKEN"}})
	if _, err := r.Execute(ctx, "integration:spotify", Request{ID: "observe", Op: "integration.observed", Body: body}); err != nil {
		t.Fatal(err)
	}
	v, err := r.Cockpit(ctx)
	if err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "DO-NOT-DISPLAY") || strings.Contains(string(data), `\u001b`) {
		t.Fatalf("unsafe cockpit: %s", data)
	}
	var decoded struct {
		Revision  uint64          `json:"revision"`
		Events    []any           `json:"events"`
		Audit     []any           `json:"audit"`
		Session   Session         `json:"session"`
		Truncated map[string]bool `json:"truncated"`
	}
	if err = json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	if len(decoded.Events) != 100 || len(decoded.Audit) != 100 || !decoded.Truncated["events"] || !decoded.Truncated["audit"] || decoded.Revision != r.Updates.Revision() || decoded.Session.State != "IDLE" {
		t.Fatalf("%+v", decoded)
	}
}

func TestCockpitSnapshotBoundsUnvalidatedApprovalInput(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	command(t, r, "ask", "grants.set", map[string]string{"principal": "owner", "capability": "session.start", "target": "runtime", "state": "ASK"})
	// ASK records a proposal before the session action validates its field types.
	var nested any = "unvalidated"
	for range 4 {
		nested = map[string]any{"nested": nested}
	}
	command(t, r, "proposal", "session.start", map[string]any{"project": nested})
	snapshot, err := r.Cockpit(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	var value struct {
		Approvals []struct {
			Input   map[string]any `json:"input"`
			Omitted bool           `json:"input_omitted"`
		} `json:"approvals"`
	}
	if err = json.Unmarshal(encoded, &value); err != nil {
		t.Fatal(err)
	}
	if len(value.Approvals) != 1 || !value.Approvals[0].Omitted || value.Approvals[0].Input["project"] != nil {
		t.Fatalf("unvalidated complex input exposed: %s", encoded)
	}
}
