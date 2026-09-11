package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"projectzero.local/zero/core/identity"
	"projectzero.local/zero/core/release"
	"projectzero.local/zero/core/runtime"
	"strings"
	"sync"
	"time"
)

type pairing struct {
	Node        string `json:"node"`
	CSR         []byte `json:"csr"`
	Fingerprint string `json:"fingerprint"`
	Token       string `json:"token"`
}

func ServeUnix(ctx context.Context, r *runtime.Runtime, path string, ca *identity.Authority) (*http.Server, error) {
	if e := os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		return nil, e
	}
	if _, e := os.Lstat(path); e == nil {
		c, e := net.DialTimeout("unix", path, time.Second)
		if e == nil {
			c.Close()
			return nil, fmt.Errorf("runtime already listening")
		}
		info, e := os.Lstat(path)
		if e != nil || info.Mode()&os.ModeSocket == 0 {
			return nil, fmt.Errorf("refusing to replace non-socket")
		}
		if e = os.Remove(path); e != nil {
			return nil, e
		}
	}
	l, e := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if e != nil {
		return nil, e
	}
	if e = os.Chmod(path, 0600); e != nil {
		l.Close()
		return nil, e
	}
	mux := http.NewServeMux()
	reply := func(w http.ResponseWriter, v any) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(v)
	}
	fail := func(w http.ResponseWriter, e error) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(400)
		json.NewEncoder(w).Encode(map[string]string{"error": e.Error()})
	}
	// The cockpit snapshot is rebuilt only when the projection revision
	// advances; repeat GETs replay the same serialized bytes.
	snapshots := &snapshotCache{
		current: r.Updates.Revision,
		build: func(q context.Context) ([]byte, error) {
			value, err := r.Cockpit(q)
			if err != nil {
				return nil, err
			}
			data, err := json.Marshal(value)
			if err != nil {
				return nil, err
			}
			return append(data, '\n'), nil
		},
	}
	mux.HandleFunc("GET /v0.1/cockpit", func(w http.ResponseWriter, q *http.Request) {
		data, err := snapshots.get(q.Context())
		if err != nil {
			fail(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(data)
	})
	mux.HandleFunc("GET /v0.1/cockpit/stream", func(w http.ResponseWriter, q *http.Request) {
		controller := http.NewResponseController(w)
		// This response lives beyond the ordinary request deadline. Each actual
		// frame still has a bounded write so a stalled reader cannot pin a handler.
		if err := controller.SetWriteDeadline(time.Time{}); err != nil {
			fail(w, err)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		ready, updates, cancel := r.Updates.Subscribe()
		defer cancel()
		send := func(name string, value runtime.Update) error {
			if err := controller.SetWriteDeadline(time.Now().Add(5 * time.Second)); err != nil {
				return err
			}
			// Publish shares one serialization across subscribers; only a
			// coalesced (or per-request) update is marshaled here.
			data := value.Encoded()
			var err error
			if data == nil {
				data, err = json.Marshal(value)
				if err != nil {
					return err
				}
			}
			if _, err = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", name, data); err != nil {
				return err
			}
			if err = controller.Flush(); err != nil {
				return err
			}
			return controller.SetWriteDeadline(time.Time{})
		}
		if err := send("ready", ready); err != nil {
			return
		}
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-q.Context().Done():
				return
			case update, ok := <-updates:
				if !ok {
					return
				}
				if err := send("runtime.changed", update); err != nil {
					return
				}
			case <-ticker.C:
				if err := send("keepalive", runtime.Update{Revision: r.Updates.Revision(), Domains: []string{}, Timestamp: time.Now().UTC()}); err != nil {
					return
				}
			}
		}
	})
	mux.HandleFunc("GET /v0.1/policies/report", func(w http.ResponseWriter, q *http.Request) {
		v, e := r.DailyReport(q.Context())
		if e != nil {
			fail(w, e)
			return
		}
		reply(w, v)
	})
	mux.HandleFunc("GET /v0.1/costs/today", func(w http.ResponseWriter, q *http.Request) {
		reply(w, map[string]any{"version": "0.2", "model_adapter": "NOT_CONNECTED", "zero_model_calls": 0, "monetary_cost": nil, "account_usage": "unavailable"})
	})
	mux.HandleFunc("GET /v0.1/projects/{id}", func(w http.ResponseWriter, q *http.Request) {
		ps, e := r.Projects(q.Context())
		if e != nil {
			fail(w, e)
			return
		}
		for _, p := range ps {
			if p.ID == q.PathValue("id") {
				reply(w, map[string]any{"version": "0.2", "project": p})
				return
			}
		}
		fail(w, fmt.Errorf("VALIDATION: project not found"))
	})
	mux.HandleFunc("GET /v0.1/policies", func(w http.ResponseWriter, q *http.Request) {
		v, e := r.Policies(q.Context())
		if e != nil {
			fail(w, e)
			return
		}
		reply(w, map[string]any{"version": "0.2", "policies": v})
	})
	mux.HandleFunc("GET /v0.1/integrations", func(w http.ResponseWriter, q *http.Request) {
		v, e := r.Integrations(q.Context())
		if e != nil {
			fail(w, e)
			return
		}
		reply(w, map[string]any{"version": "0.2", "integrations": v})
	})
	mux.HandleFunc("POST /v0.1/integrations/sync", func(w http.ResponseWriter, q *http.Request) {
		var b struct {
			ID     string `json:"id"`
			DryRun bool   `json:"dry_run"`
		}
		q.Body = http.MaxBytesReader(w, q.Body, 1024)
		if e := decodeStrict(q.Body, &b); e != nil {
			fail(w, e)
			return
		}
		if b.ID != "git" && b.ID != "spotify" {
			fail(w, fmt.Errorf("VALIDATION: unsupported integration"))
			return
		}
		integrations, err := r.Integrations(q.Context())
		if err != nil {
			fail(w, err)
			return
		}
		enabled := false
		for _, integration := range integrations {
			if integration.ID == b.ID {
				enabled = integration.Enabled
			}
		}
		if !enabled {
			fail(w, fmt.Errorf("AUTHORIZATION: integration disabled"))
			return
		}
		if b.DryRun {
			reply(w, map[string]string{"version": "0.2", "status": "DRY_RUN"})
			return
		}
		if e := r.SyncIntegration(q.Context(), b.ID); e != nil {
			fail(w, e)
			return
		}
		reply(w, map[string]string{"version": "0.2", "status": "SUCCEEDED"})
	})
	mux.HandleFunc("GET /v0.1/projects", func(w http.ResponseWriter, q *http.Request) {
		v, e := r.Projects(q.Context())
		if e != nil {
			fail(w, e)
			return
		}
		reply(w, map[string]any{"version": "0.2", "projects": v})
	})
	mux.HandleFunc("GET /v0.1/context/current", func(w http.ResponseWriter, q *http.Request) {
		v, e := r.Context(q.Context())
		if e != nil {
			fail(w, e)
			return
		}
		reply(w, map[string]any{"version": "0.2", "context": v})
	})
	mux.HandleFunc("GET /v0.1/intent/parse", func(w http.ResponseWriter, q *http.Request) {
		v, e := r.ParseIntent(q.Context(), q.URL.Query().Get("text"))
		if e != nil {
			fail(w, e)
			return
		}
		reply(w, v)
	})
	mux.HandleFunc("GET /v0.1/status", func(w http.ResponseWriter, q *http.Request) {
		reply(w, map[string]any{"version": "0.1", "status": "RUNNING", "runtime_version": release.Current().Version, "release": release.Current(), "pid": os.Getpid()})
	})
	mux.HandleFunc("GET /v0.1/doctor", func(w http.ResponseWriter, q *http.Request) {
		if e := r.VerifyAudit(q.Context()); e != nil {
			fail(w, e)
			return
		}
		profiles, err := r.List(q.Context(), "node_profiles")
		if err != nil {
			fail(w, err)
			return
		}
		nodes, err := r.List(q.Context(), "nodes")
		if err != nil {
			fail(w, err)
			return
		}
		reply(w, map[string]any{"nodes": nodes, "node_profiles": profiles, "version": "0.1", "audit_chain": "VALID", "status": "RUNNING", "release": release.Current(), "socket": path, "data_directory": filepath.Dir(path)})
	})
	mux.HandleFunc("GET /v0.1/session", func(w http.ResponseWriter, q *http.Request) {
		v, e := r.Session(q.Context())
		if e != nil {
			fail(w, e)
			return
		}
		reply(w, v)
	})
	mux.HandleFunc("GET /v0.1/{collection}", func(w http.ResponseWriter, q *http.Request) {
		v, e := r.List(q.Context(), q.PathValue("collection"))
		if e != nil {
			fail(w, e)
			return
		}
		reply(w, v)
	})
	mux.HandleFunc("POST /v0.1/commands", func(w http.ResponseWriter, q *http.Request) {
		var v runtime.Request
		q.Body = http.MaxBytesReader(w, q.Body, 8192)
		if e := decodeStrict(q.Body, &v); e != nil {
			fail(w, e)
			return
		}
		out, e := r.Execute(q.Context(), "owner", v)
		if e != nil {
			fail(w, e)
			return
		}
		reply(w, out)
	})
	var mu sync.Mutex
	windows := map[string]time.Time{}
	mux.HandleFunc("POST /v0.1/pairing/window", func(w http.ResponseWriter, q *http.Request) {
		if ca == nil {
			fail(w, fmt.Errorf("identity unavailable"))
			return
		}
		var b [24]byte
		if _, e := rand.Read(b[:]); e != nil {
			fail(w, e)
			return
		}
		token := hex.EncodeToString(b[:])
		mu.Lock()
		for k, t := range windows {
			if time.Now().After(t) {
				delete(windows, k)
			}
		}
		if len(windows) >= 4 {
			mu.Unlock()
			fail(w, fmt.Errorf("too many pairing windows"))
			return
		}
		windows[token] = time.Now().Add(2 * time.Minute)
		mu.Unlock()
		reply(w, map[string]string{"token": token, "expires_in": "120s"})
	})
	mux.HandleFunc("POST /v0.1/pairing/enroll", func(w http.ResponseWriter, q *http.Request) {
		if ca == nil {
			fail(w, fmt.Errorf("identity unavailable"))
			return
		}
		q.Body = http.MaxBytesReader(w, q.Body, 8192)
		var b pairing
		if e := decodeStrict(q.Body, &b); e != nil {
			fail(w, e)
			return
		}
		mu.Lock()
		expiry, ok := windows[b.Token]
		delete(windows, b.Token)
		mu.Unlock()
		if !ok || time.Now().After(expiry) {
			fail(w, fmt.Errorf("pairing window expired"))
			return
		}
		fp, e := identity.FingerprintCSR(b.CSR)
		if e != nil || !strings.EqualFold(fp, b.Fingerprint) {
			fail(w, fmt.Errorf("fingerprint mismatch"))
			return
		}
		cert, e := ca.Enroll(b.Node, b.CSR)
		if e != nil {
			fail(w, e)
			return
		}
		if e = r.Enroll(q.Context(), b.Node, fp, []string{"display.render", "display.clear"}); e != nil {
			fail(w, e)
			return
		}
		reply(w, map[string]any{"certificate": cert, "ca": ca.Cert, "node": b.Node})
	})
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second}
	go func() { <-ctx.Done(); srv.Close() }()
	go srv.Serve(&ownerListener{l})
	return srv, nil
}

type ownerListener struct{ *net.UnixListener }

func (l *ownerListener) Accept() (net.Conn, error) {
	for {
		c, e := l.AcceptUnix()
		if e != nil {
			return nil, e
		}
		if sameOwner(c) {
			return c, nil
		}
		c.Close()
	}
}

func decodeStrict(reader io.Reader, v any) error {
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(v); err != nil {
		return fmt.Errorf("VALIDATION: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return fmt.Errorf("VALIDATION: trailing JSON")
	}
	return nil
}
