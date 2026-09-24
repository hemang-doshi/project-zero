# Soak intentionally stopped

Owner removed the duration gate and all scheduled AI monitoring. The heartbeat automation was already PAUSED. The local dev.projectzero.soak collector was unloaded on 2026-09-09 before release work. Existing samples and earlier outage evidence remain intact.

Final captured collector counters: 1032 health samples, 6 connections/reconnects, 0 serial errors, 1 recorded reset, elapsed 31265 seconds (8.69 hours), latest free heap 57060 bytes, observed minimum 50956. The status file still says RUNNING because the collector was stopped externally; it is not evidence of a live collector or a completed soak. No 24-hour stability claim is made.
