package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

type Invocation struct {
	ID         string          `json:"id"`
	Node       string          `json:"node"`
	Capability string          `json:"capability"`
	Input      json.RawMessage `json:"input"`
	Attempt    int             `json:"attempt"`
}

func (r *Runtime) Pending(ctx context.Context, node string) ([]Invocation, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	tx, e := r.db.BeginTx(ctx, nil)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	var revoked int
	if e = tx.QueryRowContext(ctx, "SELECT revoked FROM nodes WHERE id=?", node).Scan(&revoked); e != nil || revoked != 0 {
		return nil, fmt.Errorf("AUTHORIZATION: node revoked")
	}
	rows, e := tx.QueryContext(ctx, "SELECT i.id,i.capability,i.input,i.attempts,i.principal,i.approved,i.deadline,o.next_at FROM invocations i JOIN outbox o ON i.id=o.id WHERE i.node=? ORDER BY i.rowid LIMIT 32", node)
	if e != nil {
		return nil, e
	}
	type record struct {
		v              Invocation
		p              string
		approved       int
		deadline, next string
	}
	var records []record
	for rows.Next() {
		x := record{}
		x.v.Node = node
		if e = rows.Scan(&x.v.ID, &x.v.Capability, &x.v.Input, &x.v.Attempt, &x.p, &x.approved, &x.deadline, &x.next); e != nil {
			rows.Close()
			return nil, e
		}
		records = append(records, x)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	out := []Invocation{}
	for _, x := range records {
		expiry, _ := time.Parse(time.RFC3339Nano, x.deadline)
		next, _ := time.Parse(time.RFC3339Nano, x.next)
		d, e := r.decision(ctx, tx, x.p, x.v.Capability, node)
		if e != nil {
			return nil, e
		}
		status := ""
		if !r.Now().Before(expiry) {
			status = "EXPIRED"
		} else if d == "DENIED" || (d == "ASK" && x.approved == 0) {
			status = "REJECTED"
		} else if x.v.Attempt >= 5 {
			status = "TIMED_OUT"
		}
		if status != "" {
			if _, e = tx.ExecContext(ctx, "UPDATE invocations SET status=? WHERE id=?", status, x.v.ID); e != nil {
				return nil, e
			}
			if _, e = tx.ExecContext(ctx, "DELETE FROM outbox WHERE id=?", x.v.ID); e != nil {
				return nil, e
			}
			if e = r.audit(ctx, tx, x.p, x.v.Capability, node, status, x.v.ID); e != nil {
				return nil, e
			}
			continue
		}
		if r.Now().Before(next) {
			continue
		}
		x.v.Attempt++
		if _, e = tx.ExecContext(ctx, "UPDATE invocations SET status='DISPATCHED',attempts=? WHERE id=?", x.v.Attempt, x.v.ID); e != nil {
			return nil, e
		}
		if _, e = tx.ExecContext(ctx, "UPDATE outbox SET next_at=? WHERE id=?", r.Now().Add(time.Duration(1<<x.v.Attempt)*time.Second).UTC().Format(time.RFC3339Nano), x.v.ID); e != nil {
			return nil, e
		}
		if e = r.audit(ctx, tx, x.p, x.v.Capability, node, "DISPATCHED", x.v.ID); e != nil {
			return nil, e
		}
		if _, e = tx.ExecContext(ctx, "INSERT INTO desired VALUES(?,?,?,?) ON CONFLICT(node,capability) DO UPDATE SET input=excluded.input,principal=excluded.principal", node, x.v.Capability, []byte(x.v.Input), x.p); e != nil {
			return nil, e
		}
		out = append(out, x.v)
	}
	return out, tx.Commit()
}

func (r *Runtime) Result(ctx context.Context, node, id, status string, output json.RawMessage) error {
	if status != "SUCCEEDED" && status != "FAILED" && status != "REJECTED" {
		return fmt.Errorf("VALIDATION: result status")
	}
	if len(output) > 4096 || !json.Valid(output) {
		return fmt.Errorf("VALIDATION: result")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	tx, e := r.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var current string
	if e = tx.QueryRowContext(ctx, "SELECT status FROM invocations WHERE id=? AND node=?", id, node).Scan(&current); e != nil {
		return e
	}
	if current == status {
		return nil
	}
	if current != "DISPATCHED" {
		return fmt.Errorf("CONFLICT: result for non-dispatched invocation")
	}
	if _, e = tx.ExecContext(ctx, "UPDATE invocations SET status=?,result=? WHERE id=?", status, []byte(output), id); e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, "DELETE FROM outbox WHERE id=?", id); e != nil {
		return e
	}
	if e = r.audit(ctx, tx, "node:"+node, "capability.result", node, status, id); e != nil {
		return e
	}
	return tx.Commit()
}

func (r *Runtime) Restore(ctx context.Context, node, sessionID string) error {
	// Restoration is a new, policy-checked invocation, never replay of historical effects.
	rows, e := r.db.QueryContext(ctx, "SELECT capability,input,principal FROM desired WHERE node=?", node)
	if e != nil {
		return e
	}
	type d struct {
		cap   string
		input json.RawMessage
		p     string
	}
	var values []d
	for rows.Next() {
		var x d
		if e = rows.Scan(&x.cap, &x.input, &x.p); e != nil {
			rows.Close()
			return e
		}
		values = append(values, x)
	}
	rows.Close()
	for _, x := range values {
		b, _ := json.Marshal(effect{node, x.cap, x.input})
		if _, e = r.Execute(ctx, x.p, Request{ID: "restore:" + sessionID + ":" + x.cap, Op: "capabilities.invoke", Body: b}); e != nil {
			return e
		}
	}
	return nil
}
func (r *Runtime) Seen(ctx context.Context, node string) error {
	_, e := r.db.ExecContext(ctx, "UPDATE nodes SET last_seen=? WHERE id=? AND revoked=0", r.Now().UTC().Format(time.RFC3339Nano), node)
	return e
}
