package runtime

import (
	"context"
	"path/filepath"
	"testing"
)

func TestAuditDetectsTampering(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	command(t, r, "start", "session.start", map[string]any{"project": "Zero"})
	if e := r.VerifyAudit(context.Background()); e != nil {
		t.Fatal(e)
	}
	r.db.Exec("UPDATE audit_entries SET decision='DENIED' WHERE seq=1")
	if e := r.VerifyAudit(context.Background()); e == nil {
		t.Fatal("audit tampering undetected")
	}
}
