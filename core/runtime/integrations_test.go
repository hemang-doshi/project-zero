package runtime

import (
	"context"
	"encoding/json"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestGitObservationScopedAndRevoked(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	path := t.TempDir()
	if out, e := exec.Command("git", "init", path).CombinedOutput(); e != nil {
		t.Fatalf("%s %v", out, e)
	}
	command(t, r, "project", "projects.add", map[string]any{"id": "zero", "name": "Zero", "path": path})
	command(t, r, "start", "session.start", map[string]any{"project_id": "zero"})
	command(t, r, "connect", "integrations.connect", map[string]any{"id": "git"})
	if e := r.SyncIntegration(context.Background(), "git"); e != nil {
		t.Fatal(e)
	}
	views, e := r.Integrations(context.Background())
	if e != nil || views[0].Status != "ONLINE" {
		t.Fatalf("%+v %v", views, e)
	}
	command(t, r, "disconnect", "integrations.disconnect", map[string]any{"id": "git"})
	_, e = r.Execute(context.Background(), "integration:git", Request{ID: "late", Op: "integration.observed", Body: json.RawMessage(`{"id":"git","status":"ONLINE"}`)})
	if e == nil {
		t.Fatal("revoked integration accepted observation")
	}
	_, e = r.Execute(context.Background(), "integration:git", Request{ID: "escape", Op: "session.pause", Body: json.RawMessage(`{}`)})
	if e == nil {
		t.Fatal("integration impersonated owner")
	}
}
