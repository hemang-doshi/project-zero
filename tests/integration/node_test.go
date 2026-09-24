package integration

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"net"
	"net/http"
	"path/filepath"
	"projectzero.local/zero/core/api"
	"projectzero.local/zero/core/identity"
	"projectzero.local/zero/core/runtime"
	"projectzero.local/zero/sdk/go/node"
	"testing"
	"time"
)

func TestAuthenticatedNodeReceivesInvocation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	r, e := runtime.Open(filepath.Join(t.TempDir(), "zero.db"))
	if e != nil {
		t.Fatal(e)
	}
	defer r.Close()
	ca, _ := identity.NewAuthority()
	device, e := node.NewIdentity("desk")
	if e != nil {
		t.Fatal(e)
	}
	cert, e := ca.Enroll("desk", device.CSR)
	if e != nil {
		t.Fatal(e)
	}
	device.Certificate = cert
	device.CA = ca.Cert
	fp, _ := identity.FingerprintCSR(device.CSR)
	if e = r.Enroll(ctx, "desk", fp, []string{"display.render"}); e != nil {
		t.Fatal(e)
	}
	settings, _ := ca.ServerTLS()
	l, e := tls.Listen("tcp", "127.0.0.1:0", settings)
	if e != nil {
		t.Fatal(e)
	}
	srv := &http.Server{Handler: api.NewNodeHandler(r)}
	defer srv.Close()
	go srv.Serve(l)
	got := make(chan runtime.Invocation, 1)
	go device.Run(ctx, "wss://"+l.Addr().String()+"/zero", func(v runtime.Invocation) error { got <- v; return nil }, nil)
	for _, q := range []runtime.Request{{ID: "g", Op: "grants.set", Body: json.RawMessage(`{"principal":"owner","capability":"display.render","target":"desk","state":"ALWAYS_ALLOWED"}`)}, {ID: "render", Op: "capabilities.invoke", Body: json.RawMessage(`{"node":"desk","capability":"display.render","input":{"project":"Zero"}}`)}} {
		if _, e = r.Execute(ctx, "owner", q); e != nil {
			t.Fatal(e)
		}
	}
	select {
	case v := <-got:
		if v.ID != "render" {
			t.Fatalf("%+v", v)
		}
	case <-ctx.Done():
		t.Fatal("node did not receive work")
	}
	// The same server rejects an unauthenticated TLS client before application dispatch.
	raw, e := net.Dial("tcp", l.Addr().String())
	if e != nil {
		t.Fatal(e)
	}
	bad := tls.Client(raw, &tls.Config{InsecureSkipVerify: true, MinVersion: tls.VersionTLS12, MaxVersion: tls.VersionTLS12})
	defer bad.Close()
	if e = bad.Handshake(); e == nil {
		t.Fatal("anonymous TLS client accepted")
	}
}
