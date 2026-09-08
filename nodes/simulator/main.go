package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"projectzero.local/zero/core/identity"
	"projectzero.local/zero/core/runtime"
	"projectzero.local/zero/sdk/go/node"
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
	dir := flag.String("data", ".runtime/simulator", "private simulator files")
	id := flag.String("node", "desk-simulator", "node identity")
	init := flag.Bool("init", false, "generate identity and CSR")
	enroll := flag.String("enrollment", "", "JSON enrollment result from zero nodes pair")
	url := flag.String("url", "wss://127.0.0.1:7443/zero", "runtime endpoint")
	flag.Parse()
	if e := os.MkdirAll(*dir, 0700); e != nil {
		return e
	}
	path := filepath.Join(*dir, "identity.json")
	var d node.Identity
	if *init {
		if _, e := os.Stat(path); e == nil {
			return fmt.Errorf("identity already exists")
		}
		v, e := node.NewIdentity(*id)
		if e != nil {
			return e
		}
		b, _ := json.Marshal(v)
		if e = os.WriteFile(path, b, 0600); e != nil {
			return e
		}
		if e = os.WriteFile(filepath.Join(*dir, "node.csr"), v.CSR, 0600); e != nil {
			return e
		}
		fp, _ := identity.FingerprintCSR(v.CSR)
		fmt.Println("CSR:", filepath.Join(*dir, "node.csr"))
		fmt.Println("Verify fingerprint:", fp)
		return nil
	}
	b, e := os.ReadFile(path)
	if e != nil {
		return e
	}
	if e = json.Unmarshal(b, &d); e != nil {
		return e
	}
	if *enroll != "" {
		b, e = os.ReadFile(*enroll)
		if e != nil {
			return e
		}
		var v struct {
			Certificate []byte `json:"certificate"`
			CA          []byte `json:"ca"`
		}
		if e = json.Unmarshal(b, &v); e != nil {
			return e
		}
		d.Certificate = v.Certificate
		d.CA = v.CA
		b, _ = json.Marshal(d)
		return os.WriteFile(path, b, 0600)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	buttons := make(chan struct{})
	go func() {
		s := bufio.NewScanner(os.Stdin)
		for s.Scan() {
			select {
			case buttons <- struct{}{}:
			default:
			}
		}
	}()
	for ctx.Err() == nil {
		e = d.Run(ctx, *url, func(v runtime.Invocation) error {
			b, _ := json.Marshal(v)
			fmt.Println(string(b))
			return os.WriteFile(filepath.Join(*dir, "display.json"), v.Input, 0600)
		}, buttons)
		if ctx.Err() != nil {
			break
		}
		fmt.Fprintln(os.Stderr, "reconnecting:", e)
		select {
		case <-ctx.Done():
		case <-time.After(time.Second):
		}
	}
	return nil
}
