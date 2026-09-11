package runtime

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"maps"
	"os/exec"
	"projectzero.local/zero/core/protocol"
	gitadapter "projectzero.local/zero/integrations/git"
	"strings"
	"time"
)

type Integration struct {
	ID         string            `json:"id"`
	Enabled    bool              `json:"enabled"`
	Status     string            `json:"status"`
	ProjectID  string            `json:"project_id,omitempty"`
	ObservedAt time.Time         `json:"observed_at"`
	Data       map[string]string `json:"data,omitempty"`
	Message    string            `json:"message,omitempty"`
}

func readIntegration(ctx context.Context, tx *sql.Tx, id string) (Integration, error) {
	v := Integration{ID: id, Status: "DISCONNECTED"}
	var b []byte
	e := tx.QueryRowContext(ctx, "SELECT value FROM entities WHERE kind='integration' AND key=?", id).Scan(&b)
	if e == sql.ErrNoRows {
		return v, nil
	}
	if e != nil {
		return v, e
	}
	e = json.Unmarshal(b, &v)
	return v, e
}
func (r *Runtime) integrationAction(ctx context.Context, tx *sql.Tx, q Request, v *Response) error {
	var b Integration
	if e := json.Unmarshal(q.Body, &b); e != nil {
		return e
	}
	if b.ID != "git" && b.ID != "spotify" && b.ID != "codex" {
		return fmt.Errorf("VALIDATION: unknown integration")
	}
	old, e := readIntegration(ctx, tx, b.ID)
	if e != nil {
		return e
	}
	switch q.Op {
	case "integrations.connect":
		if b.ID == "codex" {
			return fmt.Errorf("VALIDATION: Codex desktop observation unavailable; hook compatibility unproven")
		}
		old.Enabled = true
		old.Status = "PENDING"
		old.Message = ""
	case "integrations.disconnect":
		old.Enabled = false
		old.Status = "DISCONNECTED"
		old.Data = nil
	case "integration.observed":
		if !old.Enabled {
			return fmt.Errorf("AUTHORIZATION: integration disconnected")
		}
		if b.Status != "ONLINE" && b.Status != "UNAVAILABLE" && b.Status != "IDLE" {
			return fmt.Errorf("VALIDATION: observation status")
		}
		if b.ObservedAt.After(r.Now().Add(time.Second)) || r.Now().Sub(b.ObservedAt) > time.Minute {
			return fmt.Errorf("VALIDATION: observation timestamp")
		}
		if !old.ObservedAt.IsZero() && !b.ObservedAt.After(old.ObservedAt) {
			return fmt.Errorf("CONFLICT: old observation")
		}
		if len(b.Data) > 8 {
			return fmt.Errorf("VALIDATION: observation fields")
		}
		for k, val := range b.Data {
			if k == "artwork_rgb565" && b.ID == "spotify" {
				if !validArtwork(val) {
					return fmt.Errorf("VALIDATION: artwork bounds")
				}
				continue
			}
			if len(k) > 32 || len(val) > 256 {
				return fmt.Errorf("VALIDATION: observation bounds")
			}
		}
		if b.ID == "git" {
			s, e := readSession(ctx, tx)
			if e != nil {
				return e
			}
			if s.ProjectID != b.ProjectID {
				return fmt.Errorf("CONFLICT: focus project changed")
			}
		}
		if image := b.Data["artwork_rgb565"]; image != "" {
			digest := hash(image)
			var exists int
			if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM entities WHERE kind='artwork' AND key=?", digest).Scan(&exists); err != nil {
				return err
			}
			if exists == 0 {
				if err := saveEntity(ctx, tx, q.ID+":art", "artwork", digest, map[string]string{"rgb565": image}, r.Now()); err != nil {
					return err
				}
			}
			delete(b.Data, "artwork_rgb565")
			b.Data["artwork_id"] = digest
		}
		old = b
		old.Enabled = true
	default:
		return fmt.Errorf("VALIDATION: integration action")
	}
	if b.ID == "spotify" {
		expiry := r.Now().Add(10 * time.Second)
		f := Fact{Dimension: "media", Value: old.Data["state"], Source: "integration:spotify", Evidence: q.ID, ObservedAt: r.Now().UTC(), ExpiresAt: &expiry, Classification: "PRIVATE", Cleared: !old.Enabled || old.Status != "ONLINE"}
		revision, err := factRevision(ctx, tx, "media:integration:spotify")
		if err != nil {
			return err
		}
		f.Revision = revision + 1
		if e = saveEntity(ctx, tx, q.ID+":media", "context", "media:integration:spotify", f, r.Now()); e != nil {
			return e
		}
	}
	v.Data = old
	if e = saveEntity(ctx, tx, q.ID, "integration", b.ID, old, r.Now()); e != nil {
		return e
	}
	if q.Op == "integration.observed" || q.Op == "integrations.disconnect" {
		s, e := readSession(ctx, tx)
		if e != nil {
			return e
		}
		return r.queueSession(ctx, tx, q.ID, s)
	}
	return nil
}
func (r *Runtime) Integrations(ctx context.Context) ([]Integration, error) {
	tx, e := r.db.BeginTx(ctx, nil)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	out := []Integration{}
	for _, id := range []string{"git", "spotify", "codex"} {
		v, e := readIntegration(ctx, tx, id)
		if e != nil {
			return nil, e
		}
		if id == "spotify" {
			if v.Data == nil {
				v.Data = map[string]string{}
			}
			v.Data["audio_capture"] = r.audioHealth()
		}
		if id == "codex" {
			v.Status = "UNAVAILABLE"
			v.Message = "Desktop observation not connected"
		}
		age := 45 * time.Second
		if id == "spotify" {
			age = 10 * time.Second
		}
		if v.Enabled && v.Status == "ONLINE" && r.Now().Sub(v.ObservedAt) > age {
			v.Status = "STALE"
		}
		out = append(out, v)
	}
	return out, nil
}

type smallBuffer struct{ bytes.Buffer }

func (b *smallBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 4096 {
		return 0, fmt.Errorf("adapter output limit")
	}
	return b.Buffer.Write(p)
}
func (r *Runtime) SyncIntegration(ctx context.Context, id string) error {
	all, e := r.Integrations(ctx)
	if e != nil {
		return e
	}
	enabled := false
	var stored Integration
	for _, v := range all {
		if v.ID == id {
			enabled = v.Enabled
			stored = v
		}
	}
	if !enabled {
		return fmt.Errorf("AUTHORIZATION: integration disabled")
	}
	stamp := r.Now().UTC()
	v := Integration{ID: id, Enabled: true, Status: "ONLINE", ObservedAt: stamp}
	switch id {
	case "git":
		s, e := r.Session(ctx)
		if e != nil {
			return e
		}
		v.ProjectID = s.ProjectID
		if s.ProjectID == "" || s.State != "RUNNING" {
			v.Status = "IDLE"
			break
		}
		ps, e := r.Projects(ctx)
		if e != nil {
			return e
		}
		path := ""
		for _, p := range ps {
			if p.ID == s.ProjectID {
				path = p.Path
			}
		}
		if path == "" {
			return fmt.Errorf("VALIDATION: project unavailable")
		}
		v.Data, e = gitadapter.Status(ctx, path)
		if e != nil {
			v.Status = "UNAVAILABLE"
			v.Message = e.Error()
		}
	case "spotify":
		if r.MacObserver == "" {
			v.Status = "UNAVAILABLE"
			v.Message = "Native Spotify helper not configured"
			break
		}
		child, cancel := context.WithTimeout(ctx, 3*time.Second)
		defer cancel()
		cmd := exec.CommandContext(child, r.MacObserver, "spotify")
		var out smallBuffer
		cmd.Stdout = &out
		cmd.Stderr = &smallBuffer{}
		if e = cmd.Run(); e != nil {
			v.Status = "UNAVAILABLE"
			v.Message = "Spotify permission or adapter unavailable"
		} else if e = json.Unmarshal(out.Bytes(), &v.Data); e != nil {
			v.Status = "UNAVAILABLE"
			v.Message = "Invalid adapter output"
		} else if v.Data["state"] == "not_running" {
			v.Status = "IDLE"
		}
	default:
		return fmt.Errorf("VALIDATION: integration unavailable")
	}
	// The poll cadence stays fixed, but a byte-identical observation must not
	// commit: the entity/event/audit/invocation cascade plus the revision bump
	// invalidates the snapshot cache and wakes every UI for zero new content.
	// Liveness still advances via a single unpublished row touch so the
	// ONLINE/STALE derivation keeps reading a fresh timestamp.
	if sameObservation(stored, v) {
		if e := r.touchIntegrationObserved(ctx, id, stamp); e != nil {
			return e
		}
		// A steady UNAVAILABLE keeps the old SyncIntegration contract: the
		// manual sync endpoint still reports the outage even though nothing
		// new was committed.
		if v.Status == "UNAVAILABLE" {
			return fmt.Errorf("UNAVAILABLE: %s", v.Message)
		}
		return nil
	}
	b, _ := json.Marshal(v)
	_, e = r.Execute(ctx, "integration:"+id, Request{ID: protocol.ID(), Op: "integration.observed", Body: b})
	if e == nil && v.Status == "UNAVAILABLE" {
		return fmt.Errorf("UNAVAILABLE: %s", v.Message)
	}
	return e
}

// sameObservation reports whether a fresh poll carries any display-relevant
// change over the stored integration. ObservedAt always differs and is
// excluded; audio_capture is an in-memory overlay, never committed state;
// re-sent artwork bytes are hashed back to the stored content digest.
func sameObservation(stored, fresh Integration) bool {
	if stored.Status != fresh.Status || stored.Message != fresh.Message || stored.ProjectID != fresh.ProjectID {
		return false
	}
	oldData := maps.Clone(stored.Data)
	newData := maps.Clone(fresh.Data)
	delete(oldData, "audio_capture")
	delete(newData, "audio_capture")
	if image, ok := newData["artwork_rgb565"]; ok {
		if !validArtwork(image) {
			return false
		}
		if oldData["artwork_id"] != hash(image) {
			return false
		}
		delete(oldData, "artwork_id")
		delete(newData, "artwork_rgb565")
	}
	return maps.Equal(oldData, newData)
}

// touchIntegrationObserved refreshes only the stored observation timestamp.
// It writes one indexed row, inserts no events/audit/invocations, queues no
// display work, and publishes no revision: every display-relevant field is
// already identical, so cached snapshots and quiet subscribers stay correct
// while the next rebuild still derives ONLINE from a fresh timestamp.
func (r *Runtime) touchIntegrationObserved(ctx context.Context, id string, at time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	tx, e := r.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var raw []byte
	if e = tx.QueryRowContext(ctx, "SELECT value FROM entities WHERE kind='integration' AND key=?", id).Scan(&raw); e != nil {
		return e
	}
	var stored Integration
	if e = json.Unmarshal(raw, &stored); e != nil {
		return e
	}
	stored.ObservedAt = at
	b, e := json.Marshal(stored)
	if e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, "UPDATE entities SET value=? WHERE kind='integration' AND key=?", b, id); e != nil {
		return e
	}
	return tx.Commit()
}
func (r *Runtime) RunIntegrations(ctx context.Context) {
	jobs := []periodicWorker{
		{time.Second, func(ctx context.Context) { _ = r.TickAutomations(ctx) }},
		{2 * time.Second, func(ctx context.Context) { _ = r.SyncIntegration(ctx, "spotify") }},
		{15 * time.Second, func(ctx context.Context) {
			policies, _ := r.Policies(ctx)
			for _, p := range policies {
				if p.ID == "git-refresh" && p.Enabled {
					s, _ := r.Session(ctx)
					if s.State == "RUNNING" && s.ProjectID != "" {
						result := r.SyncIntegration(ctx, "git")
						r.recordGitFiring(ctx, result)
					}
				}
			}
		}},
	}
	runWorkers(ctx, jobs)
}
func integrationPrincipal(p string) string { return strings.TrimPrefix(p, "integration:") }

func validArtwork(encoded string) bool {
	if encoded == "" {
		return true
	}
	if len(encoded) != 2732 {
		return false
	}
	pixels, err := base64.StdEncoding.Strict().DecodeString(encoded)
	return err == nil && len(pixels) == 2048
}
