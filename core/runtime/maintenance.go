package runtime

import (
	"context"
	"time"
)

// Checkpoint bounds the SQLite write-ahead log. Under the periodic display and
// integration writes the connection's automatic checkpoint did not advance, so
// the WAL grew until every read paid a full frame scan and the daemon saturated
// a core. Truncating on demand from the daemon's single connection keeps the log
// small.
func (r *Runtime) Checkpoint(ctx context.Context) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	_, err := r.db.ExecContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)")
	return err
}

// RunMaintenance periodically bounds the WAL for as long as ctx is live.
func (r *Runtime) RunMaintenance(ctx context.Context) {
	runWorkers(ctx, []periodicWorker{
		{30 * time.Second, func(ctx context.Context) { _ = r.Checkpoint(ctx) }},
	})
}
