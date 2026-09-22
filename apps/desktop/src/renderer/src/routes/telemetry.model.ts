import type { MachineSample } from './runtime.types'

// Fixed sparkline box shared by every history graph (named so callers and
// tests pin geometry instead of scattering magic numbers).
export const GRAPH_W = 240
export const GRAPH_H = 56
export const GRAPH_MARGIN = 2
export const DOT_R = 2.5

// Rolling history windows are rendered as small Activity-Monitor-style
// sparklines: ~60 points per metric family at the 2 s visibility-gated
// cadence — no rAF, no hot loops (Task 18 perf bar stands).
export const HISTORY_CAP = 60

export type TelemetryHistory = {
  cpuSystem: number[]
  cpuUser: number[]
  pressure: number[]
  ioRead: number[]
  ioWrite: number[]
  netIn: number[]
  netOut: number[]
}

export const EMPTY_HISTORY: TelemetryHistory = {
  cpuSystem: [],
  cpuUser: [],
  pressure: [],
  ioRead: [],
  ioWrite: [],
  netIn: [],
  netOut: []
}

export const pushWindow = <T>(window: T[], value: T, cap = HISTORY_CAP): T[] => {
  const next = [...window, value]
  return next.length > cap ? next.slice(next.length - cap) : next
}

export const windowMax = (values: number[]): number =>
  values.reduce((max, v) => (Number.isFinite(v) && v > max ? v : max), 0)

// Evenly spread polyline points across a w×h box with a GRAPH_MARGIN inner
// margin. max is the scale top; values above it clamp to the top edge.
// Fewer than two points carry no line geometry (see dotPoint): the caller
// renders the lone observation as a dot so a short series never vanishes.
export const polyPoints = (values: number[], w: number, h: number, max: number): string => {
  if (values.length < 2) return ''
  const scale = max > 0 ? max : 1
  const innerW = w - GRAPH_MARGIN * 2
  const innerH = h - GRAPH_MARGIN * 2
  return values
    .map((v, i) => {
      const x = GRAPH_MARGIN + (i / (values.length - 1)) * innerW
      const y = h - GRAPH_MARGIN - clampedRatio(clampTop(v, scale), scale) * innerH
      return `${trim(x)},${trim(y)}`
    })
    .join(' ')
}

// A lone observation has no line geometry but must still render: plot it as
// a dot with the exact same scale math as the polyline (left inner edge,
// clamped to the box). Anything but a single point returns null.
export const dotPoint = (values: number[], _w: number, h: number, max: number): string | null => {
  if (values.length !== 1) return null
  const scale = max > 0 ? max : 1
  const innerH = h - GRAPH_MARGIN * 2
  const y = h - GRAPH_MARGIN - clampedRatio(clampTop(values[0], scale), scale) * innerH
  return `${trim(GRAPH_MARGIN)},${trim(y)}`
}

const clampTop = (v: number, scale: number): number =>
  Number.isFinite(v) ? Math.min(Math.max(v, 0), scale) : 0

// toFixed(1) with the trailing .0 stripped for whole numbers.
const trim = (v: number): string => v.toFixed(1).replace(/\.0$/, '')

const clampedRatio = (v: number, scale: number): number => Math.max(0, Math.min(1, v / scale))

// Thousands-separated grouping without locale dependence (jsdom/node ICU
// variance): 1234567 → '1,234,567'. Retained as the EXACT form: abbreviated
// counters (shortCount) always carry their grouped value in the row's
// `title` tooltip, so the full number stays one hover away.
export const group = (n: number): string => {
  if (!Number.isFinite(n)) return '0'
  const sign = n < 0 ? '-' : ''
  const digits = Math.abs(Math.round(n)).toString()
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

// Compact counter forms (Task 34, example case: telemetry numbers overflow
// out of their boxes — e.g. '12,345,678 reads'). Values below 1_000 render
// exactly (integer-rounded, matching group); at and above 1_000 they render
// with one decimal and a K/M/B/T suffix, trailing .0 stripped. GB/byte
// values are NOT abbreviated (formatGib/formatBytes stay verbatim); only
// decimal counters shorten. Boundaries: 999 → '999', 1_000 → '1K',
// 1_500 → '1.5K', 12_345_678 → '12.3M'.
export const shortCount = (n: number): string => {
  if (!Number.isFinite(n)) return '0'
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  if (abs < 1_000) return `${sign}${Math.round(abs)}`
  const tiers = ['K', 'M', 'B', 'T'] as const
  let tier = Math.min(Math.floor(Math.log10(abs) / 3) - 1, tiers.length - 1)
  let scaled = abs / 1_000 ** (tier + 1)
  // One-decimal rounding can push 999_999 to '1000K': roll up a tier so the
  // short form never grows a fourth digit (999_999 → '1M').
  if (scaled >= 999.95 && tier < tiers.length - 1) {
    tier += 1
    scaled /= 1_000
  }
  return `${sign}${scaled.toFixed(1).replace(/\.0$/, '')}${tiers[tier] ?? 'K'}`
}

// Telemetry row-label abbreviations (Task 34): the full Activity-Monitor
// forms size their content-based stat columns so wide the graphs lose
// significance. Short forms are the default display; the full form always
// rides the label's `title` tooltip. Mapping (full → short):
//   PHYSICAL MEMORY → PHYS MEM | APP MEMORY → APP MEM | WIRED MEM ← WIRED MEMORY
//   CACHED FILES → CACHED (unambiguous inside the memory panel)
//   MEMORY USED kept per mandate; SWAP USED / COMPRESSED kept (standard terms)
//   READS IN → READS | WRITES OUT → WRITES (totals; stay distinct from the
//     DATA READ / DATA WRITTEN byte rows sharing the disk panel)
//   READS IN/SEC → READS/S | WRITES OUT/SEC → WRITES/S
//   DATA READ/SEC → DATA READ/S | DATA WRITTEN/SEC → DATA WRITTEN/S
//     (byte totals DATA READ / DATA WRITTEN kept: they disambiguate ops rows)
//   PACKETS IN → PKTS IN | PACKETS OUT → PKTS OUT
//   PACKETS IN/SEC → PKTS IN/S | PACKETS OUT/SEC → PKTS OUT/S
//   DATA RECEIVED → RX DATA | DATA SENT → TX DATA (+ /S rate forms)
//     (RX/TX is the standard interface-counter vocabulary, netstat/ifconfig)
//   CPU labels (SYSTEM/USER/IDLE/THREADS/PROCESSES) already short: kept.
export const TELEMETRY_LABEL_SHORT: Readonly<Record<string, string>> = {
  'PHYSICAL MEMORY': 'PHYS MEM',
  'APP MEMORY': 'APP MEM',
  'WIRED MEMORY': 'WIRED MEM',
  'CACHED FILES': 'CACHED',
  'READS IN': 'READS',
  'WRITES OUT': 'WRITES',
  'READS IN/SEC': 'READS/S',
  'WRITES OUT/SEC': 'WRITES/S',
  'DATA READ/SEC': 'DATA READ/S',
  'DATA WRITTEN/SEC': 'DATA WRITTEN/S',
  'PACKETS IN': 'PKTS IN',
  'PACKETS OUT': 'PKTS OUT',
  'PACKETS IN/SEC': 'PKTS IN/S',
  'PACKETS OUT/SEC': 'PKTS OUT/S',
  'DATA RECEIVED': 'RX DATA',
  'DATA SENT': 'TX DATA',
  'DATA RECEIVED/SEC': 'RX DATA/S',
  'DATA SENT/SEC': 'TX DATA/S'
}

export const shortLabel = (full: string): string => TELEMETRY_LABEL_SHORT[full] ?? full

// Append a resolved sample into every series, keeping each family untouched
// while its value is null (honest absence keeps the graph short, not flat).
export const accumulateHistory = (
  history: TelemetryHistory,
  sample: MachineSample
): TelemetryHistory => ({
  cpuSystem:
    sample.cpu?.system != null
      ? pushWindow(history.cpuSystem, sample.cpu.system)
      : history.cpuSystem,
  cpuUser:
    sample.cpu?.user != null ? pushWindow(history.cpuUser, sample.cpu.user) : history.cpuUser,
  pressure:
    sample.memory?.pressure != null
      ? pushWindow(history.pressure, sample.memory.pressure)
      : history.pressure,
  ioRead:
    sample.io?.dataReadPerSec != null
      ? pushWindow(history.ioRead, sample.io.dataReadPerSec)
      : history.ioRead,
  ioWrite:
    sample.io?.dataWrittenPerSec != null
      ? pushWindow(history.ioWrite, sample.io.dataWrittenPerSec)
      : history.ioWrite,
  netIn:
    sample.net?.packetsInPerSec != null
      ? pushWindow(history.netIn, sample.net.packetsInPerSec)
      : history.netIn,
  netOut:
    sample.net?.packetsOutPerSec != null
      ? pushWindow(history.netOut, sample.net.packetsOutPerSec)
      : history.netOut
})
