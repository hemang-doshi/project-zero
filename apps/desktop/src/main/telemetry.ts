import { execFile } from 'node:child_process'
import * as os from 'node:os'
import type {
  TelemetryCpu,
  TelemetryIo,
  TelemetryMemory,
  TelemetryNet,
  TelemetrySample,
  TelemetryPoint
} from '../shared/ipc'
import { parseProcessRows } from './process-telemetry'

type CpuTimes = { user: number; nice: number; sys: number; idle: number; irq: number }
type CpuSum = { u: number; s: number; i: number }

export type TelemetryDeps = {
  cpus: () => Array<{ times: CpuTimes }>
  totalmem: () => number
  freemem: () => number
  now: () => number
  minIntervalMs: number
  spawnBatch: () => Promise<string | null>
}

// One batched read per refresh: a single sh -c spawn runs every cheap macOS
// source once and section markers make each parse fail-soft independently.
// All non-root, all fast (~85 ms total measured):
//   ps -A -M                 → per-thread rows → thread + process counts
//   vm_stat                  → page-based memory breakdown
//   sysctl vm.swapusage +    → kernel pressure level (1/2/3) + swap bytes
//     kern.memorystatus_vm_pressure_level
//   netstat -ib              → cumulative packets/bytes per interface
//   ioreg IOBlockStorage     → IOKit disk Statistics: cumulative read/write
//                              ops AND bytes (iostat cannot split reads from
//                              writes, so it is not used)
//   ioreg IOAccelerator      → GPU "Device Utilization %" on Apple silicon
const BATCH_SCRIPT = [
  'echo ===PS===',
  'ps -A -M',
  'echo ===PROCESS===',
  'ps -A -o pid= -o %cpu= -o rss= -o comm=',
  'echo ===VM_STAT===',
  'vm_stat',
  'echo ===SYSCTL===',
  'sysctl vm.swapusage kern.memorystatus_vm_pressure_level',
  'echo ===NETSTAT===',
  'netstat -ib',
  'echo ===DISK===',
  'ioreg -r -d 1 -c IOBlockStorageDriver',
  'echo ===GPU===',
  'ioreg -r -d 1 -c IOAccelerator'
].join('\n')

const defaultSpawnBatch = (): Promise<string | null> =>
  new Promise((resolve) => {
    execFile(
      'sh',
      ['-c', BATCH_SCRIPT],
      { timeout: 3_500, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        resolve(err ? null : stdout)
      }
    )
  })

const defaultDeps = (): TelemetryDeps => ({
  cpus: () => os.cpus(),
  totalmem: () => os.totalmem(),
  freemem: () => os.freemem(),
  now: () => Date.now(),
  minIntervalMs: 1_000,
  spawnBatch: defaultSpawnBatch
})

// --- section parsing (fail-soft: malformed input → null) -------------------

const splitSections = (out: string): Record<string, string> => {
  const parts = out.split(/(?:^|\n)===([A-Z_]+)===\n/)
  const sections: Record<string, string> = {}
  // parts: [pre, name1, body1, name2, body2, ...]
  for (let i = 1; i + 1 < parts.length; i += 2) {
    sections[parts[i]] = parts[i + 1] ?? ''
  }
  return sections
}

const num = (v: string): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

// ps -A -M: process rows start with the username (non-numeric), per-thread
// continuation rows start with the PID (numeric). Header row starts with USER.
const parsePs = (section: string): { processes: number; threads: number } | null => {
  let processes = 0
  let threads = 0
  for (const line of section.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const first = trimmed.split(/\s+/)[0]
    if (first === 'USER') continue
    if (/^\d+$/.test(first)) threads += 1
    else processes += 1
  }
  return processes > 0 ? { processes, threads } : null
}

type VmStat = {
  pageSize: number
  anonymous: number
  wired: number
  compressor: number
  fileBacked: number
  speculative: number
  purgeable: number
}

const parseVmStat = (section: string): VmStat | null => {
  const size = /page size of (\d+) bytes/.exec(section)
  if (size === null) return null
  const page = (label: string): number | null => {
    const m = new RegExp(`^${label}:\\s*([\\d.]+)`, 'm').exec(section)
    return m === null ? null : Number(m[1])
  }
  const anonymous = page('Anonymous pages')
  const wired = page('Pages wired down')
  const compressor = page('Pages occupied by compressor')
  if (anonymous === null || wired === null || compressor === null) return null
  const fileBacked = page('File-backed pages') ?? 0
  const speculative = page('Pages speculative') ?? 0
  const purgeable = page('Pages purgeable') ?? 0
  return {
    pageSize: Number(size[1]),
    anonymous,
    wired,
    compressor,
    fileBacked,
    speculative,
    purgeable
  }
}

type Sysctl = { swapUsed: number | null; level: 'low' | 'medium' | 'high' | null }

const parseSysctl = (section: string): Sysctl => {
  let swapUsed: number | null = null
  let level: 'low' | 'medium' | 'high' | null = null
  const swap = /vm\.swapusage:[^\n]*used = ([\d.]+)([KMG])/.exec(section)
  if (swap !== null) {
    const value = Number(swap[1])
    if (Number.isFinite(value)) {
      const mult = swap[2] === 'G' ? 1024 ** 3 : swap[2] === 'K' ? 1024 : 1024 ** 2
      swapUsed = value * mult
    }
  }
  const lvl = /kern\.memorystatus_vm_pressure_level: (\d)/.exec(section)
  if (lvl !== null) {
    level = lvl[1] === '1' ? 'low' : lvl[1] === '2' ? 'medium' : 'high'
  }
  return { swapUsed, level }
}

type NetStat = {
  packetsIn: number
  packetsOut: number
  bytesIn: number
  bytesOut: number
}

// One <Link#N> row per interface carries the counters; address rows repeat
// them, so dedupe by interface name and sum across non-loopback interfaces.
const parseNetstat = (section: string): NetStat | null => {
  let packetsIn = 0
  let packetsOut = 0
  let bytesIn = 0
  let bytesOut = 0
  let rows = 0
  const seen = new Set<string>()
  for (const line of section.split('\n')) {
    if (!line.includes('<Link#')) continue
    const fields = line.trim().split(/\s+/)
    if (fields.length < 8) continue
    const name = fields[0]
    if (seen.has(name) || /^lo/.test(name)) continue
    seen.add(name)
    const ipkts = num(fields[fields.length - 7])
    const ibytes = num(fields[fields.length - 5])
    const opkts = num(fields[fields.length - 4])
    const obytes = num(fields[fields.length - 2])
    if (ipkts === null || ibytes === null || opkts === null || obytes === null) continue
    packetsIn += ipkts
    bytesIn += ibytes
    packetsOut += opkts
    bytesOut += obytes
    rows += 1
  }
  return rows > 0 ? { packetsIn, packetsOut, bytesIn, bytesOut } : null
}

type IoStats = {
  reads: number
  writes: number
  dataRead: number
  dataWritten: number
}

const parseIoStats = (section: string): IoStats | null => {
  const stat = (re: RegExp): number | null => {
    const m = re.exec(section)
    return m === null ? null : Number(m[1])
  }
  const reads = stat(/"Operations \(Read\)"=(\d+)/)
  const writes = stat(/"Operations \(Write\)"=(\d+)/)
  const dataRead = stat(/"Bytes \(Read\)"=(\d+)/)
  const dataWritten = stat(/"Bytes \(Write\)"=(\d+)/)
  if (reads === null || writes === null || dataRead === null || dataWritten === null) return null
  return { reads, writes, dataRead, dataWritten }
}

const parseGpuUtilization = (section: string): number | null => {
  const m = /"Device Utilization %"=(\d+)/.exec(section)
  if (m === null) return null
  return Math.min(100, Math.max(0, Number(m[1])))
}

// --- delta plumbing --------------------------------------------------------

const rate = (current: number, previous: number, dtSec: number): number | null => {
  const delta = current - previous
  if (delta < 0) return null // counter rollback: rate is not computable
  return dtSec > 0 ? delta / dtSec : null
}

const clampPct = (v: number): number => Math.min(100, Math.max(0, v))

const fallbackLevel = (pressure: number): 'low' | 'medium' | 'high' => {
  if (pressure < 70) return 'low'
  if (pressure < 90) return 'medium'
  return 'high'
}

export function createTelemetrySampler(deps: TelemetryDeps = defaultDeps()): {
  sample: () => Promise<TelemetrySample>
  history: () => TelemetryPoint[]
} {
  let prevCpu: CpuSum | null = null
  let prevNet: (NetStat & { at: number }) | null = null
  let prevIo: (IoStats & { at: number }) | null = null
  let cached: TelemetrySample | null = null
  let cachedAt = -Infinity
  let failures: string[] = []
  const points: TelemetryPoint[] = []

  const cpuSplit = (prev: CpuSum | null, total: CpuSum): TelemetryCpu => {
    const base: TelemetryCpu = {
      system: null,
      user: null,
      idle: null,
      threads: null,
      processes: null
    }
    if (prev === null) return base
    const dU = total.u - prev.u
    const dS = total.s - prev.s
    const dI = total.i - prev.i
    const sum = dU + dS + dI
    if (sum <= 0) return base
    return {
      system: clampPct((dS / sum) * 100),
      user: clampPct((dU / sum) * 100),
      idle: clampPct((dI / sum) * 100),
      threads: null,
      processes: null
    }
  }

  const memoryFamily = (vmStat: VmStat | null, sysctl: Sysctl): TelemetryMemory => {
    const total = deps.totalmem()
    if (vmStat !== null) {
      const page = vmStat.pageSize
      const app = Math.max(0, (vmStat.anonymous - vmStat.purgeable) * page)
      const wired = vmStat.wired * page
      const compressed = vmStat.compressor * page
      const cachedFiles = (vmStat.fileBacked + vmStat.speculative) * page
      const used = app + wired + compressed
      const percent = total > 0 ? Math.min(100, (used / total) * 100) : 0
      return {
        total,
        used,
        percent,
        pressure: percent,
        level: sysctl.level ?? fallbackLevel(percent),
        app,
        wired,
        compressed,
        cachedFiles,
        swapUsed: sysctl.swapUsed
      }
    }
    const used = Math.max(0, total - deps.freemem())
    const percent = total > 0 ? Math.min(100, (used / total) * 100) : 0
    return {
      total,
      used,
      percent,
      pressure: percent,
      level: fallbackLevel(percent),
      app: null,
      wired: null,
      compressed: null,
      cachedFiles: null,
      swapUsed: sysctl.swapUsed
    }
  }

  const netFamily = (stat: NetStat | null, now: number): TelemetryNet => {
    const empty: TelemetryNet = {
      packetsIn: null,
      packetsOut: null,
      packetsInPerSec: null,
      packetsOutPerSec: null,
      dataReceived: null,
      dataSent: null,
      dataReceivedPerSec: null,
      dataSentPerSec: null
    }
    if (stat === null) return empty
    const net: TelemetryNet = {
      packetsIn: stat.packetsIn,
      packetsOut: stat.packetsOut,
      dataReceived: stat.bytesIn,
      dataSent: stat.bytesOut,
      packetsInPerSec: null,
      packetsOutPerSec: null,
      dataReceivedPerSec: null,
      dataSentPerSec: null
    }
    if (prevNet !== null) {
      const dt = (now - prevNet.at) / 1_000
      net.packetsInPerSec = rate(stat.packetsIn, prevNet.packetsIn, dt)
      net.packetsOutPerSec = rate(stat.packetsOut, prevNet.packetsOut, dt)
      net.dataReceivedPerSec = rate(stat.bytesIn, prevNet.bytesIn, dt)
      net.dataSentPerSec = rate(stat.bytesOut, prevNet.bytesOut, dt)
    }
    prevNet = {
      at: now,
      packetsIn: stat.packetsIn,
      packetsOut: stat.packetsOut,
      bytesIn: stat.bytesIn,
      bytesOut: stat.bytesOut
    }
    return net
  }

  const ioFamily = (stat: IoStats | null, now: number): TelemetryIo => {
    const empty: TelemetryIo = {
      reads: null,
      writes: null,
      readsPerSec: null,
      writesPerSec: null,
      dataRead: null,
      dataWritten: null,
      dataReadPerSec: null,
      dataWrittenPerSec: null
    }
    if (stat === null) return empty
    const io: TelemetryIo = {
      reads: stat.reads,
      writes: stat.writes,
      dataRead: stat.dataRead,
      dataWritten: stat.dataWritten,
      readsPerSec: null,
      writesPerSec: null,
      dataReadPerSec: null,
      dataWrittenPerSec: null
    }
    if (prevIo !== null) {
      const dt = (now - prevIo.at) / 1_000
      io.readsPerSec = rate(stat.reads, prevIo.reads, dt)
      io.writesPerSec = rate(stat.writes, prevIo.writes, dt)
      io.dataReadPerSec = rate(stat.dataRead, prevIo.dataRead, dt)
      io.dataWrittenPerSec = rate(stat.dataWritten, prevIo.dataWritten, dt)
    }
    prevIo = {
      at: now,
      reads: stat.reads,
      writes: stat.writes,
      dataRead: stat.dataRead,
      dataWritten: stat.dataWritten
    }
    return io
  }

  const sample = async (): Promise<TelemetrySample> => {
    const now = deps.now()
    if (cached !== null && now - cachedAt < deps.minIntervalMs) return cached

    const cpuTotal: CpuSum = { u: 0, s: 0, i: 0 }
    for (const { times } of deps.cpus()) {
      cpuTotal.u += times.user + times.nice
      cpuTotal.s += times.sys + times.irq
      cpuTotal.i += times.idle
    }
    let cpu = cpuSplit(prevCpu, cpuTotal)
    prevCpu = { ...cpuTotal }

    const out = await deps.spawnBatch()
    let memory: TelemetryMemory
    let io: TelemetryIo
    let net: TelemetryNet
    let gpu: number | null
    let processes: TelemetrySample['processes'] = []
    failures = []
    if (out === null) {
      failures = ['cpu', 'memory', 'disk', 'network', 'gpu', 'processes']
      memory = memoryFamily(null, { swapUsed: null, level: null })
      io = ioFamily(null, now)
      net = netFamily(null, now)
      gpu = null
    } else {
      const sections = splitSections(out)
      if (sections['PROCESS'] !== undefined) processes = parseProcessRows(sections['PROCESS'])
      else failures.push('processes')
      const sysctl =
        sections['SYSCTL'] !== undefined
          ? parseSysctl(sections['SYSCTL'])
          : { swapUsed: null, level: null }
      const ps = sections['PS'] !== undefined ? parsePs(sections['PS']) : null
      if (ps !== null) cpu = { ...cpu, threads: ps.threads, processes: ps.processes }
      else failures.push('cpu')
      const vmStat = sections['VM_STAT'] !== undefined ? parseVmStat(sections['VM_STAT']) : null
      if (vmStat === null) failures.push('memory')
      const netStat = sections['NETSTAT'] !== undefined ? parseNetstat(sections['NETSTAT']) : null
      if (netStat === null) failures.push('network')
      const ioStat = sections['DISK'] !== undefined ? parseIoStats(sections['DISK']) : null
      if (ioStat === null) failures.push('disk')
      memory = memoryFamily(vmStat, sysctl)
      io = ioFamily(ioStat, now)
      net = netFamily(netStat, now)
      gpu = sections['GPU'] !== undefined ? parseGpuUtilization(sections['GPU']) : null
      if (gpu === null) failures.push('gpu')
    }

    cached = { cpu, memory, io, net, gpu, processes }
    cachedAt = now
    points.push({ at: now, sample: cached, failures: [...failures] })
    if (points.length > 60) points.splice(0, points.length - 60)
    return cached
  }

  return {
    sample,
    history: () => points.map((point) => ({ ...point, failures: [...point.failures] }))
  }
}
