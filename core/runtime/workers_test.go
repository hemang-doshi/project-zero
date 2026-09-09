package runtime

import (
	"context"
	"testing"
	"time"
)

func TestSlowAdapterDoesNotBlockOtherWorkers(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	slow := make(chan struct{})
	fast := make(chan struct{}, 1)
	done := make(chan struct{})
	go func() {
		runWorkers(ctx, []periodicWorker{{time.Millisecond, func(ctx context.Context) {
			select {
			case <-slow:
			default:
				close(slow)
			}
			<-ctx.Done()
		}}, {2 * time.Millisecond, func(context.Context) {
			select {
			case fast <- struct{}{}:
			default:
			}
		}}})
		close(done)
	}()
	select {
	case <-slow:
	case <-time.After(time.Second):
		t.Fatal("slow adapter did not begin")
	}
	select {
	case <-fast:
	case <-time.After(time.Second):
		t.Fatal("slow adapter blocked independent worker")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("workers did not stop")
	}
}
