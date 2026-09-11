import { describe, expect, it } from 'vitest'
import { createTelemetrySampler, type TelemetryDeps } from './telemetry'

type CpuTimes = { user: number; nice: number; sys: number; idle: number; irq: number }

const cpu = (t: CpuTimes): { times: CpuTimes } => ({ times: t })

const GIB = 1024 * 1024 * 1024

function fakeDeps(over: Partial<TelemetryDeps> = {}): TelemetryDeps {
  return {
    cpus: () => [cpu({ user: 10, nice: 0, sys: 10, idle: 80, irq: 0 })],
    totalmem: () => 16 * GIB,
    freemem: () => 4 * GIB,
    statfs: () =>
      Promise.resolve({
        blocks: 245_107_195_904 / 4096,
        bsize: 4096,
        bavail: 100_000_000_000 / 4096
      }),
    home: '/Users/test',
    now: () => 0,
    minIntervalMs: 1_000,
    ...over
  }
}

describe('CPU delta', () => {
  it('returns null on the first request (no baseline yet)', async () => {
    const s = createTelemetrySampler(fakeDeps())
    const sample = await s.sample()
    expect(sample.cpu).toBeNull()
  })

  it('computes busy/total across the interval between two requests', async () => {
    let tick = 0
    const snapshots = [
      [cpu({ user: 10, nice: 0, sys: 10, idle: 60, irq: 0 })],
      [cpu({ user: 30, nice: 0, sys: 20, idle: 75, irq: 0 })]
    ]
    const s = createTelemetrySampler(
      fakeDeps({
        cpus: () => snapshots[Math.min(tick, snapshots.length - 1)],
        now: () => tick * 2_000
      })
    )
    const first = await s.sample()
    tick = 1
    const second = await s.sample()
    expect(first.cpu).toBeNull()
    // busy 20→50 (+30), idle 60→75 (+15): 30/45 → 66.67%
    expect(second.cpu).toBeCloseTo(66.667, 2)
  })

  it('returns null for a zero total delta instead of dividing by zero', async () => {
    const same = [cpu({ user: 10, nice: 0, sys: 10, idle: 80, irq: 0 })]
    const s = createTelemetrySampler(fakeDeps({ cpus: () => same, now: () => 5_000 }))
    await s.sample()
    const second = await s.sample()
    expect(second.cpu).toBeNull()
  })

  it('re-baselines after each computed sample', async () => {
    let tick = 0
    const snapshots = [
      [cpu({ user: 10, nice: 0, sys: 10, idle: 80, irq: 0 })],
      [cpu({ user: 20, nice: 0, sys: 10, idle: 170, irq: 0 })],
      [cpu({ user: 40, nice: 0, sys: 10, idle: 170, irq: 0 })]
    ]
    const s = createTelemetrySampler(
      fakeDeps({ cpus: () => snapshots[tick], now: () => tick * 3_000 })
    )
    await s.sample()
    tick = 1
    const second = await s.sample()
    // busy 20→30 (+10), idle 80→170 (+90): 10/100 → 10%
    expect(second.cpu).toBeCloseTo(10, 5)
    tick = 2
    const third = await s.sample()
    // busy 30→50 (+20), idle unchanged: 20/20 → 100%
    expect(third.cpu).toBeCloseTo(100, 5)
  })
})

describe('lazy cadence', () => {
  it('serves the cached sample within the min interval without re-reading counters', async () => {
    let reads = 0
    const s = createTelemetrySampler(
      fakeDeps({
        cpus: () => {
          reads += 1
          return [cpu({ user: 10, nice: 0, sys: 10, idle: 80, irq: 0 })]
        },
        now: () => 10_000
      })
    )
    await s.sample()
    expect(reads).toBe(1)
    const cached = await s.sample()
    expect(reads).toBe(1)
    expect(cached.cpu).toBeNull()
  })

  it('refreshes again once the min interval has passed', async () => {
    let reads = 0
    let t = 0
    const s = createTelemetrySampler(
      fakeDeps({
        cpus: () => {
          reads += 1
          return [cpu({ user: 10, nice: 0, sys: 10, idle: 80, irq: 0 })]
        },
        now: () => t
      })
    )
    await s.sample()
    t = 1_100
    await s.sample()
    expect(reads).toBe(2)
  })
})

describe('RAM', () => {
  it('reports used/total bytes and percent', async () => {
    const s = createTelemetrySampler(fakeDeps())
    const sample = await s.sample()
    expect(sample.ram).toEqual({
      used: 12 * GIB,
      total: 16 * GIB,
      percent: 75
    })
  })
})

describe('SSD', () => {
  it('computes used/free capacity from statfs on HOME', async () => {
    const s = createTelemetrySampler(fakeDeps())
    const sample = await s.sample()
    const used = 245_107_195_904 - 100_000_000_000
    expect(sample.ssd?.total).toBe(245_107_195_904)
    expect(sample.ssd?.used).toBe(used)
    expect(sample.ssd?.percent).toBeCloseTo((used / 245_107_195_904) * 100, 5)
  })

  it('stays fail-soft when statfs rejects: ssd null, the rest intact', async () => {
    const s = createTelemetrySampler(
      fakeDeps({ statfs: () => Promise.reject(new Error('EACCES')) })
    )
    const sample = await s.sample()
    expect(sample.ssd).toBeNull()
    expect(sample.ram?.total).toBe(16 * GIB)
    expect(sample.gpu).toBeNull()
  })

  it('stats the injected home path', async () => {
    let statPath = ''
    const s = createTelemetrySampler(
      fakeDeps({
        home: '/Users/somewhere',
        statfs: (p) => {
          statPath = p
          return Promise.resolve({ blocks: 100, bsize: 512, bavail: 0 })
        }
      })
    )
    await s.sample()
    expect(statPath).toBe('/Users/somewhere')
  })

  it('reports a full disk honestly', async () => {
    const s = createTelemetrySampler(
      fakeDeps({ statfs: () => Promise.resolve({ blocks: 1_000, bsize: 512, bavail: 0 }) })
    )
    const sample = await s.sample()
    expect(sample.ssd?.percent).toBe(100)
    expect(sample.ssd?.used).toBe(512_000)
    expect(sample.ssd?.total).toBe(512_000)
  })
})

describe('GPU', () => {
  it('stays null: macOS has no cheap portable GPU load read', async () => {
    const s = createTelemetrySampler(fakeDeps())
    const sample = await s.sample()
    expect(sample.gpu).toBeNull()
  })
})
