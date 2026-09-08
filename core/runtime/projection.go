package runtime

import (
	"context"
	"database/sql"
	"encoding/json"
)

func replayState(ctx context.Context, tx *sql.Tx) error {
	rows, e := tx.QueryContext(ctx, "SELECT data FROM events WHERE kind='state.changed' ORDER BY seq")
	if e != nil {
		return e
	}
	type state struct {
		Key      string          `json:"key"`
		Value    json.RawMessage `json:"value"`
		Revision int64           `json:"revision"`
	}
	latest := map[string]state{}
	for rows.Next() {
		var b []byte
		if e = rows.Scan(&b); e != nil {
			rows.Close()
			return e
		}
		var s state
		if e = json.Unmarshal(b, &s); e != nil {
			rows.Close()
			return e
		}
		latest[s.Key] = s
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	for _, s := range latest {
		if _, e = tx.ExecContext(ctx, "INSERT INTO state_values VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,revision=excluded.revision", s.Key, []byte(s.Value), s.Revision); e != nil {
			return e
		}
	}
	return nil
}
