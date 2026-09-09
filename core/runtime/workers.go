package runtime

import (
	"context"
	"sync"
	"time"
)

type periodicWorker struct {
	interval time.Duration
	run      func(context.Context)
}

func runWorkers(ctx context.Context, jobs []periodicWorker) {
	var group sync.WaitGroup
	for _, job := range jobs {
		group.Add(1)
		go func(job periodicWorker) {
			defer group.Done()
			ticker := time.NewTicker(job.interval)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					job.run(ctx)
				}
			}
		}(job)
	}
	group.Wait()
}
