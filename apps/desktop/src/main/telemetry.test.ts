import { describe, expect, it } from 'vitest'
import { createTelemetrySampler, type TelemetryDeps } from './telemetry'

type CpuTimes = { user: number; nice: number; sys: number; idle: number; irq: number }

const cpu = (t: CpuTimes): { times: CpuTimes } => ({ times: t })

const GIB = 1024 ** 3
const MIB = 1024 ** 2

// Batch output fixtures mirror the real macOS tool outputs recorded during
// the source probes (vm_stat 16384-byte pages, netstat -ib columns,
// ioreg IOKit Statistics, ps -A -M per-thread rows).
const PS_SECTION = `USER               PID   TT   %CPU STAT PRI     STIME     UTIME COMMAND
root                 1   ??    0.0 S    31T   0:00.04   0:00.01 /sbin/launchd
                     1         0.0 S    37T   0:09.15   0:02.89
                     1         0.0 S    20T   0:01.54   0:02.89
hemang              334   ??    0.1 S    37T   0:00.48   0:00.10 /usr/libexec/logd
                     334        0.0 S    37T   0:00.48   0:00.10
`

const VM_STAT_SECTION = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                    32257.
Pages active:                                 254966.
Pages inactive:                               240318.
Pages speculative:                             14083.
Pages throttled:                                   0.
Pages wired down:                             172591.
Pages purgeable:                               14672.
"Translation faults":                      218850525.
Pages copy-on-write:                        11360665.
Pages zero filled:                         145853813.
Pages reactivated:                           7483439.
Pages purged:                                1540816.
File-backed pages:                            181743.
Anonymous pages:                              327624.
Pages stored in compressor:                   639764.
Pages occupied by compressor:                 294851.
Decompressions:                              4668445.
Compressions:                                6377731.
Pageins:                                     5708256.
Pageouts:                                      51709.
Swapins:                                           0.
Swapouts:                                          0.
`

const SYSCTL_SECTION = `vm.swapusage: total = 1024.00M  used = 512.00M  free = 512.00M  (encrypted)
kern.memorystatus_vm_pressure_level: 1
`

const NET_STAT_SECTION = `Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll
lo0        16384 <Link#1>                        883011     0  951953745   883011     0  951953745     0
lo0        16384 127           localhost         883011     -  951953745   883011     -  951953745     -
en0        1500  <Link#4>    da:0b:71:62:c3:b2     1000     0     500000     900     0     450000     0
en0        1500  192.168      hemangs-mac         1000     -     500000     900     -     450000     -
en9        1500  <Link#6>    da:0b:71:62:c3:99       20     0       4000      10     0       2000     0
`

const DISK_SECTION = `+-o disk0s1  <class IOBlockStorageDriver, id 0x1000003a9, registered, matched, active, busy 0 (380 ms), retain 72>
    {
      "Statistics" = {"Operations (Write)"=2515963,"Latency Time (Write)"=0,"Bytes (Read)"=156378263552,"Errors (Write)"=0,"Total Time (Read)"=2525008045834,"Latency Time (Read)"=0,"Retries (Read)"=0,"Errors (Read)"=0,"Total Time (Write)"=109335973308,"Bytes (Write)"=47597654016,"Operations (Read)"=8348407,"Retries (Write)"=0}
      "IOClass" = "IONVMeBlockStorageDriver"
    }
`

const GPU_SECTION = `+-o AGXAcceleratorG16G  <class AGXAcceleratorG16G, id 0x1000003a9, registered, matched, active, busy 0 (380 ms), retain 72>
      "PerformanceStatistics" = {"In use system memory (driver)"=0,"Device Utilization %"=29,"Renderer Utilization %"=29,"Tiler Utilization %"=29}
`

const BATCH_OUTPUT = [
  '===PS===',
  PS_SECTION,
  '===VM_STAT===',
  VM_STAT_SECTION,
  '===SYSCTL===',
  SYSCTL_SECTION,
  '===NETSTAT===',
  NET_STAT_SECTION,
  '===DISK===',
  DISK_SECTION,
  '===GPU===',
  GPU_SECTION
].join('\n')

function fakeDeps(over: Partial<TelemetryDeps> = {}): TelemetryDeps {
  return {
    cpus: () => [cpu({ user: 10, nice: 0, sys: 10, idle: 80, irq: 0 })],
    totalmem: () => 16 * GIB,
    freemem: () => 4 * GIB,
    now: () => 0,
    minIntervalMs: 1_000,
    spawnBatch: () => Promise.resolve(BATCH_OUTPUT),
    ...over
  }
}

describe('CPU system/user/idle split', () => {
  it('returns nulls on the first request (no baseline yet)', async () => {
    const s = createTelemetrySampler(fakeDeps())
    const sample = await s.sample()
    expect(sample.cpu?.system).toBeNull()
    expect(sample.cpu?.user).toBeNull()
    expect(sample.cpu?.idle).toBeNull()
  })

  it('splits busy deltas into system/user/idle across two requests', async () => {
    let tick = 0
    const snapshots = [
      [cpu({ user: 10, nice: 0, sys: 10, idle: 80, irq: 0 })],
      [cpu({ user: 40, nice: 0, sys: 20, idle: 140, irq: 0 })]
    ]
    const s = createTelemetrySampler(
      fakeDeps({
        cpus: () => snapshots[Math.min(tick, snapshots.length - 1)],
        now: () => tick * 2_000
      })
    )
    await s.sample()
    tick = 1
    const second = await s.sample()
    // Δuser+nice=30, Δsys+irq=10, Δidle=60 → total 100
    expect(second.cpu?.user).toBeCloseTo(30, 2)
    expect(second.cpu?.system).toBeCloseTo(10, 2)
    expect(second.cpu?.idle).toBeCloseTo(60, 2)
  })

  it('re-baselines after each computed sample', async () => {
    let tick = 0
    const snapshots = [
      [cpu({ user: 10, nice: 0, sys: 10, idle: 80, irq: 0 })],
      [cpu({ user: 40, nice: 0, sys: 20, idle: 140, irq: 0 })],
      [cpu({ user: 80, nice: 0, sys: 20, idle: 140, irq: 0 })]
    ]
    const s = createTelemetrySampler(
      fakeDeps({ cpus: () => snapshots[tick], now: () => tick * 3_000 })
    )
    await s.sample()
    tick = 1
    const second = await s.sample()
    // Δuser+nice=30, Δsys+irq=10, Δidle=60: system 10%, user 30%, idle 60%
    expect(second.cpu?.system).toBeCloseTo(10, 5)
    expect(second.cpu?.user).toBeCloseTo(30, 5)
    expect(second.cpu?.idle).toBeCloseTo(60, 5)
    tick = 2
    const third = await s.sample()
    // busy 40→80 (+40), idle unchanged: user 100%, system 0%, idle 0%
    expect(third.cpu?.system).toBe(0)
    expect(third.cpu?.user).toBe(100)
    expect(third.cpu?.idle).toBe(0)
  })

  it('returns nulls for a zero total delta instead of dividing by zero', async () => {
    const same = [cpu({ user: 10, nice: 0, sys: 10, idle: 80, irq: 0 })]
    const s = createTelemetrySampler(fakeDeps({ cpus: () => same, now: () => 5_000 }))
    await s.sample()
    const second = await s.sample()
    expect(second.cpu?.system).toBeNull()
    expect(second.cpu?.user).toBeNull()
    expect(second.cpu?.idle).toBeNull()
  })
})

describe('threads and processes (ps section)', () => {
  it('counts process rows and thread rows from ps -A -M', async () => {
    const s = createTelemetrySampler(fakeDeps())
    const sample = await s.sample()
    expect(sample.cpu?.processes).toBe(2)
    expect(sample.cpu?.threads).toBe(3)
  })

  it('stays null when the ps section is missing', async () => {
    const s = createTelemetrySampler(
      fakeDeps({
        spawnBatch: () =>
          Promise.resolve(BATCH_OUTPUT.replace(/===PS===[\s\S]*?===VM_STAT===/, '===VM_STAT==='))
      })
    )
    const sample = await s.sample()
    expect(sample.cpu?.threads).toBeNull()
    expect(sample.cpu?.processes).toBeNull()
  })
})

describe('memory breakdown (vm_stat + sysctl sections)', () => {
  it('maps page counters to app/wired/compressed/cached and used', async () => {
    const s = createTelemetrySampler(fakeDeps())
    const sample = await s.sample()
    const m = sample.memory
    expect(m?.total).toBe(16 * GIB)
    // app = (anonymous − purgeable) × page size
    expect(m?.app).toBe((327_624 - 14_672) * 16_384)
    expect(m?.wired).toBe(172_591 * 16_384)
    expect(m?.compressed).toBe(294_851 * 16_384)
    // cached files = file-backed + speculative
    expect(m?.cachedFiles).toBe((181_743 + 14_083) * 16_384)
    // used = app + wired + compressed
    expect(m?.used).toBe((327_624 - 14_672) * 16_384 + 172_591 * 16_384 + 294_851 * 16_384)
    if (m !== null) {
      expect(m.percent).toBeCloseTo((m.used / (16 * GIB)) * 100, 5)
      expect(m.pressure).toBeCloseTo(m.percent, 5)
    }
  })

  it('reads the kernel pressure level and swap usage from sysctl', async () => {
    const s = createTelemetrySampler(fakeDeps())
    const sample = await s.sample()
    expect(sample.memory?.level).toBe('low')
    expect(sample.memory?.swapUsed).toBe(512 * MIB)
  })

  it('falls back to freemem for used and breakdown nulls when vm_stat fails', async () => {
    const s = createTelemetrySampler(
      fakeDeps({
        spawnBatch: () =>
          Promise.resolve(BATCH_OUTPUT.replace(/===VM_STAT===[\s\S]*?===SYSCTL===/, '===SYSCTL==='))
      })
    )
    const sample = await s.sample()
    const m = sample.memory
    expect(m?.used).toBe(12 * GIB)
    expect(m?.percent).toBeCloseTo(75, 5)
    expect(m?.app).toBeNull()
    expect(m?.wired).toBeNull()
    expect(m?.compressed).toBeNull()
    expect(m?.cachedFiles).toBeNull()
    // 75% used with no kernel level → medium fallback band
    expect(m?.level).toBe('medium')
  })

  it('maps the kernel pressure levels 1/2/3 to low/medium/high', async () => {
    const cases = [
      [1, 'low'],
      [2, 'medium'],
      [3, 'high']
    ] as const
    for (const [level, expected] of cases) {
      const s = createTelemetrySampler(
        fakeDeps({
          spawnBatch: () =>
            Promise.resolve(
              BATCH_OUTPUT.replace(
                'kern.memorystatus_vm_pressure_level: 1',
                `kern.memorystatus_vm_pressure_level: ${level}`
              )
            )
        })
      )
      const sample = await s.sample()
      expect(sample.memory?.level).toBe(expected)
    }
  })
})

describe('disk I/O (ioreg IOKit statistics)', () => {
  it('reports cumulative read/write ops and bytes', async () => {
    const s = createTelemetrySampler(fakeDeps())
    const sample = await s.sample()
    const io = sample.io
    expect(io?.reads).toBe(8_348_407)
    expect(io?.writes).toBe(2_515_963)
    expect(io?.dataRead).toBe(156_378_263_552)
    expect(io?.dataWritten).toBe(47_597_654_016)
  })

  it('computes per-second rates from deltas across two samples', async () => {
    let tick = 0
    const stats = [
      '{"Operations (Write)"=2515963,"Bytes (Read)"=156378263552,"Operations (Read)"=8348407,"Bytes (Write)"=47597654016}',
      '{"Operations (Write)"=2515965,"Bytes (Read)"=156380360704,"Operations (Read)"=8348409,"Bytes (Write)"=47598178304}'
    ]
    const s = createTelemetrySampler(
      fakeDeps({
        now: () => tick * 2_000,
        spawnBatch: () =>
          Promise.resolve(
            BATCH_OUTPUT.replace(
              /\{"Operations \(Write\)"[\s\S]*?\}/,
              stats[Math.min(tick, stats.length - 1)]
            )
          )
      })
    )
    const first = await s.sample()
    expect(first.io?.readsPerSec).toBeNull()
    expect(first.io?.dataReadPerSec).toBeNull()
    tick = 1
    const second = await s.sample()
    // 2 s elapsed: Δops read=2 → 1/s; Δops write=2 → 1/s; Δbytes read=2097152 → 1048576/s; Δbytes write=524288 → 262144/s
    expect(second.io?.readsPerSec).toBeCloseTo(1, 5)
    expect(second.io?.writesPerSec).toBeCloseTo(1, 5)
    expect(second.io?.dataReadPerSec).toBe(1_048_576)
    expect(second.io?.dataWrittenPerSec).toBe(262_144)
  })

  it('stays null and re-baselines when a counter rolls back', async () => {
    let tick = 0
    const stats = [
      '{"Operations (Write)"=2515963,"Bytes (Read)"=156378263552,"Operations (Read)"=8348407,"Bytes (Write)"=47597654016}',
      '{"Operations (Write)"=2515960,"Bytes (Read)"=156378263552,"Operations (Read)"=8348400,"Bytes (Write)"=47597654016}'
    ]
    const s = createTelemetrySampler(
      fakeDeps({
        now: () => tick * 2_000,
        spawnBatch: () =>
          Promise.resolve(
            BATCH_OUTPUT.replace(
              /\{"Operations \(Write\)"[\s\S]*?\}/,
              stats[Math.min(tick, stats.length - 1)]
            )
          )
      })
    )
    await s.sample()
    tick = 1
    const second = await s.sample()
    expect(second.io?.readsPerSec).toBeNull()
    expect(second.io?.writesPerSec).toBeNull()
    // cumulative values are still honestly reported
    expect(second.io?.reads).toBe(8_348_400)
  })

  it('is null when the disk section is missing', async () => {
    const s = createTelemetrySampler(
      fakeDeps({
        spawnBatch: () =>
          Promise.resolve(BATCH_OUTPUT.replace(/===DISK===[\s\S]*?===GPU===/, '===GPU==='))
      })
    )
    const sample = await s.sample()
    expect(sample.io?.reads).toBeNull()
    expect(sample.io?.dataWritten).toBeNull()
  })
})

describe('network (netstat -ib section)', () => {
  it('sums non-loopback link rows and drops loopback (en0+en9, address rows never double-count)', async () => {
    const s = createTelemetrySampler(fakeDeps())
    const sample = await s.sample()
    const net = sample.net
    expect(net?.packetsIn).toBe(1_020)
    expect(net?.packetsOut).toBe(910)
    expect(net?.dataReceived).toBe(504_000)
    expect(net?.dataSent).toBe(452_000)
  })

  it('computes packets and bytes per second from deltas', async () => {
    let tick = 0
    const rows = [
      {
        ipkts: 1_000,
        ibytes: 500_000,
        opkts: 900,
        obytes: 450_000
      },
      {
        ipkts: 1_100,
        ibytes: 550_000,
        opkts: 980,
        obytes: 494_000
      }
    ]
    const s = createTelemetrySampler(
      fakeDeps({
        now: () => tick * 2_000,
        spawnBatch: () =>
          Promise.resolve(
            BATCH_OUTPUT.replace(
              /^en0 .*?\n/m,
              `en0        1500  <Link#4>    da:0b:71:62:c3:b2     ${rows[Math.min(tick, rows.length - 1)].ipkts}     0     ${rows[Math.min(tick, rows.length - 1)].ibytes}     ${rows[Math.min(tick, rows.length - 1)].opkts}     0     ${rows[Math.min(tick, rows.length - 1)].obytes}     0\n`
            )
          )
      })
    )
    await s.sample()
    tick = 1
    const second = await s.sample()
    expect(second.net?.packetsInPerSec).toBeCloseTo(50, 5)
    expect(second.net?.packetsOutPerSec).toBeCloseTo(40, 5)
    expect(second.net?.dataReceivedPerSec).toBe(25_000)
    expect(second.net?.dataSentPerSec).toBe(22_000)
  })

  it('is null when the netstat section is missing', async () => {
    const s = createTelemetrySampler(
      fakeDeps({
        spawnBatch: () =>
          Promise.resolve(BATCH_OUTPUT.replace(/===NETSTAT===[\s\S]*?===DISK===/, '===DISK==='))
      })
    )
    const sample = await s.sample()
    expect(sample.net?.packetsIn).toBeNull()
    expect(sample.net?.dataSentPerSec).toBeNull()
  })
})

describe('GPU (ioreg IOAccelerator)', () => {
  it('parses Device Utilization % from PerformanceStatistics', async () => {
    const s = createTelemetrySampler(fakeDeps())
    const sample = await s.sample()
    expect(sample.gpu).toBe(29)
  })

  it('stays null when the GPU section has no utilization key', async () => {
    const s = createTelemetrySampler(
      fakeDeps({ spawnBatch: () => Promise.resolve(BATCH_OUTPUT.replace(/===GPU===[\s\S]*$/, '')) })
    )
    const sample = await s.sample()
    expect(sample.gpu).toBeNull()
  })
})

describe('lazy cadence', () => {
  it('serves the cached sample within the min interval without re-spawning', async () => {
    let spawns = 0
    const s = createTelemetrySampler(
      fakeDeps({
        spawnBatch: () => {
          spawns += 1
          return Promise.resolve(BATCH_OUTPUT)
        },
        now: () => 10_000
      })
    )
    await s.sample()
    expect(spawns).toBe(1)
    const cached = await s.sample()
    expect(spawns).toBe(1)
    expect(cached.cpu?.system).toBeNull()
  })

  it('refreshes again once the min interval has passed', async () => {
    let spawns = 0
    let t = 0
    const s = createTelemetrySampler(
      fakeDeps({
        spawnBatch: () => {
          spawns += 1
          return Promise.resolve(BATCH_OUTPUT)
        },
        now: () => t
      })
    )
    await s.sample()
    t = 1_100
    await s.sample()
    expect(spawns).toBe(2)
  })
})

describe('fail-soft batch', () => {
  it('keeps CPU live and renders honest nulls when the spawn fails', async () => {
    let tick = 0
    const snapshots = [
      [cpu({ user: 10, nice: 0, sys: 10, idle: 80, irq: 0 })],
      [cpu({ user: 30, nice: 0, sys: 20, idle: 75, irq: 0 })]
    ]
    const s = createTelemetrySampler(
      fakeDeps({
        cpus: () => snapshots[Math.min(tick, snapshots.length - 1)],
        now: () => tick * 2_000,
        spawnBatch: () => Promise.resolve(null)
      })
    )
    await s.sample()
    tick = 1
    const sample = await s.sample()
    expect(sample.cpu?.user).not.toBeNull()
    expect(sample.cpu?.threads).toBeNull()
    expect(sample.cpu?.processes).toBeNull()
    // freemem fallback keeps the memory family alive
    expect(sample.memory?.used).toBe(12 * GIB)
    expect(sample.io?.reads).toBeNull()
    expect(sample.net?.packetsIn).toBeNull()
    expect(sample.gpu).toBeNull()
  })
})
