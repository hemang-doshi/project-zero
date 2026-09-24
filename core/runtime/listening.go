package runtime

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"
)

// ListeningSession contains only observations made by the local Spotify helper.
// It makes no claim about tracks played before observation began.
type ListeningSession struct {
	ID               string          `json:"id"`
	Source           string          `json:"source"`
	StartedAt        time.Time       `json:"started_at"`
	LastObservedAt   time.Time       `json:"last_observed_at"`
	EndedAt          *time.Time      `json:"ended_at,omitempty"`
	PlaybackState    string          `json:"playback_state"`
	ActiveDurationMS int64           `json:"active_duration_ms"`
	ActiveFrom       *time.Time      `json:"active_from,omitempty"`
	ContextType      string          `json:"context_type,omitempty"`
	ContextURI       string          `json:"context_uri,omitempty"`
	Tracks           []ObservedTrack `json:"tracks"`
}

type ObservedTrack struct {
	Track      string    `json:"track"`
	Artist     string    `json:"artist"`
	URI        string    `json:"uri,omitempty"`
	ObservedAt time.Time `json:"observed_at"`
}

const listeningGap = 5 * time.Minute
const maxObservedTracks = 50

func listeningFromObservation(previous ListeningSession, state string, data map[string]string, at time.Time) ListeningSession {
	if !previous.LastObservedAt.IsZero() && !at.After(previous.LastObservedAt) {
		return previous
	}
	playing := state == "playing"
	if previous.ID == "" && !playing {
		return previous
	}
	newSession := previous.ID == "" || previous.EndedAt != nil ||
		(at.Sub(previous.LastObservedAt) > listeningGap) ||
		(previous.ContextURI != "" && data["context_uri"] != "" && previous.ContextURI != data["context_uri"])
	if newSession && playing {
		previous = ListeningSession{
			ID: at.UTC().Format("20060102T150405.000000000Z"), Source: "local-spotify-observer",
			StartedAt: at, ActiveFrom: &at, Tracks: []ObservedTrack{},
		}
	} else if newSession {
		if previous.ID != "" && previous.EndedAt == nil {
			previous.EndedAt = &at
			previous.ActiveFrom = nil
			previous.PlaybackState = state
		}
		return previous
	}
	if previous.ActiveFrom != nil && !playing {
		previous.ActiveDurationMS += max(0, at.Sub(*previous.ActiveFrom).Milliseconds())
		previous.ActiveFrom = nil
	}
	if previous.ActiveFrom == nil && playing {
		previous.ActiveFrom = &at
	}
	previous.LastObservedAt = at
	previous.PlaybackState = state
	previous.ContextType = data["context_type"]
	previous.ContextURI = data["context_uri"]
	if state == "stopped" || state == "not_running" {
		previous.EndedAt = &at
	}
	track := data["track"]
	artist := data["artist"]
	if playing && track != "" {
		last := ObservedTrack{}
		if n := len(previous.Tracks); n > 0 {
			last = previous.Tracks[n-1]
		}
		if last.Track != track || last.Artist != artist || last.URI != data["track_uri"] {
			previous.Tracks = append(previous.Tracks, ObservedTrack{Track: track, Artist: artist, URI: data["track_uri"], ObservedAt: at})
			if len(previous.Tracks) > maxObservedTracks {
				previous.Tracks = previous.Tracks[len(previous.Tracks)-maxObservedTracks:]
			}
		}
	}
	return previous
}

func readListening(ctx context.Context, tx *sql.Tx) (ListeningSession, error) {
	var session ListeningSession
	var raw []byte
	err := tx.QueryRowContext(ctx, "SELECT value FROM entities WHERE kind='listening_session' AND key='current'").Scan(&raw)
	if err == sql.ErrNoRows {
		return session, nil
	}
	if err != nil {
		return session, err
	}
	err = json.Unmarshal(raw, &session)
	return session, err
}
