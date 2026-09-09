package runtime

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"projectzero.local/zero/core/protocol"
	"strings"
	"unicode/utf8"
)

func (r *Runtime) Advertise(ctx context.Context, node string, body json.RawMessage) error {
	var b struct {
		Capabilities []string `json:"capabilities"`
		RenderSchema string   `json:"render_schema"`
		Firmware     string   `json:"firmware"`
		Build        string   `json:"build"`
		Artwork      string   `json:"artwork"`
		Audio        string   `json:"audio"`
	}
	if len(body) > 2048 || json.Unmarshal(body, &b) != nil || len(b.Capabilities) > 2 || len(b.Firmware) > 64 || len(b.Build) > 64 {
		return fmt.Errorf("VALIDATION: advertisement bounds")
	}
	if b.Audio != "" && b.Audio != "levels-v1" && b.Audio != "levels-v2" {
		return fmt.Errorf("VALIDATION: audio profile")
	}
	if b.Artwork != "" && b.Artwork != "rgb565-32" {
		return fmt.Errorf("VALIDATION: artwork profile")
	}
	if b.RenderSchema == "" {
		b.RenderSchema = "0.1"
	}
	if b.RenderSchema != "0.1" && b.RenderSchema != "0.2" {
		return fmt.Errorf("VALIDATION: render schema")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	tx, e := r.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var caps []byte
	if e = tx.QueryRowContext(ctx, "SELECT capabilities FROM nodes WHERE id=? AND revoked=0", node).Scan(&caps); e != nil {
		return e
	}
	var ceiling []string
	json.Unmarshal(caps, &ceiling)
	for _, cap := range b.Capabilities {
		found := false
		for _, allowed := range ceiling {
			if cap == allowed {
				found = true
			}
		}
		if !found {
			return fmt.Errorf("AUTHORIZATION: advertised capability outside enrollment ceiling")
		}
	}
	id := protocol.ID()
	if e = saveEntity(ctx, tx, id, "node_profile", node, map[string]string{"render_schema": b.RenderSchema, "version": b.Firmware, "build": b.Build, "artwork": b.Artwork, "audio": b.Audio}, r.Now()); e != nil {
		return e
	}
	if e = r.audit(ctx, tx, "node:"+node, "capability.advertise", node, "ALLOW", id); e != nil {
		return e
	}
	s, e := readSession(ctx, tx)
	if e != nil {
		return e
	}
	if e = r.queueSession(ctx, tx, id, s); e != nil {
		return e
	}
	return tx.Commit()
}
func hybrid(ctx context.Context, tx *sql.Tx, node string) bool {
	var b []byte
	var p map[string]string
	return tx.QueryRowContext(ctx, "SELECT value FROM entities WHERE kind='node_profile' AND key=?", node).Scan(&b) == nil && json.Unmarshal(b, &p) == nil && p["render_schema"] == "0.2"
}
func supportsArtwork(ctx context.Context, tx *sql.Tx, node string) bool {
	var raw []byte
	var profile map[string]string
	return tx.QueryRowContext(ctx, "SELECT value FROM entities WHERE kind='node_profile' AND key=?", node).Scan(&raw) == nil && json.Unmarshal(raw, &profile) == nil && profile["artwork"] == "rgb565-32"
}
func shortText(s string) string {
	if len(s) <= 64 {
		return s
	}
	s = s[:64]
	for !utf8.ValidString(s) {
		s = s[:len(s)-1]
	}
	return s
}
func (r *Runtime) displayPayload(ctx context.Context, tx *sql.Tx, node string, s Session) (json.RawMessage, error) {
	v := map[string]any{"project": s.Project, "state": s.State, "elapsed_ms": s.ElapsedMS, "since_ms": s.SinceMS, "revision": s.Revision}
	if hybrid(ctx, tx, node) {
		v["agent"] = "UNAVAILABLE"
		v["git"] = "UNAVAILABLE"
		v["media"] = "UNAVAILABLE"
		v["track"] = ""
		v["artist"] = ""
		git, e := readIntegration(ctx, tx, "git")
		if e != nil {
			return nil, e
		}
		if git.Enabled && git.Status == "ONLINE" && git.ProjectID == s.ProjectID && r.Now().Sub(git.ObservedAt) < 45*1000000000 {
			label := git.Data["branch"]
			if git.Data["dirty"] == "true" {
				label += " DIRTY"
			}
			v["git"] = shortText(strings.ToUpper(label))
		}
		media, e := readIntegration(ctx, tx, "spotify")
		if e != nil {
			return nil, e
		}
		if media.Enabled && media.Status == "ONLINE" && r.Now().Sub(media.ObservedAt) < 10*1000000000 {
			v["media"] = shortText(media.Data["state"])
			v["track"] = shortText(media.Data["track"])
			v["artist"] = shortText(media.Data["artist"])
			if supportsArtwork(ctx, tx, node) && media.Data["artwork_id"] != "" {
				var raw []byte
				var asset map[string]string
				if tx.QueryRowContext(ctx, "SELECT value FROM entities WHERE kind='artwork' AND key=?", media.Data["artwork_id"]).Scan(&raw) == nil && json.Unmarshal(raw, &asset) == nil {
					v["artwork_rgb565"] = asset["rgb565"]
				}
			}
		}
	}
	b, e := json.Marshal(v)
	return b, e
}
