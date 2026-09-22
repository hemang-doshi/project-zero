package runtime

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

type Intent struct {
	Version   string `json:"version"`
	Text      string `json:"text"`
	Status    string `json:"status"`
	Operation string `json:"operation,omitempty"`
	ProjectID string `json:"project_id,omitempty"`
	ModelUsed bool   `json:"model_used"`
	Reason    string `json:"reason,omitempty"`
}
type queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func projects(ctx context.Context, q queryer) ([]Project, error) {
	rows, e := q.QueryContext(ctx, "SELECT value FROM entities WHERE kind='project' ORDER BY key")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Project{}
	for rows.Next() {
		var b []byte
		var p Project
		if e = rows.Scan(&b); e != nil {
			return nil, e
		}
		if e = json.Unmarshal(b, &p); e != nil {
			return nil, e
		}
		if !p.Removed {
			out = append(out, p)
		}
	}
	return out, rows.Err()
}
func (r *Runtime) Projects(ctx context.Context) ([]Project, error) { return projects(ctx, r.db) }
func parseIntent(ctx context.Context, q queryer, text string) (Intent, error) {
	v := Intent{Version: "0.2", Text: text, Status: "NEEDS_CLARIFICATION"}
	if len(text) == 0 || len(text) > 512 {
		return v, fmt.Errorf("VALIDATION: intent text must be 1..512 bytes")
	}
	normalized := strings.ToLower(strings.Join(strings.Fields(text), " "))
	switch normalized {
	case "pause", "pause focus":
		v.Operation = "session.pause"
	case "resume", "resume focus":
		v.Operation = "session.resume"
	case "end focus", "stop focus":
		v.Operation = "session.end"
	case "show focus", "show session":
		v.Operation = "session.show"
	}
	if v.Operation != "" {
		v.Status = "READY"
		return v, nil
	}
	var name string
	for _, prefix := range []string{"work on ", "start focus on ", "focus on "} {
		if strings.HasPrefix(normalized, prefix) {
			name = strings.TrimPrefix(normalized, prefix)
			break
		}
	}
	if name != "" {
		all, e := projects(ctx, q)
		if e != nil {
			return v, e
		}
		var matches []Project
		for _, p := range all {
			for _, alias := range append([]string{p.ID, p.Name}, p.Aliases...) {
				if strings.ToLower(strings.Join(strings.Fields(alias), " ")) == name {
					matches = append(matches, p)
					break
				}
			}
		}
		if len(matches) == 1 {
			v.Status = "READY"
			v.Operation = "session.start"
			v.ProjectID = matches[0].ID
			return v, nil
		}
		if len(matches) > 1 {
			v.Reason = "Multiple registered projects match; use an exact project ID"
			return v, nil
		}
	}
	v.Reason = "Use a known focus command or clarify the registered project; Codex parsing is not connected"
	return v, nil
}
func (r *Runtime) ParseIntent(ctx context.Context, text string) (Intent, error) {
	return parseIntent(ctx, r.db, text)
}
func (r *Runtime) runIntent(ctx context.Context, tx *sql.Tx, q Request, v *Response) error {
	var b struct {
		Text string `json:"text"`
	}
	if e := json.Unmarshal(q.Body, &b); e != nil {
		return e
	}
	intent, e := parseIntent(ctx, tx, b.Text)
	if e != nil {
		return e
	}
	if intent.Status != "READY" {
		return fmt.Errorf("VALIDATION: %s", intent.Reason)
	}
	if e = saveEntity(ctx, tx, q.ID+":intent", "intent", q.ID, intent, r.Now()); e != nil {
		return e
	}
	if intent.Operation == "session.show" {
		s, e := readSession(ctx, tx)
		if e != nil {
			return e
		}
		if s.State == "RUNNING" {
			s.ElapsedMS += max(0, r.Now().UnixMilli()-s.SinceMS)
		}
		v.Data = s
		return nil
	}
	body, _ := json.Marshal(map[string]string{"project_id": intent.ProjectID})
	inner := Request{ID: q.ID, Op: intent.Operation, Body: body}
	if e = r.apply(ctx, tx, "owner", inner, v); e != nil {
		return e
	}
	return r.audit(ctx, tx, "owner", intent.Operation, "runtime", v.Status, q.ID)
}
