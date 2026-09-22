package runtime

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
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

// spotifyStub writes an executable shell stub that prints canned helper JSON.
func spotifyStub(t *testing.T, payload string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "observer.sh")
	script := "#!/bin/sh\nprintf '%s' '" + payload + "'\n"
	if e := os.WriteFile(path, []byte(script), 0700); e != nil {
		t.Fatal(e)
	}
	return path
}

func countKind(t *testing.T, r *Runtime, kind string) int {
	t.Helper()
	rows, e := r.List(context.Background(), kind)
	if e != nil {
		t.Fatal(e)
	}
	return len(rows)
}

func storedSpotify(t *testing.T, r *Runtime) Integration {
	t.Helper()
	views, e := r.Integrations(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	for _, v := range views {
		if v.ID == "spotify" {
			return v
		}
	}
	t.Fatal("spotify integration missing")
	return Integration{}
}

// Redundant 2s polls must not commit: identical observations refresh liveness
// without a revision bump, audit row, or new invocation.
func TestSyncIntegrationSkipsUnchangedObservation(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	now := time.Date(2026, 9, 11, 12, 0, 0, 0, time.UTC)
	r.Now = func() time.Time { return now }
	ctx := context.Background()
	command(t, r, "connect", "integrations.connect", map[string]string{"id": "spotify"})
	r.MacObserver = spotifyStub(t, `{"state":"paused","track":"Example Track","artist":"Example Artist"}`)
	if e := r.SyncIntegration(ctx, "spotify"); e != nil {
		t.Fatal(e)
	}
	rev1 := r.Updates.Revision()
	audit1 := countKind(t, r, "audit")
	inv1 := countKind(t, r, "invocations")
	now = now.Add(2 * time.Second)
	if e := r.SyncIntegration(ctx, "spotify"); e != nil {
		t.Fatal(e)
	}
	if rev := r.Updates.Revision(); rev != rev1 {
		t.Fatalf("unchanged observation bumped revision %d -> %d", rev1, rev)
	}
	if n := countKind(t, r, "audit"); n != audit1 {
		t.Fatalf("unchanged observation added audit rows %d -> %d", audit1, n)
	}
	if n := countKind(t, r, "invocations"); n != inv1 {
		t.Fatalf("unchanged observation queued invocations %d -> %d", inv1, n)
	}
	if got := storedSpotify(t, r); !got.ObservedAt.Equal(now.UTC()) {
		t.Fatalf("heartbeat did not refresh liveness: %v vs %v", got.ObservedAt, now.UTC())
	}
	if got := storedSpotify(t, r); got.Status != "ONLINE" {
		t.Fatalf("heartbeat changed status: %+v", got)
	}
}

// Changed observations must still commit with full freshness.
func TestSyncIntegrationCommitsChangedObservation(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	now := time.Date(2026, 9, 11, 12, 0, 0, 0, time.UTC)
	r.Now = func() time.Time { return now }
	ctx := context.Background()
	command(t, r, "connect", "integrations.connect", map[string]string{"id": "spotify"})
	path := filepath.Join(t.TempDir(), "observer.sh")
	write := func(payload string) {
		t.Helper()
		if e := os.WriteFile(path, []byte("#!/bin/sh\nprintf '%s' '"+payload+"'\n"), 0700); e != nil {
			t.Fatal(e)
		}
	}
	write(`{"state":"paused","track":"Example Track","artist":"Example Artist"}`)
	r.MacObserver = path
	if e := r.SyncIntegration(ctx, "spotify"); e != nil {
		t.Fatal(e)
	}
	rev1 := r.Updates.Revision()
	now = now.Add(2 * time.Second)
	write(`{"state":"playing","track":"New Track","artist":"Example Artist"}`)
	if e := r.SyncIntegration(ctx, "spotify"); e != nil {
		t.Fatal(e)
	}
	if rev := r.Updates.Revision(); rev == rev1 {
		t.Fatal("changed observation did not bump revision")
	}
	if got := storedSpotify(t, r); got.Data["track"] != "New Track" || got.Data["state"] != "playing" {
		t.Fatalf("changed observation not stored: %+v", got.Data)
	}
}

// Re-sent artwork bytes hash to the stored digest and must not rewrite blobs.
func TestSyncIntegrationIdenticalArtworkSkipsRewrite(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	now := time.Date(2026, 9, 11, 12, 0, 0, 0, time.UTC)
	r.Now = func() time.Time { return now }
	ctx := context.Background()
	command(t, r, "connect", "integrations.connect", map[string]string{"id": "spotify"})
	pixels := make([]byte, 2048)
	pixels[0] = 0xF8
	pixels[2046] = 0x1F
	image := base64.StdEncoding.EncodeToString(pixels)
	observed, _ := json.Marshal(Integration{ID: "spotify", Status: "ONLINE", ObservedAt: now.UTC(), Data: map[string]string{"state": "paused", "track": "T", "artist": "A", "artwork_rgb565": image}})
	if _, err := r.Execute(ctx, "integration:spotify", Request{ID: "observe", Op: "integration.observed", Body: observed}); err != nil {
		t.Fatal(err)
	}
	rev1 := r.Updates.Revision()
	r.MacObserver = spotifyStub(t, `{"state":"paused","track":"T","artist":"A","artwork_rgb565":"`+image+`"}`)
	now = now.Add(2 * time.Second)
	if e := r.SyncIntegration(ctx, "spotify"); e != nil {
		t.Fatal(e)
	}
	if rev := r.Updates.Revision(); rev != rev1 {
		t.Fatalf("identical artwork observation bumped revision %d -> %d", rev1, rev)
	}
	if got := storedSpotify(t, r); got.Data["artwork_id"] == "" {
		t.Fatalf("artwork digest lost: %+v", got.Data)
	}
}

func TestSameObservationNormalizesArtworkAndAudioCapture(t *testing.T) {
	pixels := make([]byte, 2048)
	pixels[0] = 0xF8
	image := base64.StdEncoding.EncodeToString(pixels)
	digest := hash(image)
	stored := Integration{ID: "spotify", Enabled: true, Status: "ONLINE", Data: map[string]string{"state": "paused", "artwork_id": digest, "audio_capture": "ACTIVE"}}
	fresh := Integration{ID: "spotify", Enabled: true, Status: "ONLINE", Data: map[string]string{"state": "paused", "artwork_rgb565": image}}
	if !sameObservation(stored, fresh) {
		t.Fatal("identical artwork + audio_capture overlay not recognized as same")
	}
	fresh.Data["state"] = "playing"
	if sameObservation(stored, fresh) {
		t.Fatal("changed state recognized as same")
	}
}

// Steady git-refresh outcomes must not append a firing per 15s poll.
func TestRecordGitFiringSkipsRepeatedSuccess(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	ctx := context.Background()
	command(t, r, "policy", "policies.apply", map[string]string{"id": "git-refresh"})
	r.recordGitFiring(ctx, nil)
	n1 := countKind(t, r, "firings")
	if n1 != 1 {
		t.Fatalf("first success recorded %d firings", n1)
	}
	rev1 := r.Updates.Revision()
	r.recordGitFiring(ctx, nil)
	if n := countKind(t, r, "firings"); n != n1 {
		t.Fatalf("repeated success recorded firing %d -> %d", n1, n)
	}
	if rev := r.Updates.Revision(); rev != rev1 {
		t.Fatalf("repeated success bumped revision %d -> %d", rev1, rev)
	}
	r.recordGitFiring(ctx, context.DeadlineExceeded)
	if n := countKind(t, r, "firings"); n != n1+1 {
		t.Fatalf("failure transition not recorded: %d", n)
	}
	r.recordGitFiring(ctx, context.DeadlineExceeded)
	if n := countKind(t, r, "firings"); n != n1+1 {
		t.Fatalf("repeated failure recorded firing: %d", n)
	}
	r.recordGitFiring(ctx, nil)
	if n := countKind(t, r, "firings"); n != n1+2 {
		t.Fatalf("recovery transition not recorded: %d", n)
	}
}

// A steady UNAVAILABLE keeps the old SyncIntegration contract: the manual
// sync endpoint still reports the outage even though nothing new is
// committed.
func TestSyncIntegrationSteadyUnavailableKeepsError(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	ctx := context.Background()
	command(t, r, "connect", "integrations.connect", map[string]string{"id": "spotify"})
	r.MacObserver = ""
	if e := r.SyncIntegration(ctx, "spotify"); e == nil || !strings.Contains(e.Error(), "UNAVAILABLE") {
		t.Fatalf("first outage did not error: %v", e)
	}
	rev1 := r.Updates.Revision()
	if e := r.SyncIntegration(ctx, "spotify"); e == nil || !strings.Contains(e.Error(), "UNAVAILABLE") {
		t.Fatalf("steady outage stopped erroring: %v", e)
	}
	if rev := r.Updates.Revision(); rev != rev1 {
		t.Fatalf("steady outage committed %d -> %d", rev1, rev)
	}
}
