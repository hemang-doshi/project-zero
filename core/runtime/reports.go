package runtime

import (
	"context"
	"encoding/json"
	"time"
)

func (r *Runtime) DailyReport(ctx context.Context) (map[string]any, error) {
	start := r.Now().UTC().Truncate(24 * time.Hour)
	rows, e := r.db.QueryContext(ctx, "SELECT value FROM entities WHERE kind='firing'")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	total, correct, incorrect, unreviewed := 0, 0, 0, 0
	for rows.Next() {
		var b []byte
		var f Firing
		if e = rows.Scan(&b); e != nil {
			return nil, e
		}
		if e = json.Unmarshal(b, &f); e != nil {
			return nil, e
		}
		if f.At.Before(start) {
			continue
		}
		total++
		switch f.Review {
		case "correct":
			correct++
		case "incorrect":
			incorrect++
		default:
			unreviewed++
		}
	}
	var rate any
	if correct+incorrect > 0 {
		rate = float64(incorrect) / float64(correct+incorrect)
	}
	return map[string]any{"version": "0.2", "day_utc": start.Format("2006-01-02"), "total": total, "correct": correct, "incorrect": incorrect, "unreviewed": unreviewed, "incorrect_reviewed_fraction": rate, "evaluation_status": "NOT_STARTED", "missed_actions": "manual review required"}, rows.Err()
}
