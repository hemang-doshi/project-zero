package api

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"projectzero.local/zero/core/runtime"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"
)

func cockpitServer(t *testing.T) (*runtime.Runtime, *http.Server, string) {
	t.Helper()
	dir, err := os.MkdirTemp("/tmp", "zero-cockpit-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	r, err := runtime.Open(filepath.Join(dir, "zero.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { r.Close() })
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	socket := filepath.Join(dir, "zero.sock")
	server, err := ServeUnix(ctx, r, socket, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { server.Close() })
	return r, server, socket
}

func cockpitGET(t *testing.T, socket, path string) (net.Conn, *http.Response) {
	t.Helper()
	conn, err := net.Dial("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	conn.SetDeadline(time.Now().Add(20 * time.Second))
	if _, err = fmt.Fprintf(conn, "GET %s HTTP/1.1\r\nHost: localhost\r\n\r\n", path); err != nil {
		t.Fatal(err)
	}
	response, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatal(err)
	}
	return conn, response
}

func readCockpitEvent(t *testing.T, reader *bufio.Reader) (string, runtime.Update) {
	t.Helper()
	name := ""
	data := ""
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		line = strings.TrimSuffix(line, "\n")
		if line == "" {
			break
		}
		if strings.HasPrefix(line, "event: ") {
			name = strings.TrimPrefix(line, "event: ")
		}
		if strings.HasPrefix(line, "data: ") {
			data = strings.TrimPrefix(line, "data: ")
		}
	}
	var update runtime.Update
	if err := json.Unmarshal([]byte(data), &update); err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal([]byte(data), &fields); err != nil {
		t.Fatal(err)
	}
	if len(fields) != 3 || fields["revision"] == nil || fields["domains"] == nil || fields["timestamp"] == nil {
		t.Fatalf("unexpected payload: %s", data)
	}
	return name, update
}

func TestCockpitStreamSharesEventBytesAcrossConnections(t *testing.T) {
	r, _, socket := cockpitServer(t)
	open := func() (net.Conn, *bufio.Reader) {
		t.Helper()
		conn, response := cockpitGET(t, socket, "/v0.1/cockpit/stream")
		if response.StatusCode != 200 {
			t.Fatal(response.Status)
		}
		reader := bufio.NewReader(response.Body)
		if name, _ := readCockpitEvent(t, reader); name != "ready" {
			t.Fatalf("expected ready, got %s", name)
		}
		return conn, reader
	}
	connA, readerA := open()
	defer connA.Close()
	connB, readerB := open()
	defer connB.Close()
	if _, err := r.Execute(context.Background(), "owner", runtime.Request{ID: "start", Op: "session.start", Body: json.RawMessage(`{"project":"Zero"}`)}); err != nil {
		t.Fatal(err)
	}
	nameA, eventA := readCockpitEvent(t, readerA)
	nameB, eventB := readCockpitEvent(t, readerB)
	if nameA != "runtime.changed" || nameB != "runtime.changed" || !reflect.DeepEqual(eventA, eventB) {
		t.Fatalf("%s %+v / %s %+v", nameA, eventA, nameB, eventB)
	}
}

func TestCockpitSnapshotCacheReplaysBytesPerRevision(t *testing.T) {
	r, _, socket := cockpitServer(t)
	ctx := context.Background()
	if _, err := r.Execute(ctx, "owner", runtime.Request{ID: "start", Op: "session.start", Body: json.RawMessage(`{"project":"Zero"}`)}); err != nil {
		t.Fatal(err)
	}
	_, first := cockpitGET(t, socket, "/v0.1/cockpit")
	defer first.Body.Close()
	if first.Header.Get("Content-Type") != "application/json" {
		t.Fatal(first.Header)
	}
	one, err := io.ReadAll(first.Body)
	if err != nil {
		t.Fatal(err)
	}
	if len(one) == 0 || one[len(one)-1] != '\n' {
		t.Fatal("snapshot body lost the encoder's trailing newline")
	}
	_, replay := cockpitGET(t, socket, "/v0.1/cockpit")
	defer replay.Body.Close()
	two, err := io.ReadAll(replay.Body)
	if err != nil {
		t.Fatal(err)
	}
	if string(two) != string(one) {
		t.Fatal("same-revision GET did not replay cached bytes")
	}
	if _, err = r.Execute(ctx, "owner", runtime.Request{ID: "state", Op: "state.set", Body: json.RawMessage(`{"key":"desk.cache","value":"invalidated"}`)}); err != nil {
		t.Fatal(err)
	}
	_, third := cockpitGET(t, socket, "/v0.1/cockpit")
	defer third.Body.Close()
	three, err := io.ReadAll(third.Body)
	if err != nil {
		t.Fatal(err)
	}
	if string(three) == string(one) {
		t.Fatal("new revision served stale cached bytes")
	}
	var value struct {
		Revision uint64 `json:"revision"`
	}
	if err = json.Unmarshal(three, &value); err != nil {
		t.Fatal(err)
	}
	if value.Revision != r.Updates.Revision() {
		t.Fatalf("snapshot revision %d != runtime revision %d", value.Revision, r.Updates.Revision())
	}
}

func TestCockpitStreamSendsCommittedSessionChange(t *testing.T) {
	r, server, socket := cockpitServer(t)
	if server.WriteTimeout != 10*time.Second || server.ReadTimeout != 10*time.Second {
		t.Fatal("global safety deadlines changed")
	}
	info, err := os.Stat(socket)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("socket permissions: %v %v", info, err)
	}
	conn, response := cockpitGET(t, socket, "/v0.1/cockpit/stream")
	if response.StatusCode != 200 || response.Header.Get("Content-Type") != "text/event-stream" {
		t.Fatalf("unexpected response: %v", response)
	}
	reader := bufio.NewReader(response.Body)
	name, ready := readCockpitEvent(t, reader)
	if name != "ready" || ready.Revision != 0 {
		t.Fatalf("%s %+v", name, ready)
	}
	ctx := context.Background()
	if _, err = r.Execute(ctx, "owner", runtime.Request{ID: "reject", Op: "session.pause", Body: json.RawMessage(`{}`)}); err == nil {
		t.Fatal("expected rejection")
	}
	if _, err = r.Execute(ctx, "owner", runtime.Request{ID: "dry", Op: "session.start", Body: json.RawMessage(`{"project":"Zero"}`), DryRun: true}); err != nil {
		t.Fatal(err)
	}
	request := runtime.Request{ID: "start", Op: "session.start", Body: json.RawMessage(`{"project":"Zero"}`)}
	if _, err = r.Execute(ctx, "owner", request); err != nil {
		t.Fatal(err)
	}
	name, changed := readCockpitEvent(t, reader)
	if name != "runtime.changed" || changed.Revision != 1 || !slices.Contains(changed.Domains, "session") {
		t.Fatalf("%s %+v", name, changed)
	}
	if _, err = r.Execute(ctx, "owner", request); err != nil {
		t.Fatal(err)
	}
	// The first keepalive is beyond the ordinary 10-second response deadline.
	// Any rejected/dry-run/duplicate publication would arrive here instead.
	name, keepalive := readCockpitEvent(t, reader)
	if name != "keepalive" || keepalive.Revision != 1 {
		t.Fatalf("%s %+v", name, keepalive)
	}
	conn.Close()
	shutdownCtx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	if err = server.Shutdown(shutdownCtx); err != nil {
		t.Fatalf("stream handler did not exit on disconnect: %v", err)
	}
}

func TestCockpitSnapshotUnixEndpoint(t *testing.T) {
	r, _, socket := cockpitServer(t)
	if _, err := r.Execute(context.Background(), "owner", runtime.Request{ID: "start", Op: "session.start", Body: json.RawMessage(`{"project":"Zero"}`)}); err != nil {
		t.Fatal(err)
	}
	_, response := cockpitGET(t, socket, "/v0.1/cockpit")
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal(response.Status)
	}
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]json.RawMessage
	if err = json.Unmarshal(data, &value); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"revision", "release", "status", "session", "projects", "integrations", "policies", "context", "nodes", "node_profiles", "approvals", "firings", "invocations", "events", "audit", "truncated"} {
		if _, ok := value[key]; !ok {
			t.Fatalf("missing %s", key)
		}
	}
	var session runtime.Session
	if err = json.Unmarshal(value["session"], &session); err != nil || session.State != "RUNNING" {
		t.Fatalf("%+v %v", session, err)
	}
}
