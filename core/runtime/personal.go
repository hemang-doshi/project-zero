package runtime

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Project struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Path    string   `json:"path"`
	Aliases []string `json:"aliases"`
	Removed bool     `json:"removed"`
}
type Fact struct {
	Revision       int64      `json:"revision"`
	Dimension      string     `json:"dimension"`
	Value          string     `json:"value"`
	Source         string     `json:"source"`
	Evidence       string     `json:"evidence"`
	ObservedAt     time.Time  `json:"observed_at"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`
	Classification string     `json:"classification"`
	Cleared        bool       `json:"cleared"`
}
type entityEvent struct {
	Kind  string          `json:"kind"`
	Key   string          `json:"key"`
	Value json.RawMessage `json:"value"`
}

func saveEntity(ctx context.Context, tx *sql.Tx, id, kind, key string, value any, at time.Time) error {
	b, e := json.Marshal(value)
	if e != nil {
		return e
	}
	event, _ := json.Marshal(entityEvent{kind, key, b})
	if _, e = tx.ExecContext(ctx, "INSERT INTO events(id,kind,data,time) VALUES(?,'entity.changed',?,?)", id, event, at.UTC().Format(time.RFC3339Nano)); e != nil {
		return e
	}
	_, e = tx.ExecContext(ctx, "INSERT INTO entities(kind,key,value) VALUES(?,?,?) ON CONFLICT(kind,key) DO UPDATE SET value=excluded.value", kind, key, b)
	return e
}
func loadProject(ctx context.Context, tx *sql.Tx, id string) (Project, error) {
	var p Project
	var b []byte
	e := tx.QueryRowContext(ctx, "SELECT value FROM entities WHERE kind='project' AND key=?", id).Scan(&b)
	if e != nil {
		return p, fmt.Errorf("VALIDATION: registered project required")
	}
	if e = json.Unmarshal(b, &p); e != nil {
		return p, e
	}
	if p.Removed {
		return p, fmt.Errorf("VALIDATION: project removed")
	}
	return p, nil
}
func (r *Runtime) personal(ctx context.Context, tx *sql.Tx, q Request, v *Response) error {
	switch q.Op {
	case "projects.add":
		var p Project
		if e := json.Unmarshal(q.Body, &p); e != nil {
			return e
		}
		if p.ID == "" || len(p.ID) > 64 || strings.ContainsAny(p.ID, " /\\\n\r\t") || len(strings.TrimSpace(p.Name)) == 0 || len(p.Name) > 64 || len(p.Aliases) > 16 {
			return fmt.Errorf("VALIDATION: project identity or name")
		}
		for _, a := range p.Aliases {
			if strings.TrimSpace(a) == "" || len(a) > 64 {
				return fmt.Errorf("VALIDATION: project alias")
			}
		}
		path, e := filepath.Abs(p.Path)
		if e != nil || p.Path == "" {
			return fmt.Errorf("VALIDATION: explicit repository path required")
		}
		path, e = filepath.EvalSymlinks(path)
		if e != nil {
			return fmt.Errorf("VALIDATION: repository path unavailable")
		}
		if _, e = os.Stat(filepath.Join(path, ".git")); e != nil {
			return fmt.Errorf("VALIDATION: path must be an existing Git checkout")
		}
		p.Path = path
		p.Removed = false
		var exists int
		if e = tx.QueryRowContext(ctx, "SELECT count(*) FROM entities WHERE kind='project' AND key=?", p.ID).Scan(&exists); e != nil {
			return e
		}
		if exists > 0 {
			return fmt.Errorf("CONFLICT: project ID already registered")
		}
		v.Data = p
		return saveEntity(ctx, tx, q.ID, "project", p.ID, p, r.Now())
	case "projects.remove":
		var b struct {
			ID string `json:"id"`
		}
		if e := json.Unmarshal(q.Body, &b); e != nil {
			return e
		}
		p, e := loadProject(ctx, tx, b.ID)
		if e != nil {
			return e
		}
		s, e := readSession(ctx, tx)
		if e != nil {
			return e
		}
		if s.State != "IDLE" && s.ProjectID == p.ID {
			return fmt.Errorf("CONFLICT: end focus before removing its project")
		}
		p.Removed = true
		return saveEntity(ctx, tx, q.ID, "project", p.ID, p, r.Now())
	case "context.assert", "context.clear":
		var f Fact
		if e := json.Unmarshal(q.Body, &f); e != nil {
			return e
		}
		switch f.Dimension {
		case "project", "activity", "attention", "media":
		default:
			return fmt.Errorf("VALIDATION: unsupported context dimension")
		}
		if q.Op == "context.assert" && (strings.TrimSpace(f.Value) == "" || len(f.Value) > 128) {
			return fmt.Errorf("VALIDATION: bounded context value required")
		}
		if f.ExpiresAt != nil && !r.Now().Before(*f.ExpiresAt) {
			return fmt.Errorf("VALIDATION: future expiry required")
		}
		var guard struct {
			Expected *int64 `json:"expected_revision"`
		}
		if e := json.Unmarshal(q.Body, &guard); e != nil {
			return e
		}
		if guard.Expected == nil {
			return fmt.Errorf("VALIDATION: expected_revision is required")
		}
		current, e := factRevision(ctx, tx, f.Dimension+":owner")
		if e != nil {
			return e
		}
		if *guard.Expected != current {
			return fmt.Errorf("CONFLICT: context revision changed")
		}
		f.Revision = current + 1
		f.Source = "owner"
		f.Evidence = q.ID
		f.ObservedAt = r.Now().UTC()
		f.Classification = "PRIVATE"
		f.Cleared = q.Op == "context.clear"
		v.Data = f
		return saveEntity(ctx, tx, q.ID, "context", f.Dimension+":owner", f, r.Now())
	}
	return fmt.Errorf("VALIDATION: unsupported personal operation")
}
func (r *Runtime) sessionContext(ctx context.Context, tx *sql.Tx, id string, s Session) error {
	values := map[string]string{"project": s.ProjectID, "activity": "coding", "attention": "focused"}
	if values["project"] == "" {
		values["project"] = s.Project
	}
	if s.State == "PAUSED" {
		values["attention"] = "unfocused"
	}
	for _, d := range []string{"project", "activity", "attention"} {
		f := Fact{Dimension: d, Value: values[d], Source: "policy:focus", Evidence: id, ObservedAt: r.Now().UTC(), Classification: "PRIVATE", Cleared: s.State == "IDLE"}
		revision, e := factRevision(ctx, tx, d+":policy:focus")
		if e != nil {
			return e
		}
		f.Revision = revision + 1
		if e := saveEntity(ctx, tx, id+":context:"+d, "context", d+":policy:focus", f, r.Now()); e != nil {
			return e
		}
	}
	return nil
}
func (r *Runtime) Context(ctx context.Context) (map[string]Fact, error) {
	rows, e := r.db.QueryContext(ctx, "SELECT value FROM entities WHERE kind='context' ORDER BY key")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := map[string]Fact{}
	for rows.Next() {
		var b []byte
		var f Fact
		if e = rows.Scan(&b); e != nil {
			return nil, e
		}
		if e = json.Unmarshal(b, &f); e != nil {
			return nil, e
		}
		if f.Cleared || (f.ExpiresAt != nil && !r.Now().Before(*f.ExpiresAt)) {
			continue
		}
		old, ok := out[f.Dimension]
		if !ok || f.Source == "owner" || (old.Source != "owner" && f.ObservedAt.After(old.ObservedAt)) {
			out[f.Dimension] = f
		}
	}
	return out, rows.Err()
}
func replayEntities(ctx context.Context, tx *sql.Tx) error {
	rows, e := tx.QueryContext(ctx, "SELECT data FROM events WHERE kind='entity.changed' ORDER BY seq")
	if e != nil {
		return e
	}
	var events []entityEvent
	for rows.Next() {
		var b []byte
		var v entityEvent
		if e = rows.Scan(&b); e != nil {
			rows.Close()
			return e
		}
		if e = json.Unmarshal(b, &v); e != nil {
			rows.Close()
			return e
		}
		events = append(events, v)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, "DELETE FROM entities"); e != nil {
		return e
	}
	for _, v := range events {
		if _, e = tx.ExecContext(ctx, "INSERT INTO entities VALUES(?,?,?) ON CONFLICT(kind,key) DO UPDATE SET value=excluded.value", v.Kind, v.Key, []byte(v.Value)); e != nil {
			return e
		}
	}
	return nil
}

func factRevision(ctx context.Context, tx *sql.Tx, key string) (int64, error) {
	var revision int64
	e := tx.QueryRowContext(ctx, "SELECT COALESCE(json_extract(value,'$.revision'),0) FROM entities WHERE kind='context' AND key=?", key).Scan(&revision)
	if e == sql.ErrNoRows {
		return 0, nil
	}
	return revision, e
}
