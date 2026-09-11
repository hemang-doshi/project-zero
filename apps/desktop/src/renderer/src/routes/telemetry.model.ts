import type { MachineSample } from './runtime.types'

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

// Evenly spread polyline points across a w×h box with a 2px inner margin.
// max is the scale top; values above it clamp to the top edge.
export const polyPoints = (values: number[], w: number, h: number, max: number): string => {
  if (values.length < 2) return ''
  const scale = max > 0 ? max : 1
  const innerW = w - 4
  const innerH = h - 4
  return values
    .map((v, i) => {
      const x = 2 + (i / (values.length - 1)) * innerW
      const clamped = Number.isFinite(v) ? Math.min(v, scale) : 0
      const y = h - 2 - clampedRatio(clamped, scale) * innerH
      return `${trim(x)},${trim(y)}`
    })
    .join(' ')
}

// toFixed(1) with the trailing .0 stripped for whole numbers.
const trim = (v: number): string => v.toFixed(1).replace(/\.0$/, '')

const clampedRatio = (v: number, scale: number): number => Math.max(0, Math.min(1, v / scale))

// Thousands-separated grouping without locale dependence (jsdom/node ICU
// variance): 8348407 → '8,348,407'.
export const group = (n: number): string => {
  if (!Number.isFinite(n)) return '0'
  const sign = n < 0 ? '-' : ''
  const digits = Math.abs(Math.round(n)).toString()
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

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
