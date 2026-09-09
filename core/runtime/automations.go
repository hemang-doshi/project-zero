package runtime

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"projectzero.local/zero/core/protocol"
	"time"
)

type Policy struct {
	ID      string `json:"id"`
	Enabled bool   `json:"enabled"`
	Status  string `json:"status"`
}
type Firing struct {
	ID        string    `json:"id"`
	Policy    string    `json:"policy"`
	SessionID string    `json:"session_id"`
	At        time.Time `json:"at"`
	Message   string    `json:"message"`
	Review    string    `json:"review"`
	State     string    `json:"state"`
}

func policyEnabled(ctx context.Context, tx *sql.Tx, id string) bool {
	var b []byte
	var p Policy
	return tx.QueryRowContext(ctx, "SELECT value FROM entities WHERE kind='policy' AND key=?", id).Scan(&b) == nil && json.Unmarshal(b, &p) == nil && p.Enabled
}
func (r *Runtime) policyAction(ctx context.Context, tx *sql.Tx, q Request, v *Response) error {
	var b struct {
		ID     string `json:"id"`
		Review string `json:"review"`
	}
	if e := json.Unmarshal(q.Body, &b); e != nil {
		return e
	}
	if q.Op == "policies.review" {
		var data []byte
		var f Firing
		if e := tx.QueryRowContext(ctx, "SELECT value FROM entities WHERE kind='firing' AND key=?", b.ID).Scan(&data); e != nil {
			return fmt.Errorf("VALIDATION: firing not found")
		}
		if e := json.Unmarshal(data, &f); e != nil {
			return e
		}
		if b.Review != "correct" && b.Review != "incorrect" && b.Review != "unreviewed" {
			return fmt.Errorf("VALIDATION: review value")
		}
		f.Review = b.Review
		f.State = "REVIEWED"
		return saveEntity(ctx, tx, q.ID, "firing", b.ID, f, r.Now())
	}
	if b.ID != "git-refresh" && b.ID != "focus-break" && b.ID != "codex-completion" {
		return fmt.Errorf("VALIDATION: unknown policy")
	}
	if b.ID == "codex-completion" && q.Op == "policies.apply" {
		return fmt.Errorf("VALIDATION: Codex observation unavailable")
	}
	p := Policy{ID: b.ID, Enabled: q.Op == "policies.apply", Status: "READY"}
	if !p.Enabled {
		p.Status = "DISABLED"
	}
	v.Data = p
	if e := saveEntity(ctx, tx, q.ID, "policy", b.ID, p, r.Now()); e != nil {
		return e
	}
	if !p.Enabled {
		rows, e := tx.QueryContext(ctx, `SELECT value FROM entities WHERE kind='firing' AND json_extract(value,'$.policy')=? AND json_extract(value,'$.state')='PENDING'`, b.ID)
		if e != nil {
			return e
		}
		var pending []Firing
		for rows.Next() {
			var data []byte
			var f Firing
			if e = rows.Scan(&data); e != nil {
				rows.Close()
				return e
			}
			if e = json.Unmarshal(data, &f); e != nil {
				rows.Close()
				return e
			}
			pending = append(pending, f)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return e
		}
		for _, f := range pending {
			f.State = "CANCELLED"
			if e = saveEntity(ctx, tx, q.ID+":"+f.ID, "firing", f.ID, f, r.Now()); e != nil {
				return e
			}
		}
	}

	return nil
}
func (r *Runtime) Policies(ctx context.Context) ([]Policy, error) {
	tx, e := r.db.BeginTx(ctx, nil)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	out := []Policy{}
	for _, id := range []string{"git-refresh", "focus-break", "codex-completion"} {
		p := Policy{ID: id, Enabled: policyEnabled(ctx, tx, id), Status: "READY"}
		if !p.Enabled {
			p.Status = "DISABLED"
		}
		if id == "codex-completion" {
			p.Status = "UNAVAILABLE"
		}
		out = append(out, p)
	}
	return out, nil
}
func (r *Runtime) TickAutomations(ctx context.Context) error {
	r.mu.Lock()
	committed := false
	defer r.unlockAndPublish(&committed, "firings", "events", "audit")
	tx, e := r.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if !policyEnabled(ctx, tx, "focus-break") {
		return nil
	}
	s, e := readSession(ctx, tx)
	if e != nil {
		return e
	}
	if s.State != "RUNNING" {
		return nil
	}
	elapsed := s.ElapsedMS + max(0, r.Now().UnixMilli()-s.SinceMS)
	bucket := elapsed / (45 * 60 * 1000)
	if bucket == 0 {
		return nil
	}
	id := fmt.Sprintf("break:%s:%d", s.ID, bucket)
	var exists int
	if e = tx.QueryRowContext(ctx, "SELECT count(*) FROM entities WHERE kind='firing' AND key=?", id).Scan(&exists); e != nil {
		return e
	}
	if exists > 0 {
		return nil
	}
	f := Firing{ID: id, Policy: "focus-break", SessionID: s.ID, At: r.Now().UTC(), Message: "You have been focusing for 45 more minutes. Take a break when ready.", Review: "unreviewed", State: "PENDING"}
	if e = saveEntity(ctx, tx, id, "firing", id, f, r.Now()); e != nil {
		return e
	}
	if e = r.audit(ctx, tx, "policy:focus-break", "notification.propose", "owner", "ALLOW", id); e != nil {
		return e
	}
	e = tx.Commit()
	committed = e == nil
	return e
}
func (r *Runtime) recordGitFiring(ctx context.Context, result error) {
	r.mu.Lock()
	committed := false
	defer r.unlockAndPublish(&committed, "firings", "events", "audit")
	tx, e := r.db.BeginTx(ctx, nil)
	if e != nil {
		return
	}
	defer tx.Rollback()
	if !policyEnabled(ctx, tx, "git-refresh") {
		return
	}
	s, e := readSession(ctx, tx)
	if e != nil {
		return
	}
	id := protocol.ID()
	message := "Repository status refreshed"
	state := "SUCCEEDED"
	if result != nil {
		message = "Repository refresh unavailable"
		state = "FAILED"
	}
	f := Firing{ID: id, Policy: "git-refresh", SessionID: s.ID, At: r.Now().UTC(), Message: message, Review: "unreviewed", State: state}
	if saveEntity(ctx, tx, id, "firing", id, f, r.Now()) != nil {
		return
	}
	if r.audit(ctx, tx, "policy:git-refresh", "repo.status", s.ProjectID, state, id) != nil {
		return
	}
	committed = tx.Commit() == nil
}

func (r *Runtime) notificationAction(ctx context.Context, tx *sql.Tx, q Request, v *Response) error {
	var b struct {
		ID    string `json:"id"`
		State string `json:"state"`
	}
	if e := json.Unmarshal(q.Body, &b); e != nil {
		return e
	}
	var data []byte
	var f Firing
	if e := tx.QueryRowContext(ctx, "SELECT value FROM entities WHERE kind='firing' AND key=?", b.ID).Scan(&data); e != nil {
		return fmt.Errorf("VALIDATION: firing not found")
	}
	if e := json.Unmarshal(data, &f); e != nil {
		return e
	}
	if q.Op == "notifications.claim" {
		if !policyEnabled(ctx, tx, f.Policy) {
			return fmt.Errorf("AUTHORIZATION: rule disabled")
		}
		if f.State != "PENDING" || f.Policy != "focus-break" {
			return fmt.Errorf("CONFLICT: notification not pending")
		}
		f.State = "DELIVERING"
	} else {
		if f.State != "DELIVERING" || (b.State != "DELIVERED" && b.State != "FAILED") {
			return fmt.Errorf("CONFLICT: notification result")
		}
		f.State = b.State
	}
	v.Data = f
	return saveEntity(ctx, tx, q.ID, "firing", f.ID, f, r.Now())
}
