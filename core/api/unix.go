package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"projectzero.local/zero/core/identity"
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
	mux.HandleFunc("GET /v0.1/status", func(w http.ResponseWriter, q *http.Request) {
		reply(w, map[string]any{"version": "0.1", "status": "RUNNING", "pid": os.Getpid()})
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
		if e := json.NewDecoder(q.Body).Decode(&v); e != nil {
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
		if e := json.NewDecoder(q.Body).Decode(&b); e != nil {
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
