package node

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"github.com/coder/websocket"
	"net/http"
	"github.com/hemang-doshi/project-zero/core/identity"
	"github.com/hemang-doshi/project-zero/core/protocol"
	"github.com/hemang-doshi/project-zero/core/runtime"
	"time"
)

type Identity struct {
	Node        string `json:"node"`
	CSR         []byte `json:"csr"`
	Key         []byte `json:"key"`
	Certificate []byte `json:"certificate"`
	CA          []byte `json:"ca"`
}

func NewIdentity(id string) (*Identity, error) {
	if !identity.ValidNode(id) {
		return nil, fmt.Errorf("invalid node")
	}
	key, e := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if e != nil {
		return nil, e
	}
	csr, e := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{Subject: pkix.Name{CommonName: id}}, key)
	if e != nil {
		return nil, e
	}
	der, e := x509.MarshalPKCS8PrivateKey(key)
	if e != nil {
		return nil, e
	}
	return &Identity{Node: id, CSR: pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: csr}), Key: pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})}, nil
}
func (d *Identity) Run(ctx context.Context, url string, render func(runtime.Invocation) error, buttons <-chan struct{}) error {
	key, e := tls.X509KeyPair(d.Certificate, d.Key)
	if e != nil {
		return e
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(d.CA) {
		return fmt.Errorf("invalid runtime CA")
	}
	c, _, e := websocket.Dial(ctx, url, &websocket.DialOptions{HTTPClient: &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{key}, RootCAs: pool, ServerName: "zero.local"}}}})
	if e != nil {
		return e
	}
	defer c.CloseNow()
	c.SetReadLimit(protocol.MaxFrame)
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	send := func(m protocol.Envelope) error {
		b, _ := json.Marshal(m)
		wc, end := context.WithTimeout(ctx, 3*time.Second)
		defer end()
		return c.Write(wc, websocket.MessageText, b)
	}
	if e = send(protocol.New("session.hello", "node:"+d.Node, "runtime", map[string]any{"versions": []string{"0.1"}, "max_frame": protocol.MaxFrame})); e != nil {
		return e
	}
	_, b, e := c.Read(ctx)
	if e != nil {
		return e
	}
	welcome, e := protocol.Decode(b, "runtime", time.Now())
	if e != nil || welcome.Type != "session.welcome" {
		return fmt.Errorf("welcome required")
	}
	var w struct {
		SessionID string `json:"session_id"`
	}
	if e = json.Unmarshal(welcome.Body, &w); e != nil {
		return e
	}
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if send(protocol.New("node.heartbeat", "node:"+d.Node, "runtime", map[string]any{})) != nil {
					cancel()
					return
				}
			case _, ok := <-buttons:
				if !ok {
					buttons = nil
					continue
				}
				if send(protocol.New("event.publish", "node:"+d.Node, "runtime", map[string]string{"type": "input.button", "session_id": w.SessionID})) != nil {
					cancel()
					return
				}
			}
		}
	}()
	// Display actions are idempotent state assignments, including after process restarts.
	seen := map[string]string{}
	for {
		_, b, e = c.Read(ctx)
		if e != nil {
			return e
		}
		m, e := protocol.Decode(b, "runtime", time.Now())
		if e != nil {
			return e
		}
		if m.Type != "capability.invoke" {
			continue
		}
		var v runtime.Invocation
		if e = json.Unmarshal(m.Body, &v); e != nil {
			return e
		}
		status, ok := seen[v.ID]
		if !ok {
			status = "SUCCEEDED"
			if e = render(v); e != nil {
				status = "FAILED"
			}
			if len(seen) >= 128 {
				seen = map[string]string{}
			}
			seen[v.ID] = status
		}
		if e = send(protocol.New("capability.result", "node:"+d.Node, "runtime", map[string]any{"id": v.ID, "status": status, "output": map[string]any{}})); e != nil {
			return e
		}
	}
}
