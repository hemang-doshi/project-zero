package api

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/coder/websocket"
	"net/http"
	"projectzero.local/zero/core/identity"
	"projectzero.local/zero/core/protocol"
	"projectzero.local/zero/core/runtime"
	"sync"
	"time"
)

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
				return protocol.Envelope{}, e
			}
			if kind != websocket.MessageText {
				return protocol.Envelope{}, fmt.Errorf("JSON text required")
			}
			return protocol.Decode(b, "node:"+id, time.Now())
		}
		send := func(kind string, body any) error {
			e := protocol.New(kind, "runtime", "node:"+id, body)
			b, _ := json.Marshal(e)
			wc, done := context.WithTimeout(ctx, 3*time.Second)
			defer done()
			return c.Write(wc, websocket.MessageText, b)
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
		go func() {
			ticker := time.NewTicker(250 * time.Millisecond)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
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
