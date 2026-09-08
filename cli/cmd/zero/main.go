package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"projectzero.local/zero/core/identity"
	"projectzero.local/zero/core/protocol"
	"projectzero.local/zero/core/runtime"
	"projectzero.local/zero/sdk/go/client"
	"strings"
)

func main() {
	if e := run(); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(exitCode(e))
	}
}
func exitCode(e error) int {
	for prefix, code := range map[string]int{"VALIDATION:": 2, "AUTHORIZATION:": 3, "CONFLICT:": 4, "DEADLINE:": 5} {
		if strings.HasPrefix(e.Error(), prefix) {
			return code
		}
	}
	return 1
}
func print(v any) { b, _ := json.MarshalIndent(v, "", "  "); fmt.Println(string(b)) }
func run() error {
	home, e := os.UserConfigDir()
	if e != nil {
		return e
	}
	flags := flag.NewFlagSet("zero", flag.ContinueOnError)
	socket := flags.String("socket", filepath.Join(home, "ProjectZero", "zero.sock"), "runtime Unix socket")
	dry := flags.Bool("dry-run", false, "validate without committing")
	id := flags.String("id", protocol.ID(), "stable idempotency key")
	flags.Bool("json", true, "machine-readable JSON output")
	// Accept global flags before or after the command, preserving JSON as one argument.
	var opts, args []string
	raw := os.Args[1:]
	for i := 0; i < len(raw); i++ {
		a := raw[i]
		if a == "--dry-run" || a == "--json" {
			opts = append(opts, a)
		} else if a == "--socket" || a == "--id" {
			if i+1 >= len(raw) {
				return fmt.Errorf("missing flag value")
			}
			opts = append(opts, a, raw[i+1])
			i++
		} else {
			args = append(args, a)
		}
	}
	if e = flags.Parse(opts); e != nil {
		return e
	}
	if len(args) == 0 {
		return fmt.Errorf("usage: zero status | session start|pause|resume|show | nodes list|pair|revoke | capabilities list|describe|invoke | events query|replay | approvals list|approve|deny | grants set|list | privacy audit | doctor")
	}
	c := client.New(*socket)
	ctx := context.Background()
	get := func(path string) error {
		var out any
		if e := c.Get(ctx, path, &out); e != nil {
			return e
		}
		print(out)
		return nil
	}
	switch args[0] {
	case "status":
		return get("status")
	case "doctor":
		return get("doctor")
	}
	if len(args) < 2 {
		return fmt.Errorf("subcommand required")
	}
	group, sub := args[0], args[1]
	rest := args[2:]
	collection := map[string]string{"nodes": "nodes", "events": "events", "approvals": "approvals", "grants": "grants", "state": "state", "privacy": "audit", "invocations": "invocations"}
	if group == "session" && sub == "show" {
		return get("session")
	}
	if sub == "list" || sub == "query" || sub == "get" || sub == "audit" {
		if path, ok := collection[group]; ok {
			return get(path)
		}
	}
	if group == "capabilities" && (sub == "list" || sub == "describe") {
		print(map[string]any{"version": "0.1", "capabilities": []string{"display.render", "display.clear", "session.start", "session.pause", "session.resume", "session.toggle"}})
		return nil
	}
	if group == "nodes" && sub == "pair" {
		if len(rest) != 3 {
			return fmt.Errorf("usage: zero nodes pair NODE CSR_FILE VERIFIED_SHA256_FINGERPRINT")
		}
		csr, e := os.ReadFile(rest[1])
		if e != nil {
			return e
		}
		fp, e := identity.FingerprintCSR(csr)
		if e != nil {
			return e
		}
		if !strings.EqualFold(fp, rest[2]) {
			return fmt.Errorf("fingerprint mismatch")
		}
		if *dry {
			print(map[string]any{"version": "0.1", "status": "DRY_RUN", "node": rest[0], "fingerprint": fp})
			return nil
		}
		var window map[string]string
		if e = c.Call(ctx, "POST", "pairing/window", map[string]any{}, &window); e != nil {
			return e
		}
		var out any
		if e = c.Call(ctx, "POST", "pairing/enroll", map[string]any{"node": rest[0], "csr": csr, "fingerprint": fp, "token": window["token"]}, &out); e != nil {
			return e
		}
		print(out)
		return nil
	}
	var body any = map[string]any{}
	op := group + "." + sub
	switch op {
	case "session.start":
		if len(rest) == 0 {
			return fmt.Errorf("project name required")
		}
		body = map[string]string{"project": strings.Join(rest, " ")}
	case "session.pause", "session.resume", "events.replay":
	case "nodes.revoke":
		if len(rest) != 1 {
			return fmt.Errorf("node required")
		}
		body = map[string]string{"node": rest[0]}
	case "approvals.approve", "approvals.deny", "invocations.cancel":
		if len(rest) != 1 {
			return fmt.Errorf("invocation ID required")
		}
		body = map[string]string{"id": rest[0]}
	case "grants.set", "state.set":
		if len(rest) != 1 {
			return fmt.Errorf("grant JSON required")
		}
		body = json.RawMessage(rest[0])
	case "capabilities.invoke":
		if len(rest) != 3 {
			return fmt.Errorf("usage: zero capabilities invoke NODE CAPABILITY JSON")
		}
		body = map[string]any{"node": rest[0], "capability": rest[1], "input": json.RawMessage(rest[2])}
	default:
		return fmt.Errorf("unsupported command %s", op)
	}
	b, e := json.Marshal(body)
	if e != nil {
		return e
	}
	out, e := c.Execute(ctx, runtime.Request{ID: *id, Op: op, Body: b, DryRun: *dry})
	if e != nil {
		return e
	}
	print(out)
	return nil
}
