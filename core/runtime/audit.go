package runtime

import (
	"context"
	"fmt"
)

func (r *Runtime) VerifyAudit(ctx context.Context) error {
	rows, e := r.db.QueryContext(ctx, "SELECT seq,principal,action,target,decision,correlation,time,previous_hash,hash FROM audit_entries ORDER BY seq")
	if e != nil {
		return e
	}
	defer rows.Close()
	previous := ""
	for rows.Next() {
		var seq int64
		var p, a, target, d, id, at, prev, h string
		if e = rows.Scan(&seq, &p, &a, &target, &d, &id, &at, &prev, &h); e != nil {
			return e
		}
		if prev != previous || h != hash([]string{p, a, target, d, id, at, prev}) {
			return fmt.Errorf("audit chain mismatch at entry %d", seq)
		}
		previous = h
	}
	return rows.Err()
}
