package runtime

import (
	"context"
	"path/filepath"
	"testing"
)

func TestLocalIntentIsReviewableAndResolvesAliases(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	registerProject(t, r, "zero")
	v, e := r.ParseIntent(context.Background(), "work on zero alias")
	if e != nil || v.Operation != "session.start" || v.ProjectID != "zero" || v.ModelUsed {
		t.Fatalf("%+v %v", v, e)
	}
	if session(t, r).State != "IDLE" {
		t.Fatal("parse executed")
	}
	command(t, r, "run", "intent.run", map[string]any{"text": "work on zero alias"})
	if session(t, r).State != "RUNNING" {
		t.Fatal("intent not executed")
	}
	if v, e = r.ParseIntent(context.Background(), "deploy everything"); e != nil || v.Status != "NEEDS_CLARIFICATION" {
		t.Fatalf("%+v %v", v, e)
	}
}
