package runtime

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"projectzero.local/zero/core/protocol"
	"projectzero.local/zero/core/storage"
	"strings"
	"sync"
	"time"
)

type Runtime struct {
	MacObserver string
	MacAudio    string
	audioMu     sync.Mutex
	audio       AudioFrame
	audioStatus string
	db          *sql.DB
	mu          sync.Mutex
	Now         func() time.Time
}
type Request struct {
	ID       string          `json:"id"`
	Op       string          `json:"op"`
	Body     json.RawMessage `json:"body"`
	DryRun   bool            `json:"dry_run,omitempty"`
	approved bool
}
type Response struct {
	Version string `json:"version"`
	ID      string `json:"id"`
	Status  string `json:"status"`
	Data    any    `json:"data,omitempty"`
}
type Session struct {
	ID        string `json:"id,omitempty"`
	ProjectID string `json:"project_id,omitempty"`
	Project   string `json:"project"`
	State     string `json:"state"`
	ElapsedMS int64  `json:"elapsed_ms"`
	SinceMS   int64  `json:"since_ms"`
	Revision  int64  `json:"revision"`
}

func Open(path string) (*Runtime, error) {
	db, e := storage.Open(path)
	if e != nil {
		return nil, e
	}
	return &Runtime{db: db, Now: time.Now}, nil
}
func (r *Runtime) Close() error { return r.db.Close() }
func hash(v any) string {
	b, _ := json.Marshal(v)
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}
func readSession(ctx context.Context, tx *sql.Tx) (Session, error) {
	s := Session{State: "IDLE"}
	var b []byte
	e := tx.QueryRowContext(ctx, "SELECT value FROM state_values WHERE key='session'").Scan(&b)
	if e == sql.ErrNoRows {
		return s, nil
	}
	if e != nil {
		return s, e
	}
	e = json.Unmarshal(b, &s)
	if s.ID == "" && s.State != "IDLE" {
		s.ID = "legacy-session"
	}
	return s, e
}
func (r *Runtime) Session(ctx context.Context) (Session, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	tx, e := r.db.BeginTx(ctx, nil)
	if e != nil {
		return Session{}, e
	}
	defer tx.Rollback()
	s, e := readSession(ctx, tx)
	if s.State == "RUNNING" {
		s.ElapsedMS += max(0, r.Now().UnixMilli()-s.SinceMS)
	}
	return s, e
}
func (r *Runtime) audit(ctx context.Context, tx *sql.Tx, p, a, target, d, id string) error {
	var prev string
	e := tx.QueryRowContext(ctx, "SELECT hash FROM audit_entries ORDER BY seq DESC LIMIT 1").Scan(&prev)
	if e != nil && e != sql.ErrNoRows {
		return e
	}
	now := r.Now().UTC().Format(time.RFC3339Nano)
	h := hash([]string{p, a, target, d, id, now, prev})
	_, e = tx.ExecContext(ctx, "INSERT INTO audit_entries(principal,action,target,decision,correlation,time,previous_hash,hash) VALUES(?,?,?,?,?,?,?,?)", p, a, target, d, id, now, prev, h)
	return e
}
func (r *Runtime) Enroll(ctx context.Context, id, fp string, caps []string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if id == "" || len(id) > 64 || fp == "" {
		return fmt.Errorf("VALIDATION: identity")
	}
	b, _ := json.Marshal(caps)
	tx, e := r.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var revoked int
	if err := tx.QueryRowContext(ctx, "SELECT revoked FROM nodes WHERE id=?", id).Scan(&revoked); err == nil {
		if revoked == 0 {
			return fmt.Errorf("CONFLICT: node already enrolled")
		}
		if _, e = tx.ExecContext(ctx, "DELETE FROM nodes WHERE id=?", id); e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, "DELETE FROM grants WHERE principal=? OR target=?", "node:"+id, id); e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, "DELETE FROM desired WHERE node=?", id); e != nil {
			return e
		}
	} else if err != sql.ErrNoRows {
		return err
	}
	_, e = tx.ExecContext(ctx, "INSERT INTO nodes(id,fingerprint,capabilities) VALUES(?,?,?)", id, fp, b)
	if e != nil {
		return e
	}
	if e = r.audit(ctx, tx, "owner", "nodes.pair", id, "ALLOW", id); e != nil {
		return e
	}
	return tx.Commit()
}
func (r *Runtime) Known(ctx context.Context, node, fp string) bool {
	var n int
	return r.db.QueryRowContext(ctx, "SELECT count(*) FROM nodes WHERE id=? AND fingerprint=? AND revoked=0", node, fp).Scan(&n) == nil && n == 1
}

func (r *Runtime) Execute(ctx context.Context, principal string, q Request) (Response, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	v := Response{Version: "0.1", ID: q.ID, Status: "SUCCEEDED"}
	if len(q.ID) == 0 || len(q.ID) > 128 || len(q.Body) > 4096 {
		return v, fmt.Errorf("VALIDATION: request bounds")
	}
	var body map[string]json.RawMessage
	if len(q.Body) > 0 {
		if e := protocol.ValidateJSON(q.Body); e != nil {
			return v, fmt.Errorf("VALIDATION: %w", e)
		}
		if e := json.Unmarshal(q.Body, &body); e != nil {
			return v, fmt.Errorf("VALIDATION: body")
		}
	}
	if e := validatePersonalFields(q.Op, body); e != nil {
		return v, e
	}
	signature := hash(struct {
		P, O string
		B    map[string]json.RawMessage
	}{principal, q.Op, body})
	tx, e := r.db.BeginTx(ctx, nil)
	if e != nil {
		return v, e
	}
	defer tx.Rollback()
	var oldHash string
	var old []byte
	e = tx.QueryRowContext(ctx, "SELECT hash,response FROM commands WHERE id=?", q.ID).Scan(&oldHash, &old)
	if e == nil {
		if signature != oldHash {
			return v, fmt.Errorf("CONFLICT: id reused for different effect")
		}
		e = json.Unmarshal(old, &v)
		return v, e
	}
	if e != sql.ErrNoRows {
		return v, e
	}
	if strings.HasPrefix(principal, "integration:") {
		id := integrationPrincipal(principal)
		var b Integration
		if q.Op != "integration.observed" || json.Unmarshal(q.Body, &b) != nil || b.ID != id {
			return v, fmt.Errorf("AUTHORIZATION: integration capability ceiling")
		}
		old, err := readIntegration(ctx, tx, id)
		if err != nil || !old.Enabled {
			return v, fmt.Errorf("AUTHORIZATION: integration disabled")
		}
	} else if principal != "owner" {
		var revoked int
		e = tx.QueryRowContext(ctx, "SELECT revoked FROM nodes WHERE 'node:'||id=?", principal).Scan(&revoked)
		if e != nil || revoked != 0 {
			return v, fmt.Errorf("AUTHORIZATION: unknown or revoked principal")
		}
		if q.Op != "session.toggle" {
			return v, fmt.Errorf("AUTHORIZATION: node ceiling")
		}
	}
	if q.DryRun {
		if e = r.validate(ctx, tx, principal, q); e != nil {
			return v, e
		}
		v.Status = "DRY_RUN"
		return v, nil
	}
	if e = r.apply(ctx, tx, principal, q, &v); e != nil {
		tx.Rollback()
		at, auditErr := r.db.BeginTx(ctx, nil)
		if auditErr != nil {
			return v, auditErr
		}
		if auditErr = r.audit(ctx, at, principal, q.Op, "runtime", "REJECTED", q.ID); auditErr != nil {
			at.Rollback()
			return v, auditErr
		}
		if auditErr = at.Commit(); auditErr != nil {
			return v, auditErr
		}
		return v, e
	}
	if e = r.audit(ctx, tx, principal, q.Op, "runtime", v.Status, q.ID); e != nil {
		return v, e
	}
	b, _ := json.Marshal(v)
	if _, e = tx.ExecContext(ctx, "INSERT INTO commands VALUES(?,?,?,?)", q.ID, principal, signature, b); e != nil {
		return v, e
	}
	return v, tx.Commit()
}

func (r *Runtime) validate(ctx context.Context, tx *sql.Tx, p string, q Request) error {
	// Validate through the same transactional path; the enclosing dry-run transaction rolls back.
	v := Response{ID: q.ID}
	return r.apply(ctx, tx, p, q, &v)
}

func (r *Runtime) List(ctx context.Context, kind string) ([]map[string]any, error) {
	queries := map[string]string{"node_profiles": "SELECT key AS id,value FROM entities WHERE kind='node_profile'", "nodes": "SELECT id,revoked,capabilities,last_seen FROM nodes", "events": "SELECT * FROM events ORDER BY seq DESC LIMIT 500", "audit": "SELECT * FROM audit_entries ORDER BY seq DESC LIMIT 500", "grants": "SELECT * FROM grants", "approvals": "SELECT id,node,capability,input,hash,status,deadline FROM invocations WHERE status='WAITING_APPROVAL'", "invocations": "SELECT * FROM invocations ORDER BY rowid DESC LIMIT 500", "firings": "SELECT key AS id,value FROM entities WHERE kind='firing' ORDER BY rowid DESC LIMIT 500", "state": "SELECT * FROM state_values", "projects": "SELECT key AS id,value FROM entities WHERE kind='project'", "context": "SELECT key,value FROM entities WHERE kind='context'"}
	query, ok := queries[kind]
	if !ok {
		return nil, fmt.Errorf("VALIDATION: unknown collection")
	}
	rows, e := r.db.QueryContext(ctx, query)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	cols, e := rows.Columns()
	if e != nil {
		return nil, e
	}
	out := []map[string]any{}
	for rows.Next() {
		v := make([]any, len(cols))
		ptr := make([]any, len(cols))
		for i := range v {
			ptr[i] = &v[i]
		}
		if e = rows.Scan(ptr...); e != nil {
			return nil, e
		}
		m := map[string]any{}
		for i, k := range cols {
			if b, ok := v[i].([]byte); ok {
				if json.Valid(b) {
					m[k] = json.RawMessage(b)
				} else {
					m[k] = string(b)
				}
			} else {
				m[k] = v[i]
			}
		}
		if kind == "nodes" {
			status := "PAIRED"
			if m["revoked"] == int64(1) {
				status = "REVOKED"
			} else if stamp, ok := m["last_seen"].(string); ok {
				at, err := time.Parse(time.RFC3339Nano, stamp)
				if err == nil {
					age := r.Now().Sub(at)
					status = "ONLINE"
					if age >= 90*time.Second {
						status = "OFFLINE"
					} else if age >= 60*time.Second {
						status = "SUSPECT"
					}
				}
			}
			m["status"] = status
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
