package runtime

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"
)

func TestAudioLevelsRequirePermissionFreshnessAndEnabledSource(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	ctx := context.Background()
	now := time.Now()
	r.Now = func() time.Time { return now }
	r.Enroll(ctx, "desk", "fp", []string{"display.render"})
	r.Advertise(ctx, "desk", json.RawMessage(`{"render_schema":"0.2","audio":"levels-v1","capabilities":["display.render"]}`))
	command(t, r, "spotify-on", "integrations.connect", map[string]string{"id": "spotify"})
	r.setAudio(100, 180, "ACTIVE")
	if _, ok := r.AudioLevels(ctx, "desk"); ok {
		t.Fatal("ungranted audio sent")
	}
	command(t, r, "grant-audio", "grants.set", map[string]string{"principal": "owner", "capability": "display.render", "target": "desk", "state": "ALWAYS_ALLOWED"})
	if _, ok := r.AudioLevels(ctx, "desk"); !ok {
		t.Fatal("fresh authorized audio missing")
	}
	now = now.Add(time.Second)
	if _, ok := r.AudioLevels(ctx, "desk"); ok {
		t.Fatal("stale audio sent")
	}
	r.setAudio(100, 180, "ACTIVE")
	command(t, r, "spotify-off", "integrations.disconnect", map[string]string{"id": "spotify"})
	if _, ok := r.AudioLevels(ctx, "desk"); ok {
		t.Fatal("disabled source sent audio")
	}
}
