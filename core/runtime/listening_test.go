package runtime

import (
	"testing"
	"time"
)

func TestListeningPlayPauseResumeAndTrackOrder(t *testing.T) {
	at := time.Date(2026, 9, 23, 12, 0, 0, 0, time.UTC)
	data := map[string]string{"track": "One", "artist": "A"}
	s := listeningFromObservation(ListeningSession{}, "playing", data, at)
	if s.ID == "" || len(s.Tracks) != 1 || s.ActiveFrom == nil {
		t.Fatalf("start: %+v", s)
	}
	s = listeningFromObservation(s, "playing", data, at.Add(10*time.Second))
	if len(s.Tracks) != 1 {
		t.Fatalf("duplicate: %+v", s.Tracks)
	}
	s = listeningFromObservation(s, "paused", data, at.Add(20*time.Second))
	if s.ActiveDurationMS != 20000 || s.ActiveFrom != nil {
		t.Fatalf("pause: %+v", s)
	}
	s = listeningFromObservation(s, "playing", map[string]string{"track": "Two", "artist": "B"}, at.Add(30*time.Second))
	if s.ActiveDurationMS != 20000 || len(s.Tracks) != 2 || s.Tracks[1].Track != "Two" {
		t.Fatalf("resume: %+v", s)
	}
	s = listeningFromObservation(s, "playing", data, at.Add(40*time.Second))
	if len(s.Tracks) != 3 || s.Tracks[2].Track != "One" {
		t.Fatalf("repeat: %+v", s.Tracks)
	}
	prior := s
	s = listeningFromObservation(s, "paused", data, at.Add(35*time.Second))
	if !s.LastObservedAt.Equal(prior.LastObservedAt) {
		t.Fatal("out-of-order observation changed session")
	}
}

func TestListeningGapAndSourceChange(t *testing.T) {
	at := time.Date(2026, 9, 23, 12, 0, 0, 0, time.UTC)
	a := map[string]string{"track": "One", "context_uri": "spotify:playlist:a", "context_type": "playlist"}
	s := listeningFromObservation(ListeningSession{}, "playing", a, at)
	id := s.ID
	s = listeningFromObservation(s, "playing", a, at.Add(6*time.Minute))
	if s.ID == id || s.ActiveDurationMS != 0 {
		t.Fatalf("gap was merged: %+v", s)
	}
	id = s.ID
	b := map[string]string{"track": "One", "context_uri": "spotify:playlist:b", "context_type": "playlist"}
	s = listeningFromObservation(s, "playing", b, at.Add(7*time.Minute))
	if s.ID == id || s.ContextURI != b["context_uri"] {
		t.Fatalf("source changed: %+v", s)
	}
}

func TestListeningIsBoundedAndDoesNotStartWhenPaused(t *testing.T) {
	at := time.Date(2026, 9, 23, 12, 0, 0, 0, time.UTC)
	s := listeningFromObservation(ListeningSession{}, "paused", map[string]string{"track": "Old"}, at)
	if s.ID != "" {
		t.Fatal("paused observation started a session")
	}
	for i := 0; i < 60; i++ {
		s = listeningFromObservation(s, "playing", map[string]string{"track": string(rune('A' + i))}, at.Add(time.Duration(i+1)*time.Second))
	}
	if len(s.Tracks) != maxObservedTracks {
		t.Fatalf("unbounded track list: %d", len(s.Tracks))
	}
}
