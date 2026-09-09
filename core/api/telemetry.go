package api

import "sync"

// One transient sample may be in flight. Missing receipts suspend audio,
// leaving command dispatch operational without adding stale stream data.
type telemetryWindow struct {
	mu      sync.Mutex
	pending uint64
}

func (w *telemetryWindow) start(sequence uint64) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.pending != 0 || sequence == 0 {
		return false
	}
	w.pending = sequence
	return true
}
func (w *telemetryWindow) ack(sequence uint64) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.pending == sequence {
		w.pending = 0
	}
}
