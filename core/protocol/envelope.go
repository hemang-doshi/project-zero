package protocol

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"
)

const MaxFrame = 8192

type Envelope struct {
	Zero           string          `json:"zero"`
	Type           string          `json:"type"`
	ID             string          `json:"id"`
	Time           time.Time       `json:"time"`
	Source         string          `json:"source"`
	Target         string          `json:"target,omitempty"`
	CorrelationID  string          `json:"correlation_id,omitempty"`
	CausationID    string          `json:"causation_id,omitempty"`
	TraceID        string          `json:"trace_id,omitempty"`
	TTL            int64           `json:"ttl_ms,omitempty"`
	Classification string          `json:"classification,omitempty"`
	Body           json.RawMessage `json:"body"`
}

func ID() string {
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return fmt.Sprintf("%013d-%s", time.Now().UnixMilli(), hex.EncodeToString(b[:]))
}
func New(kind, source, target string, body any) Envelope {
	b, _ := json.Marshal(body)
	return Envelope{Zero: "0.1", Type: kind, ID: ID(), Time: time.Now().UTC(), Source: source, Target: target, Classification: "PRIVATE", Body: b}
}
func Decode(b []byte, source string, now time.Time) (Envelope, error) {
	var e Envelope
	if len(b) > MaxFrame {
		return e, fmt.Errorf("RESOURCE: frame exceeds %d", MaxFrame)
	}
	if err := json.Unmarshal(b, &e); err != nil {
		return e, fmt.Errorf("VALIDATION: invalid JSON")
	}
	allowed := map[string]bool{"session.hello": true, "session.welcome": true, "node.register": true, "node.heartbeat": true, "capability.advertise": true, "capability.invoke": true, "capability.accepted": true, "capability.result": true, "event.publish": true, "state.result": true, "sync.request": true, "ack": true, "session.error": true}
	if e.Zero != "0.1" || !allowed[e.Type] || len(e.ID) == 0 || len(e.ID) > 128 || e.Time.IsZero() || e.Source != source {
		return e, fmt.Errorf("VALIDATION: envelope or source mismatch")
	}
	body := bytes.TrimSpace(e.Body)
	if len(body) < 2 || body[0] != '{' {
		return e, fmt.Errorf("VALIDATION: object body required")
	}
	if e.Classification != "" && e.Classification != "PRIVATE" && e.Classification != "INTERNAL" && e.Classification != "PUBLIC" {
		return e, fmt.Errorf("AUTHORIZATION: unsupported data classification")
	}
	if e.TTL < 0 || e.TTL > 86400000 {
		return e, fmt.Errorf("VALIDATION: invalid deadline")
	}
	if e.TTL > 0 && now.After(e.Time.Add(time.Duration(e.TTL)*time.Millisecond)) {
		return e, fmt.Errorf("DEADLINE: expired")
	}
	return e, nil
}
