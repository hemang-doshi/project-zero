package runtime

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type effect struct {
	Node       string          `json:"node"`
	Capability string          `json:"capability"`
	Input      json.RawMessage `json:"input"`
}
type grant struct {
	Principal  string `json:"principal"`
	Capability string `json:"capability"`
	Target     string `json:"target"`
	State      string `json:"state"`
	Expires    string `json:"expires"`
}

func (r *Runtime) decision(ctx context.Context, tx *sql.Tx, p, cap, target string) (string, error) {
	if p != "owner" {
		var revoked int
		if e := tx.QueryRowContext(ctx, "SELECT revoked FROM nodes WHERE 'node:'||id=?", p).Scan(&revoked); e != nil || revoked != 0 {
			return "DENIED", nil
		}
	}
	var state, expires string
	e := tx.QueryRowContext(ctx, "SELECT state,expires FROM grants WHERE principal=? AND capability=? AND target=?", p, cap, target).Scan(&state, &expires)
	if e == sql.ErrNoRows {
		if p == "owner" && strings.HasPrefix(cap, "session.") {
			return "ALWAYS_ALLOWED", nil
		}
		return "ASK", nil
	}
	if e != nil {
		return "", e
	}
	if state == "SESSION_ALLOWED" {
		t, e := time.Parse(time.RFC3339Nano, expires)
		if e != nil || !r.Now().Before(t) {
			return "ASK", nil
		}
	}
	return state, nil
}

func (r *Runtime) apply(ctx context.Context, tx *sql.Tx, p string, q Request, v *Response) error {
	if strings.HasPrefix(q.Op, "session.") {
		d, e := r.decision(ctx, tx, p, q.Op, "runtime")
		if e != nil {
			return e
		}
		if d == "DENIED" {
			return fmt.Errorf("AUTHORIZATION: session action %s", d)
		}
		s, e := readSession(ctx, tx)
		if e != nil {
			return e
		}
		if d == "ASK" && !q.approved {
			var input map[string]any
			if len(q.Body) > 0 {
				if e = json.Unmarshal(q.Body, &input); e != nil {
					return e
				}
			}
			if input == nil {
				input = map[string]any{}
			}
			input["expected_revision"] = s.Revision
			b, _ := json.Marshal(input)
			_, e = tx.ExecContext(ctx, "INSERT INTO invocations(id,principal,node,capability,input,hash,status,deadline) VALUES(?,?,?,?,?,?,?,?)", q.ID, p, "runtime", q.Op, b, hash(input), "WAITING_APPROVAL", r.Now().Add(2*time.Minute).UTC().Format(time.RFC3339Nano))
			v.Status = "WAITING_APPROVAL"
			return e
		}
		if q.approved {
			var input struct {
				Revision int64 `json:"expected_revision"`
			}
			if e = json.Unmarshal(q.Body, &input); e != nil {
				return e
			}
			if input.Revision != s.Revision {
				return fmt.Errorf("CONFLICT: session changed since approval request")
			}
		}
		now := r.Now().UnixMilli()
		switch q.Op {
		case "session.start":
			var b struct {
				Project   string `json:"project"`
				ProjectID string `json:"project_id"`
			}
			if e = json.Unmarshal(q.Body, &b); e != nil {
				return e
			}
			if b.ProjectID != "" {
				project, err := loadProject(ctx, tx, b.ProjectID)
				if err != nil {
					return err
				}
				b.Project = project.Name
			}
			if len(b.Project) == 0 || len(b.Project) > 64 {
				return fmt.Errorf("VALIDATION: project must be 1..64 bytes")
			}
			if s.State != "IDLE" {
				if (b.ProjectID != "" && s.ProjectID == b.ProjectID) || (b.ProjectID == "" && s.Project == b.Project) {
					v.Data = s
					return nil
				}
				return fmt.Errorf("CONFLICT: end the current session before switching projects")
			}
			s.ID = q.ID
			s.ProjectID = b.ProjectID
			s.Project = b.Project
			s.ElapsedMS = 0
			s.State = "RUNNING"
			s.SinceMS = now
		case "session.end":
			if s.State == "IDLE" {
				v.Data = s
				return nil
			}
			if s.State == "RUNNING" {
				s.ElapsedMS += max(0, now-s.SinceMS)
			}
			s.State = "IDLE"
			s.SinceMS = 0

		case "session.pause", "session.resume", "session.toggle":
			if s.State == "IDLE" {
				return fmt.Errorf("CONFLICT: start a session first")
			}
			pause := q.Op == "session.pause" || (q.Op == "session.toggle" && s.State == "RUNNING")
			if pause && s.State == "RUNNING" {
				s.ElapsedMS += max(0, now-s.SinceMS)
				s.State = "PAUSED"
				s.SinceMS = 0
			} else if !pause && s.State == "PAUSED" {
				s.State = "RUNNING"
				s.SinceMS = now
			}
		default:
			return fmt.Errorf("VALIDATION: unknown session action")
		}
		s.Revision++
		b, _ := json.Marshal(s)
		if _, e = tx.ExecContext(ctx, "INSERT INTO events(id,kind,data,time) VALUES(?,?,?,?)", q.ID, "session.changed", b, r.Now().UTC().Format(time.RFC3339Nano)); e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, "INSERT INTO state_values VALUES('session',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,revision=excluded.revision", b, s.Revision); e != nil {
			return e
		}
		v.Data = s
		if e = r.sessionContext(ctx, tx, q.ID, s); e != nil {
			return e
		}
		return r.queueSession(ctx, tx, q.ID, s)
	}
	if strings.HasPrefix(p, "integration:") && q.Op == "integration.observed" {
		return r.integrationAction(ctx, tx, q, v)
	}
	if p != "owner" {
		return fmt.Errorf("AUTHORIZATION: owner required")
	}
	switch q.Op {
	case "integrations.connect", "integrations.disconnect":
		return r.integrationAction(ctx, tx, q, v)
	case "notifications.claim", "notifications.result":
		return r.notificationAction(ctx, tx, q, v)
	case "policies.apply", "policies.disable", "policies.review":
		return r.policyAction(ctx, tx, q, v)
	case "intent.run":
		return r.runIntent(ctx, tx, q, v)
	case "projects.add", "projects.remove", "context.assert", "context.clear":
		return r.personal(ctx, tx, q, v)
	case "state.set":
		var b struct {
			Key      string          `json:"key"`
			Value    json.RawMessage `json:"value"`
			Expected int64           `json:"expected_revision"`
		}
		if e := json.Unmarshal(q.Body, &b); e != nil {
			return e
		}
		if !strings.HasPrefix(b.Key, "desk.") || len(b.Key) > 64 || !json.Valid(b.Value) || len(b.Value) > 2048 {
			return fmt.Errorf("VALIDATION: only bounded desk.* state is writable")
		}
		var revision int64
		e := tx.QueryRowContext(ctx, "SELECT revision FROM state_values WHERE key=?", b.Key).Scan(&revision)
		if e != nil && e != sql.ErrNoRows {
			return e
		}
		if revision != b.Expected {
			return fmt.Errorf("CONFLICT: stale state revision")
		}
		data, _ := json.Marshal(map[string]any{"key": b.Key, "value": b.Value, "revision": revision + 1, "classification": "PRIVATE", "source": "owner"})
		if _, e = tx.ExecContext(ctx, "INSERT INTO events(id,kind,data,time) VALUES(?,?,?,?)", q.ID, "state.changed", data, r.Now().UTC().Format(time.RFC3339Nano)); e != nil {
			return e
		}
		_, e = tx.ExecContext(ctx, "INSERT INTO state_values VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,revision=excluded.revision", b.Key, []byte(b.Value), revision+1)
		return e
	case "grants.set":
		var g grant
		if e := json.Unmarshal(q.Body, &g); e != nil {
			return e
		}
		if g.Principal == "" || g.Capability == "" || g.Target == "" {
			return fmt.Errorf("VALIDATION: explicit grant scope required")
		}
		switch g.State {
		case "ALWAYS_ALLOWED", "ASK", "DENIED":
		case "SESSION_ALLOWED":
			t, e := time.Parse(time.RFC3339Nano, g.Expires)
			if e != nil || !r.Now().Before(t) {
				return fmt.Errorf("VALIDATION: future session expiry required")
			}
		default:
			return fmt.Errorf("VALIDATION: permission state")
		}
		_, e := tx.ExecContext(ctx, "INSERT INTO grants VALUES(?,?,?,?,?) ON CONFLICT(principal,capability,target) DO UPDATE SET state=excluded.state,expires=excluded.expires", g.Principal, g.Capability, g.Target, g.State, g.Expires)
		return e
	case "nodes.revoke":
		var b struct {
			Node string `json:"node"`
		}
		if e := json.Unmarshal(q.Body, &b); e != nil {
			return e
		}
		res, e := tx.ExecContext(ctx, "UPDATE nodes SET revoked=1 WHERE id=?", b.Node)
		if e != nil {
			return e
		}
		n, _ := res.RowsAffected()
		if n != 1 {
			return fmt.Errorf("VALIDATION: node not found")
		}
		if _, e = tx.ExecContext(ctx, "UPDATE invocations SET status='CANCELLED' WHERE node=? AND status IN ('QUEUED','DISPATCHED','WAITING_APPROVAL')", b.Node); e != nil {
			return e
		}
		_, e = tx.ExecContext(ctx, "DELETE FROM outbox WHERE id IN (SELECT id FROM invocations WHERE node=?)", b.Node)
		return e
	case "capabilities.invoke":
		var f effect
		if e := json.Unmarshal(q.Body, &f); e != nil {
			return e
		}
		return r.invoke(ctx, tx, p, q.ID, f, v)
	case "approvals.approve", "approvals.deny", "invocations.cancel":
		var b struct {
			ID string `json:"id"`
		}
		if e := json.Unmarshal(q.Body, &b); e != nil {
			return e
		}
		var status, deadline string
		if e := tx.QueryRowContext(ctx, "SELECT status,deadline FROM invocations WHERE id=?", b.ID).Scan(&status, &deadline); e != nil {
			return e
		}
		if q.Op == "approvals.approve" {
			if status != "WAITING_APPROVAL" {
				return fmt.Errorf("CONFLICT: approval not pending")
			}
			expiry, e := time.Parse(time.RFC3339Nano, deadline)
			if e != nil || !r.Now().Before(expiry) {
				return fmt.Errorf("DEADLINE: approval expired")
			}
			var target, principal, capability string
			var input []byte
			if e = tx.QueryRowContext(ctx, "SELECT node,principal,capability,input FROM invocations WHERE id=?", b.ID).Scan(&target, &principal, &capability, &input); e != nil {
				return e
			}
			if target == "runtime" {
				result := Response{ID: b.ID, Status: "SUCCEEDED"}
				if e = r.apply(ctx, tx, principal, Request{ID: b.ID, Op: capability, Body: input, approved: true}, &result); e != nil {
					return e
				}
				if _, e = tx.ExecContext(ctx, "UPDATE invocations SET status='SUCCEEDED',approved=1 WHERE id=?", b.ID); e != nil {
					return e
				}
				return r.audit(ctx, tx, principal, capability, target, "APPROVED_EXECUTION", b.ID)
			}
			if _, e = tx.ExecContext(ctx, "UPDATE invocations SET status='QUEUED',approved=1 WHERE id=?", b.ID); e != nil {
				return e
			}
			_, e = tx.ExecContext(ctx, "INSERT INTO outbox VALUES(?,?)", b.ID, r.Now().UTC().Format(time.RFC3339Nano))
			return e
		}
		if status == "SUCCEEDED" || status == "FAILED" {
			return fmt.Errorf("CONFLICT: already terminal")
		}
		if _, e := tx.ExecContext(ctx, "UPDATE invocations SET status='CANCELLED' WHERE id=?", b.ID); e != nil {
			return e
		}
		_, e := tx.ExecContext(ctx, "DELETE FROM outbox WHERE id=?", b.ID)
		return e
	case "events.replay":
		if e := replayEntities(ctx, tx); e != nil {
			return e
		}
		if e := replayState(ctx, tx); e != nil {
			return e
		}
		var b []byte
		e := tx.QueryRowContext(ctx, "SELECT data FROM events WHERE kind='session.changed' ORDER BY seq DESC LIMIT 1").Scan(&b)
		if e == sql.ErrNoRows {
			return nil
		}
		if e != nil {
			return e
		}
		var s Session
		if e = json.Unmarshal(b, &s); e != nil {
			return e
		}
		_, e = tx.ExecContext(ctx, "INSERT INTO state_values VALUES('session',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,revision=excluded.revision", b, s.Revision)
		return e
	default:
		return fmt.Errorf("VALIDATION: unsupported operation %s", q.Op)
	}
}

func (r *Runtime) invoke(ctx context.Context, tx *sql.Tx, p, id string, f effect, v *Response) error {
	if f.Capability != "display.render" && f.Capability != "display.clear" {
		return fmt.Errorf("AUTHORIZATION: unknown capability")
	}
	if len(f.Input) == 0 {
		f.Input = json.RawMessage(`{}`)
	}
	var input map[string]any
	if e := json.Unmarshal(f.Input, &input); e != nil || input == nil || len(f.Input) > 4096 {
		return fmt.Errorf("VALIDATION: display input")
	}
	for k, value := range input {
		switch k {
		case "artwork_rgb565":
			encoded, ok := value.(string)
			if !ok || !validArtwork(encoded) || !supportsArtwork(ctx, tx, f.Node) {
				return fmt.Errorf("VALIDATION: artwork requires negotiated 32x32 RGB565")
			}
		case "git", "agent", "track", "artist", "media":
			value, ok := value.(string)
			if !ok || len(value) > 64 || !hybrid(ctx, tx, f.Node) {
				return fmt.Errorf("VALIDATION: extended display field requires negotiated schema")
			}
		case "project", "state":
			s, ok := value.(string)
			if !ok || len(s) > 64 {
				return fmt.Errorf("VALIDATION: display text")
			}
			if k == "state" && s != "IDLE" && s != "RUNNING" && s != "PAUSED" {
				return fmt.Errorf("VALIDATION: display state")
			}
		case "elapsed_ms", "since_ms", "revision":
			n, ok := value.(float64)
			if !ok || n < 0 || n > 9007199254740991 || n != float64(int64(n)) {
				return fmt.Errorf("VALIDATION: display number")
			}
		default:
			return fmt.Errorf("VALIDATION: unsupported display field %s", k)
		}
	}
	var revoked int
	var caps []byte
	if e := tx.QueryRowContext(ctx, "SELECT revoked,capabilities FROM nodes WHERE id=?", f.Node).Scan(&revoked, &caps); e != nil || revoked != 0 {
		return fmt.Errorf("AUTHORIZATION: target unavailable or revoked")
	}
	var c []string
	json.Unmarshal(caps, &c)
	found := false
	for _, cap := range c {
		if cap == f.Capability {
			found = true
		}
	}
	if !found {
		return fmt.Errorf("AUTHORIZATION: target capability ceiling")
	}
	d, e := r.decision(ctx, tx, p, f.Capability, f.Node)
	if e != nil {
		return e
	}
	if d == "DENIED" {
		return fmt.Errorf("AUTHORIZATION: denied")
	}
	status := "QUEUED"
	if d == "ASK" {
		status = "WAITING_APPROVAL"
	}
	if _, e = tx.ExecContext(ctx, "INSERT INTO invocations(id,principal,node,capability,input,hash,status,deadline) VALUES(?,?,?,?,?,?,?,?)", id, p, f.Node, f.Capability, []byte(f.Input), hash(f), status, r.Now().Add(24*time.Hour).UTC().Format(time.RFC3339Nano)); e != nil {
		return e
	}
	if status == "QUEUED" {
		if _, e = tx.ExecContext(ctx, "DELETE FROM outbox WHERE id IN (SELECT id FROM invocations WHERE node=? AND capability IN ('display.render','display.clear') AND status IN ('QUEUED','DISPATCHED') AND id<>?)", f.Node, id); e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, "UPDATE invocations SET status='CANCELLED' WHERE node=? AND capability IN ('display.render','display.clear') AND status IN ('QUEUED','DISPATCHED') AND id<>?", f.Node, id); e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, "INSERT INTO outbox VALUES(?,?)", id, r.Now().UTC().Format(time.RFC3339Nano)); e != nil {
			return e
		}
	}
	v.ID = id
	v.Status = status
	return r.audit(ctx, tx, p, f.Capability, f.Node, d, id)
}

func (r *Runtime) queueSession(ctx context.Context, tx *sql.Tx, id string, s Session) error {
	rows, e := tx.QueryContext(ctx, "SELECT id,last_seen FROM nodes WHERE revoked=0")
	if e != nil {
		return e
	}
	var nodes []string
	for rows.Next() {
		var n string
		var lastSeen sql.NullString
		if e = rows.Scan(&n, &lastSeen); e != nil {
			rows.Close()
			return e
		}
		if lastSeen.Valid {
			if at, err := time.Parse(time.RFC3339Nano, lastSeen.String); err == nil && r.Now().Sub(at) >= nodeOfflineAfter {
				continue
			}
		}
		nodes = append(nodes, n)
	}
	rows.Close()

	for _, n := range nodes {
		d, e := r.decision(ctx, tx, "owner", "display.render", n)
		if e != nil {
			return e
		}
		if d != "ALWAYS_ALLOWED" && d != "SESSION_ALLOWED" {
			continue
		}
		b, e := r.displayPayload(ctx, tx, n, s)
		if e != nil {
			return e
		}
		v := Response{}
		if e = r.invoke(ctx, tx, "owner", id+":"+n, effect{n, "display.render", b}, &v); e != nil {
			return e
		}
	}
	return nil
}
