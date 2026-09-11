package api

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/coder/websocket"
	"log"
	"net/http"
	"projectzero.local/zero/core/identity"
	"projectzero.local/zero/core/protocol"
	"projectzero.local/zero/core/runtime"
	"sync"
	"time"
)

// pollDue reports whether a connection poll must run its full Known/Pending
// work: any committed write advanced the revision, or the fallback interval
// elapsed for Pending's time-based transitions (dispatch backoff, deadlines)
// which need no writer.
func pollDue(lastRev, rev uint64, lastFull, now time.Time) bool {
	return rev != lastRev || now.Sub(lastFull) >= time.Second
}

func NewNodeHandler(r *runtime.Runtime) http.Handler {
	var mu sync.Mutex
	active := map[string]context.CancelFunc{}
	return http.HandlerFunc(func(w http.ResponseWriter, q *http.Request) {
		if q.URL.Path != "/zero" || q.TLS == nil || len(q.TLS.PeerCertificates) == 0 {
			http.Error(w, "authentication required", 403)
			return
		}
		cert := q.TLS.PeerCertificates[0]
		id := cert.Subject.CommonName
		fp := identity.Fingerprint(cert)
		if !identity.ValidNode(id) || !r.Known(q.Context(), id, fp) {
			http.Error(w, "unpaired or revoked", 403)
			return
		}
		c, e := websocket.Accept(w, q, &websocket.AcceptOptions{CompressionMode: websocket.CompressionDisabled})
		if e != nil {
			return
		}
		defer c.CloseNow()
		c.SetReadLimit(protocol.MaxFrame)
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		mu.Lock()
		if old := active[id]; old != nil {
			old()
		}
		active[id] = cancel
		mu.Unlock()
		go func() { <-ctx.Done(); c.CloseNow() }()
		read := func(timeout time.Duration) (protocol.Envelope, error) {
			rc, done := context.WithTimeout(ctx, timeout)
			defer done()
			kind, b, e := c.Read(rc)
			if e != nil {
				log.Printf("node %s: receive failed: %v", id, e)
				return protocol.Envelope{}, e
			}
			if kind != websocket.MessageText {
				return protocol.Envelope{}, fmt.Errorf("JSON text required")
			}
			return protocol.Decode(b, "node:"+id, time.Now())
		}
		send := func(kind string, body any) error {
			e := protocol.New(kind, "runtime", "node:"+id, body)
			if kind == "display.telemetry" {
				e.TTL = 500
			}
			b, _ := json.Marshal(e)
			wc, done := context.WithTimeout(ctx, 10*time.Second)
			defer done()
			err := c.Write(wc, websocket.MessageText, b)
			if err != nil {
				log.Printf("node %s: send %s failed: %v", id, kind, err)
			}
			return err
		}
		hello, e := read(5 * time.Second)
		if e != nil || hello.Type != "session.hello" {
			return
		}
		if protocol.Negotiate(hello.Body) != nil {
			return
		}
		sessionID := protocol.ID()
		if e = send("session.welcome", map[string]any{"session_id": sessionID, "heartbeat_ms": 30000, "lease_ms": 90000, "max_frame": protocol.MaxFrame}); e != nil {
			return
		}
		r.Seen(ctx, id)
		if e = r.Restore(ctx, id, sessionID); e != nil {
			send("session.error", map[string]string{"error": "restore rejected"})
		}
		var audioWindow telemetryWindow
		go func() {
			ticker := time.NewTicker(100 * time.Millisecond)
			var audioSequence uint64
			var audioRev uint64
			var lastRev uint64
			var lastFull time.Time
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					now := time.Now()
					rev := r.Updates.Revision()
					// Audio frames never bump the revision, so a new sequence is
					// its own wake signal; a revision advance re-checks gates
					// that may have changed (grants, profiles, spotify state).
					// A static sequence with a static revision can deliver
					// nothing new, so the database is left untouched.
					if r.AudioSequence() != audioSequence || rev != audioRev {
						audioRev = rev
						if frame, ok := r.AudioLevels(ctx, id); ok && frame.Sequence != audioSequence && audioWindow.start(frame.Sequence) {
							if e := send("display.telemetry", map[string]any{"session_id": sessionID, "sequence": frame.Sequence, "level": frame.Level, "bass": frame.Bass}); e != nil {
								cancel()
								return
							}
							audioSequence = frame.Sequence
						}
					}
					// Commits are the only writers, so a static revision means
					// Known and Pending would repeat their last answer. The 1s
					// fallback covers Pending's time-based transitions
					// (dispatch backoff, deadlines) without any writer.
					if !pollDue(lastRev, rev, lastFull, now) {
						continue
					}
					lastRev, lastFull = rev, now
					if !r.Known(ctx, id, fp) {
						cancel()
						return
					}
					work, e := r.Pending(ctx, id)
					if e != nil {
						cancel()
						return
					}
					for _, v := range work {
						if e = send("capability.invoke", v); e != nil {
							cancel()
							return
						}
					}
				}
			}
		}()
		for {
			m, e := read(90 * time.Second)
			if e != nil {
				return
			}
			if !r.Known(ctx, id, fp) {
				return
			}
			r.Seen(ctx, id)
			switch m.Type {
			case "display.telemetry.ack":
				var receipt struct {
					SessionID string `json:"session_id"`
					Sequence  uint64 `json:"sequence"`
				}
				if e = json.Unmarshal(m.Body, &receipt); e == nil && receipt.SessionID == sessionID {
					audioWindow.ack(receipt.Sequence)
				}

			case "node.register", "capability.advertise":
				e = r.Advertise(ctx, id, m.Body)
				if e == nil {
					e = send("ack", map[string]string{"id": m.ID})
				}
			case "node.heartbeat", "sync.request":
				e = send("ack", map[string]string{"id": m.ID})
			case "capability.result":
				var b struct {
					ID     string          `json:"id"`
					Status string          `json:"status"`
					Output json.RawMessage `json:"output"`
				}
				if e = json.Unmarshal(m.Body, &b); e == nil {
					if len(b.Output) == 0 {
						b.Output = json.RawMessage(`{}`)
					}
					e = r.Result(ctx, id, b.ID, b.Status, b.Output)
				}
				if e == nil {
					e = send("ack", map[string]string{"id": m.ID})
				}
			case "event.publish":
				var b struct {
					Type      string `json:"type"`
					SessionID string `json:"session_id"`
				}
				if e = json.Unmarshal(m.Body, &b); e == nil {
					if b.Type != "input.button" || b.SessionID != sessionID {
						e = fmt.Errorf("invalid event/session")
					} else {
						_, e = r.Execute(ctx, "node:"+id, runtime.Request{ID: m.ID, Op: "session.toggle", Body: json.RawMessage(`{}`)})
					}
				}
				if e == nil {
					e = send("ack", map[string]string{"id": m.ID})
				}
			default:
				e = fmt.Errorf("unsupported node message")
			}
			if e != nil {
				if send("session.error", map[string]string{"id": m.ID, "error": "message rejected"}) != nil {
					return
				}
			}
		}
	})
}
