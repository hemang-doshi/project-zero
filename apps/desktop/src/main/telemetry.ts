import { promises as fsp } from 'node:fs'
import * as os from 'node:os'
import { homedir } from 'node:os'
import type { TelemetryResource, TelemetrySample } from '../shared/ipc'

type CpuTimes = { user: number; nice: number; sys: number; idle: number; irq: number }

export type TelemetryDeps = {
  cpus: () => Array<{ times: CpuTimes }>
  totalmem: () => number
  freemem: () => number
  statfs: (path: string) => Promise<{ blocks: number; bsize: number; bavail: number }>
  home: string
  now: () => number
  minIntervalMs: number
}

// GPU stays null on macOS: there is no cheap portable per-load read, and the
// only bounded source (system_profiler) spawns a heavy process per call —
// Task 18's idle-CPU work must not be traded for a tile. The route renders
// the honest 'Unavailable' placeholder instead.

const defaultDeps = (): TelemetryDeps => ({
  cpus: () => os.cpus(),
  totalmem: () => os.totalmem(),
  freemem: () => os.freemem(),
  statfs: (path) => fsp.statfs(path),
  home: homedir(),
  now: () => Date.now(),
  minIntervalMs: 1_000
})

const percent = (used: number, total: number): number =>
  total > 0 ? Math.min(100, Math.max(0, (used / total) * 100)) : 0

const cpuTotals = (cpus: Array<{ times: CpuTimes }>): { busy: number; total: number } => {
  let busy = 0
  let total = 0
  for (const { times } of cpus) {
    const b = times.user + times.nice + times.sys + times.irq
    busy += b
    total += b + times.idle
  }
  return { busy, total }
}

const clampCpu = (v: number): number => Math.min(100, Math.max(0, v * 100))

export function createTelemetrySampler(deps: TelemetryDeps = defaultDeps()): {
  sample: () => Promise<TelemetrySample>
} {
  let prev: { busy: number; total: number } | null = null
  let cached: TelemetrySample | null = null
  let cachedAt = -Infinity

  const sample = async (): Promise<TelemetrySample> => {
    const now = deps.now()
    if (cached !== null && now - cachedAt < deps.minIntervalMs) return cached

    const current = cpuTotals(deps.cpus())
    const cpu =
      prev === null
        ? null
        : (() => {
            const busyDelta = current.busy - prev.busy
            const totalDelta = current.total - prev.total
            return totalDelta > 0 ? clampCpu(busyDelta / totalDelta) : null
          })()
    prev = current

    const totalMem = deps.totalmem()
    const ram: TelemetryResource = {
      used: totalMem - deps.freemem(),
      total: totalMem,
      percent: percent(totalMem - deps.freemem(), totalMem)
    }

    let ssd: TelemetryResource | null = null
    try {
      const fs = await deps.statfs(deps.home)
      const capacity = fs.blocks * fs.bsize
      const used = (fs.blocks - fs.bavail) * fs.bsize
      ssd = { used, total: capacity, percent: percent(used, capacity) }
    } catch {
      ssd = null
    }

    // GPU is honestly unavailable on macOS (see note above).
    const gpu: number | null = null

    cached = { cpu, ram, ssd, gpu }
    cachedAt = now
    return cached
  }

  return { sample }
}
