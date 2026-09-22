package main

import (
	"context"
	"crypto/tls"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"github.com/hemang-doshi/project-zero/core/api"
	"github.com/hemang-doshi/project-zero/core/identity"
	"github.com/hemang-doshi/project-zero/core/processlock"
	"github.com/hemang-doshi/project-zero/core/runtime"
	"strings"
	"syscall"
	"time"
)

func main() {
	if e := run(); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
func run() error {
	home, e := os.UserConfigDir()
	if e != nil {
		return e
	}
	data := flag.String("data", filepath.Join(home, "ProjectZero"), "owner-controlled runtime directory")
	listen := flag.String("listen", "127.0.0.1:7443", "TLS node listener; use :7443 for LAN")
	local := flag.Bool("local-only", false, "Unix API only, no node identity or listener")
	audio := flag.String("mac-audio", "", "signed Spotify-only audio level helper")
	observer := flag.String("mac-observer", "", "absolute native Spotify helper path (opt-in)")
	checkIdentity := flag.Bool("check-identity", false, "verify existing Keychain identity without starting a runtime")
	flag.Parse()
	if *checkIdentity {
		return identity.CheckExisting("project-zero.runtime-authority")
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if e := os.MkdirAll(*data, 0700); e != nil {
		return e
	}
	lock, e := processlock.Acquire(filepath.Join(*data, "runtime.lock"))
	if e != nil {
		return e
	}
	defer lock.Close()
	r, e := runtime.Open(filepath.Join(*data, "zero.db"))
	if e != nil {
		return e
	}
	defer r.Close()
	r.MacObserver = *observer
	r.MacAudio = *audio
	go r.RunAudio(ctx)
	go r.RunIntegrations(ctx)
	go r.RunMaintenance(ctx)
	var ca *identity.Authority
	if !*local {
		ca, e = identity.Load("project-zero.runtime-authority")
		if e != nil {
			return e
		}
	}
	srv, e := api.ServeUnix(ctx, r, filepath.Join(*data, "zero.sock"), ca)
	if e != nil {
		return e
	}
	defer srv.Close()
	if !*local {
		cfg, e := ca.ServerTLS()
		if e != nil {
			return e
		}
		l, e := net.Listen("tcp", *listen)
		if e != nil {
			return e
		}
		network := &http.Server{Handler: api.NewNodeHandler(r), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 90 * time.Second}
		defer network.Close()
		go network.Serve(tls.NewListener(l, cfg))
		_, port, splitErr := net.SplitHostPort(l.Addr().String())
		if splitErr == nil && !strings.HasPrefix(*listen, "127.0.0.1:") {
			advertisement := exec.CommandContext(ctx, "/usr/bin/dns-sd", "-R", "Zero", "_zero._tcp", "local", port, "zero=0.1", "pairing=closed", "class=runtime")
			if err := advertisement.Start(); err != nil {
				return fmt.Errorf("Bonjour advertisement: %w", err)
			}
			go advertisement.Wait()
		}
	}
	fmt.Fprintln(os.Stderr, "zerod ready")
	<-ctx.Done()
	return nil
}
