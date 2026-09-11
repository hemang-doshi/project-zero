package api

import (
	"context"
	"errors"
	"sync"
	"testing"
)

func TestSnapshotCacheServesSameRevisionWithoutRebuild(t *testing.T) {
	builds := 0
	c := &snapshotCache{
		current: func() uint64 { return 7 },
		build: func(context.Context) ([]byte, error) {
			builds++
			return []byte(`{"revision":7}` + "\n"), nil
		},
	}
	first, err := c.get(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	second, err := c.get(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if builds != 1 {
		t.Fatalf("rebuilds: %d", builds)
	}
	if string(first) != "{\"revision\":7}\n" || string(second) != string(first) {
		t.Fatalf("bytes changed: %s %s", first, second)
	}
}

func TestSnapshotCacheRebuildsOnRevisionChange(t *testing.T) {
	revision := uint64(3)
	builds := 0
	c := &snapshotCache{
		current: func() uint64 { return revision },
		build: func(context.Context) ([]byte, error) {
			builds++
			return []byte("{\"revision\":" + string(rune('0'+revision)) + "}"), nil
		},
	}
	if _, err := c.get(context.Background()); err != nil {
		t.Fatal(err)
	}
	revision = 4
	second, err := c.get(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if builds != 2 {
		t.Fatalf("rebuilds: %d", builds)
	}
	if string(second) != "{\"revision\":4}" {
		t.Fatalf("stale bytes served after revision change: %s", second)
	}
}

func TestSnapshotCacheBuildsOnceUnderConcurrency(t *testing.T) {
	var mu sync.Mutex
	builds := 0
	release := make(chan struct{})
	c := &snapshotCache{
		current: func() uint64 { return 11 },
		build: func(context.Context) ([]byte, error) {
			mu.Lock()
			builds++
			mu.Unlock()
			<-release
			return []byte(`{"revision":11}`), nil
		},
	}
	const clients = 8
	results := make([][]byte, clients)
	errs := make([]error, clients)
	var wg sync.WaitGroup
	for i := range clients {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			results[i], errs[i] = c.get(context.Background())
		}(i)
	}
	// Let every client reach the build gate, then release the single builder.
	for {
		mu.Lock()
		started := builds > 0
		mu.Unlock()
		if started {
			break
		}
	}
	close(release)
	wg.Wait()
	for i := range clients {
		if errs[i] != nil {
			t.Fatal(errs[i])
		}
		if string(results[i]) != `{"revision":11}` {
			t.Fatalf("client %d torn read: %s", i, results[i])
		}
	}
	mu.Lock()
	defer mu.Unlock()
	if builds != 1 {
		t.Fatalf("concurrent GETs triggered %d rebuilds", builds)
	}
}

func TestSnapshotCacheDoesNotCacheBuildFailure(t *testing.T) {
	calls := 0
	c := &snapshotCache{
		current: func() uint64 { return 1 },
		build: func(context.Context) ([]byte, error) {
			calls++
			if calls == 1 {
				return nil, errors.New("query failed")
			}
			return []byte(`{"revision":1}`), nil
		},
	}
	if _, err := c.get(context.Background()); err == nil {
		t.Fatal("expected build error")
	}
	data, err := c.get(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatalf("calls: %d", calls)
	}
	if string(data) != `{"revision":1}` {
		t.Fatalf("bytes: %s", data)
	}
}
