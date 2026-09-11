package api

import (
	"testing"
	"time"
)

// The per-connection 100ms poll must stay cheap while idle: only a global
// revision advance (the only writer signal) or the 1s time-based fallback
// (Pending backoff/deadline transitions need no writer) justifies full polls.
func TestPollDueGating(t *testing.T) {
	now := time.Now()
	if !pollDue(7, 8, now.Add(-100*time.Millisecond), now) {
		t.Fatal("revision advance must poll")
	}
	if pollDue(8, 8, now.Add(-100*time.Millisecond), now) {
		t.Fatal("idle tick must skip")
	}
	if !pollDue(8, 8, now.Add(-1100*time.Millisecond), now) {
		t.Fatal("1s fallback must poll")
	}
	if pollDue(8, 8, now.Add(-999*time.Millisecond), now.Add(-time.Millisecond)) {
		t.Fatal("fallback fired early")
	}
}
