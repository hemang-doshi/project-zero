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

	if e.Zero != "0.1" || !messageTypes[e.Type] || len(e.ID) == 0 || len(e.ID) > 128 || e.Time.IsZero() || e.Source != source {
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
