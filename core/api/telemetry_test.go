package api

import "testing"

func TestTelemetryWindowRequiresMatchingReceipt(t *testing.T) {
	var w telemetryWindow
	if !w.start(1) {
		t.Fatal("first frame blocked")
	}
	for i := uint64(2); i < 100; i++ {
		if w.start(i) {
			t.Fatal("audio backlog permitted")
		}
	}
	w.ack(99)
	if w.start(100) {
		t.Fatal("unrelated receipt released window")
	}
	w.ack(1)
	if !w.start(100) {
		t.Fatal("latest sample could not replace acknowledged sample")
	}
	w.ack(1)
	if w.start(101) {
		t.Fatal("duplicate receipt released new frame")
	}
}
