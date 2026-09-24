package integration

import (
	"context"
	"encoding/json"
	"path/filepath"
	"projectzero.local/zero/core/api"
	"projectzero.local/zero/core/runtime"
	"projectzero.local/zero/sdk/go/client"
	"testing"
)

func TestUnixAPIAndRestart(t *testing.T) {
	dir := t.TempDir()
	r, e := runtime.Open(filepath.Join(dir, "zero.db"))
	if e != nil {
		t.Fatal(e)
	}
	defer r.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sock := filepath.Join(dir, "api.sock")
	srv, e := api.ServeUnix(ctx, r, sock, nil)
	if e != nil {
		t.Fatal(e)
	}
	defer srv.Close()
	c := client.New(sock)
	var status map[string]any
	if e = c.Get(ctx, "status", &status); e != nil {
		t.Fatal(e)
	}
	if status["version"] != "0.1" {
		t.Fatalf("%v", status)
	}
	_, e = c.Execute(ctx, runtime.Request{ID: "first", Op: "session.start", Body: json.RawMessage(`{"project":"Project Zero"}`)})
	if e != nil {
		t.Fatal(e)
	}
	var s runtime.Session
	if e = c.Get(ctx, "session", &s); e != nil || s.Project != "Project Zero" || s.State != "RUNNING" {
		t.Fatalf("%+v %v", s, e)
	}
}
