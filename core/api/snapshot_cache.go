package api

import (
	"context"
	"sync"
)

// snapshotCache replays the serialized cockpit snapshot while the runtime
// projection revision is unchanged. One bounded entry: a single-user local
// runtime never needs eviction or history. Rebuilds are serialized so
// concurrent GETs at a new revision build exactly once and never observe a
// torn snapshot.
type snapshotCache struct {
	current func() uint64
	build   func(ctx context.Context) ([]byte, error)

	mu   sync.Mutex // guards rev/data; data is immutable once stored
	rev  uint64
	data []byte

	buildMu sync.Mutex // serializes rebuilds
}

func (c *snapshotCache) get(ctx context.Context) ([]byte, error) {
	c.mu.Lock()
	if c.data != nil && c.rev == c.current() {
		data := c.data
		c.mu.Unlock()
		return data, nil
	}
	c.mu.Unlock()

	c.buildMu.Lock()
	defer c.buildMu.Unlock()
	rev := c.current()
	c.mu.Lock()
	if c.data != nil && c.rev == rev {
		data := c.data
		c.mu.Unlock()
		return data, nil
	}
	c.mu.Unlock()

	data, err := c.build(ctx)
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	c.rev, c.data = rev, data
	c.mu.Unlock()
	return data, nil
}
