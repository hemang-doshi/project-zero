package runtime

import (
	"context"
	"encoding/json"
	"github.com/hemang-doshi/project-zero/core/release"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode"
)

// Update invalidates display domains; it never carries command or state payloads.
// Revisions are scoped to this daemon process. Reconnect always requires a snapshot.
type Update struct {
	Revision  uint64    `json:"revision"`
	Domains   []string  `json:"domains"`
	Timestamp time.Time `json:"timestamp"`
	// encoded is the wire serialization computed once per publish and shared
	// by every subscriber that received the event without coalescing. It is
	// never part of the JSON payload.
	encoded []byte
}

// Encoded returns the shared serialized bytes for this update, or nil when the
// subscriber must serialize its own (possibly coalesced) copy.
func (u Update) Encoded() []byte { return u.encoded }

var cockpitDomains = []string{"session", "projects", "integrations", "policies", "context", "nodes", "node_profiles", "approvals", "firings", "invocations", "events", "audit", "state", "grants"}

type Updates struct {
	mu          sync.Mutex
	revision    uint64
	subscribers map[chan Update]struct{}
}

func NewUpdates() *Updates { return &Updates{subscribers: make(map[chan Update]struct{})} }

func (u *Updates) Revision() uint64 {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.revision
}

func (u *Updates) Subscribe() (Update, <-chan Update, func()) {
	u.mu.Lock()
	defer u.mu.Unlock()
	ch := make(chan Update, 1)
	u.subscribers[ch] = struct{}{}
	return Update{Revision: u.revision, Domains: []string{}, Timestamp: time.Now().UTC()}, ch, func() {
		u.mu.Lock()
		defer u.mu.Unlock()
		if _, ok := u.subscribers[ch]; ok {
			delete(u.subscribers, ch)
			close(ch)
		}
	}
}

func mergeDomains(a, b []string) []string {
	merged := append(slices.Clone(a), b...)
	slices.Sort(merged)
	return slices.Compact(merged)
}

func (u *Updates) Publish(domains ...string) {
	// A fixed vocabulary bounds coalescing even if a producer supplies bad input.
	valid := []string{}
	for _, domain := range domains {
		if slices.Contains(cockpitDomains, domain) {
			valid = append(valid, domain)
		}
	}
	if len(valid) == 0 {
		return
	}
	u.mu.Lock()
	defer u.mu.Unlock()
	u.revision++
	event := Update{Revision: u.revision, Domains: mergeDomains(nil, valid), Timestamp: time.Now().UTC()}
	// Serialize once; every non-coalescing subscriber replays these bytes.
	wire, err := json.Marshal(event)
	if err != nil {
		wire = nil
	}
	event.encoded = wire
	for ch := range u.subscribers {
		next := event
		select {
		case previous := <-ch:
			next.Domains = mergeDomains(previous.Domains, next.Domains)
			next.encoded = nil
		default:
		}
		// Only this mutex's holder sends; the channel now has capacity.
		ch <- next
	}
}

// Called by mutation defers after rollback/commit cleanup. No subscriber send
// occurs while holding the runtime database mutex.
func (r *Runtime) unlockAndPublish(committed *bool, domains ...string) {
	r.mu.Unlock()
	if *committed {
		r.Updates.Publish(domains...)
	}
}

func commandDomains(op string) []string {
	domains := []string{"audit"}
	switch strings.SplitN(op, ".", 2)[0] {
	case "session", "intent":
		domains = append(domains, "session", "context", "events", "invocations", "approvals")
	case "projects":
		domains = append(domains, "projects", "events")
	case "context":
		domains = append(domains, "context", "events")
	case "integration", "integrations":
		domains = append(domains, "integrations", "context", "events", "invocations", "approvals")
	case "policies":
		domains = append(domains, "policies", "firings", "events")
	case "notifications":
		domains = append(domains, "firings", "events")
	case "nodes":
		domains = append(domains, "nodes", "invocations", "approvals")
	case "grants":
		domains = append(domains, "grants")
	case "capabilities", "invocations":
		domains = append(domains, "invocations", "approvals")
	case "approvals":
		domains = append(domains, "approvals", "invocations", "session", "context", "events")
	case "state":
		domains = append(domains, "state", "events")
	case "events":
		domains = slices.Clone(cockpitDomains)
	}
	return domains
}

// Cockpit is a bounded owner-local display projection. Historical records expose
// metadata only; arbitrary event/state blobs, artwork, fingerprints and results
// are deliberately absent. Full evidence remains on the existing API routes.
func (r *Runtime) Cockpit(ctx context.Context) (map[string]any, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	session, err := readSession(ctx, tx)
	tx.Rollback()
	if err != nil {
		return nil, err
	}
	if session.State == "RUNNING" {
		session.ElapsedMS += max(0, r.Now().UnixMilli()-session.SinceMS)
	}
	integrations, err := r.Integrations(ctx)
	if err != nil {
		return nil, err
	}
	for i := range integrations {
		data := map[string]string{}
		for _, key := range []string{"branch", "dirty", "state", "track", "artist", "artwork_id", "audio_capture"} {
			if value, ok := integrations[i].Data[key]; ok {
				data[key] = value
			}
		}
		integrations[i].Data = data
	}
	policies, err := r.Policies(ctx)
	if err != nil {
		return nil, err
	}
	currentContext, err := r.Context(ctx)
	if err != nil {
		return nil, err
	}
	truncated := map[string]bool{}
	r.audioMu.Lock()
	audioFrame := r.audio
	audioStatus := r.audioStatus
	r.audioMu.Unlock()
	if audioStatus == "" {
		audioStatus = "DISABLED"
	}
	out := map[string]any{"version": "0.1", "revision": r.Updates.Revision(), "timestamp": r.Now().UTC(), "status": "RUNNING", "runtime_version": release.Current().Version, "release": release.Current(), "session": session, "integrations": integrations, "policies": policies, "context": currentContext, "audio": map[string]any{"level": audioFrame.Level, "bass": audioFrame.Bass, "sequence": audioFrame.Sequence, "status": audioStatus}, "truncated": truncated}
	queries := map[string]string{
		"projects":      "SELECT value FROM entities WHERE kind='project' AND COALESCE(json_extract(value,'$.removed'),0)=0 ORDER BY key",
		"nodes":         "SELECT id,revoked,capabilities,last_seen FROM nodes ORDER BY id",
		"node_profiles": "SELECT key AS id,value FROM entities WHERE kind='node_profile' ORDER BY key",
		"approvals":     "SELECT id,node,capability,input,hash,status,deadline FROM invocations WHERE status='WAITING_APPROVAL' ORDER BY rowid DESC",
		"firings":       "SELECT value FROM entities WHERE kind='firing' ORDER BY rowid DESC",
		"invocations":   "SELECT id,principal,node,capability,status,approved,deadline,attempts FROM invocations ORDER BY rowid DESC",
		"events":        "SELECT seq,id,kind,time FROM events ORDER BY seq DESC",
		"audit":         "SELECT seq,principal,action,target,decision,correlation,time,previous_hash,hash FROM audit_entries ORDER BY seq DESC",
	}
	for kind, query := range queries {
		rows, err := r.queryList(ctx, kind, query+" LIMIT 101")
		if err != nil {
			return nil, err
		}
		truncated[kind] = len(rows) > 100
		if len(rows) > 100 {
			rows = rows[:100]
		}
		values := []any{}
		for _, row := range rows {
			if kind == "projects" || kind == "firings" {
				values = append(values, row["value"])
				continue
			}
			if kind == "approvals" {
				// Only known session/display inputs belong in this display projection.
				var input map[string]any
				if raw, ok := row["input"].(json.RawMessage); ok {
					if err := json.Unmarshal(raw, &input); err != nil {
						return nil, err
					}
				}
				summary := map[string]any{}
				for _, key := range []string{"project", "project_id", "state", "elapsed_ms", "since_ms", "revision", "expected_revision", "track", "artist", "git", "agent", "media"} {
					if value, ok := input[key]; ok {
						switch value.(type) {
						case string, float64:
							summary[key] = value
						}
					}
				}
				row["input"] = summary
				row["input_omitted"] = len(summary) != len(input)
			}
			values = append(values, row)
		}
		out[kind] = values
	}
	// Normalize typed values before applying the same display bounds everywhere.
	encoded, err := json.Marshal(out)
	if err != nil {
		return nil, err
	}
	decoder := json.NewDecoder(strings.NewReader(string(encoded)))
	decoder.UseNumber()
	if err = decoder.Decode(&out); err != nil {
		return nil, err
	}
	return displayValue(out, 0).(map[string]any), nil
}

func displayValue(value any, depth int) any {
	if depth > 8 {
		return nil
	}
	switch v := value.(type) {
	case string:
		v = strings.Map(func(r rune) rune {
			if unicode.IsControl(r) {
				return -1
			}
			return r
		}, v)
		if len(v) > 1024 {
			v = string([]rune(v)[:min(256, len([]rune(v)))]) + "…"
		}
		return v
	case []any:
		if len(v) > 100 {
			v = v[:100]
		}
		for i := range v {
			v[i] = displayValue(v[i], depth+1)
		}
		return v
	case map[string]any:
		out := map[string]any{}
		keys := make([]string, 0, len(v))
		for key := range v {
			keys = append(keys, key)
		}
		slices.Sort(keys)
		for _, key := range keys[:min(64, len(keys))] {
			out[displayValue(key, 0).(string)] = displayValue(v[key], depth+1)
		}
		return out
	default:
		return value
	}
}
