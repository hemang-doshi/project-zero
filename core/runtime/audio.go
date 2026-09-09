package runtime

import (
	"context"
	"encoding/json"
	"io"
	"os/exec"
	"time"
)

type AudioFrame struct {
	Level    uint8     `json:"level"`
	Bass     uint8     `json:"bass"`
	Sequence uint64    `json:"sequence"`
	At       time.Time `json:"-"`
}

func (r *Runtime) setAudio(level, bass uint8, status string) {
	r.audioMu.Lock()
	defer r.audioMu.Unlock()
	r.audio = AudioFrame{level, bass, r.audio.Sequence + 1, r.Now()}
	r.audioStatus = status
}
func (r *Runtime) audioHealth() string {
	r.audioMu.Lock()
	defer r.audioMu.Unlock()
	if r.audioStatus == "" {
		return "DISABLED"
	}
	return r.audioStatus
}

// AudioLevels is transient: no PCM, retry queue, database writes or historical playback.
func (r *Runtime) AudioLevels(ctx context.Context, node string) (AudioFrame, bool) {
	r.audioMu.Lock()
	frame := r.audio
	r.audioMu.Unlock()
	if frame.At.IsZero() || r.Now().Sub(frame.At) > 500*time.Millisecond {
		return frame, false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	tx, e := r.db.BeginTx(ctx, nil)
	if e != nil {
		return frame, false
	}
	defer tx.Rollback()
	var raw []byte
	var profile map[string]string
	if tx.QueryRowContext(ctx, "SELECT e.value FROM entities e JOIN nodes n ON n.id=e.key WHERE e.kind='node_profile' AND e.key=? AND n.revoked=0", node).Scan(&raw) != nil || json.Unmarshal(raw, &profile) != nil || profile["audio"] != "levels-v2" {
		return frame, false
	}
	source, e := readIntegration(ctx, tx, "spotify")
	if e != nil || !source.Enabled {
		return frame, false
	}
	decision, e := r.decision(ctx, tx, "owner", "display.render", node)
	return frame, e == nil && (decision == "ALWAYS_ALLOWED" || decision == "SESSION_ALLOWED")
}
func (r *Runtime) RunAudio(ctx context.Context) {
	if r.MacAudio == "" {
		return
	}
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	var cancel context.CancelFunc
	var done chan struct{}
	retry := time.Time{}
	stop := func() {
		if cancel != nil {
			cancel()
			<-done
			cancel = nil
			done = nil
		}
		r.setAudio(0, 0, "PAUSED")
	}
	defer stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if done != nil {
				select {
				case <-done:
					cancel()
					cancel = nil
					done = nil
					retry = time.Now().Add(30 * time.Second)
					r.setAudio(0, 0, "UNAVAILABLE")
				default:
				}
			}
			integrations, e := r.Integrations(ctx)
			playing := false
			if e == nil {
				for _, integration := range integrations {
					if integration.ID == "spotify" {
						playing = integration.Enabled && integration.Status == "ONLINE" && integration.Data["state"] == "playing"
					}
				}
			}
			if !playing {
				if cancel != nil {
					stop()
				}
				continue
			}
			if cancel != nil || time.Now().Before(retry) {
				continue
			}
			child, childCancel := context.WithCancel(ctx)
			cmd := exec.CommandContext(child, r.MacAudio)
			cmd.WaitDelay = time.Second
			stdout, e := cmd.StdoutPipe()
			if e == nil {
				e = cmd.Start()
			}
			if e != nil {
				childCancel()
				retry = time.Now().Add(30 * time.Second)
				r.setAudio(0, 0, "UNAVAILABLE")
				continue
			}
			cancel = childCancel
			done = make(chan struct{})
			finished := done
			go func() {
				defer close(finished)
				var levels [2]byte
				for {
					if _, err := io.ReadFull(stdout, levels[:]); err != nil {
						break
					}
					r.setAudio(levels[0], levels[1], "ACTIVE")
				}
				_ = cmd.Wait()
			}()
		}
	}
}
