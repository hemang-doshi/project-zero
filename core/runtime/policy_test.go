package runtime

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
)

func TestDeniedSideEffectLeavesAuditEvidence(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	r.Enroll(context.Background(), "desk", "fp", []string{"display.render"})
	command(t, r, "deny", "grants.set", map[string]any{"principal": "owner", "capability": "display.render", "target": "desk", "state": "DENIED"})
	_, e := r.Execute(context.Background(), "owner", Request{ID: "rejected", Op: "capabilities.invoke", Body: json.RawMessage(`{"node":"desk","capability":"display.render","input":{}}`)})
	if e == nil {
		t.Fatal("denial bypassed")
	}
	rows, e := r.List(context.Background(), "audit")
	if e != nil {
		t.Fatal(e)
	}
	found := false
	for _, v := range rows {
		if v["correlation"] == "rejected" && v["decision"] == "REJECTED" {
			found = true
		}
	}
	if !found {
		t.Fatal("denied side effect not auditable")
	}
}
func TestSessionASKCreatesBoundApproval(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	command(t, r, "grant", "grants.set", map[string]any{"principal": "owner", "capability": "session.start", "target": "runtime", "state": "ASK"})
	v := command(t, r, "start", "session.start", map[string]any{"project": "Zero"})
	if v.Status != "WAITING_APPROVAL" || session(t, r).State != "IDLE" {
		t.Fatal("ASK must not execute")
	}
	command(t, r, "approve", "approvals.approve", map[string]any{"id": "start"})
	if session(t, r).State != "RUNNING" {
		t.Fatal("approved session not executed")
	}
}
