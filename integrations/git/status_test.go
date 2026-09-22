package git

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestStatusIgnoresInheritedRepositoryAndRunsNoFSMonitor(t *testing.T) {
	path := t.TempDir()
	if b, e := exec.Command("git", "init", path).CombinedOutput(); e != nil {
		t.Fatalf("%s %v", b, e)
	}
	t.Setenv("GIT_DIR", "/nonexistent/forbidden-repo")
	if e := os.WriteFile(filepath.Join(path, "new.txt"), []byte("hello"), 0600); e != nil {
		t.Fatal(e)
	}
	state, e := Status(context.Background(), path)
	if e != nil || state["dirty"] != "true" {
		t.Fatalf("%v %v", state, e)
	}
}
