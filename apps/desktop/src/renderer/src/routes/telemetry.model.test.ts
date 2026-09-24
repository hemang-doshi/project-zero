import { describe, expect, it } from 'vitest'
import {
  group,
  shortCount,
  shortLabel,
  TELEMETRY_LABEL_SHORT,
  polyPoints,
  dotPoint,
  pushWindow,
  windowMax,
  accumulateHistory,
  timelineGeometry,
  historyFromPoints,
  HISTORY_CAP,
  EMPTY_HISTORY,
  GRAPH_W,
  GRAPH_H,
  GRAPH_MARGIN,
  type TelemetryHistory
} from './telemetry.model'
import { EMPTY_MACHINE_SAMPLE, type MachineSample } from './runtime.types'
import type { TelemetrySample } from '../../../shared/ipc'

const sample = (over: Partial<TelemetrySample>): MachineSample => ({
  cpu: null,
  memory: null,
  io: null,
  net: null,
  gpu: null,
  ...over
})

describe('pushWindow', () => {
  it('appends while under the cap', () => {
    let w: number[] = []
    for (let i = 0; i < HISTORY_CAP; i += 1) w = pushWindow(w, i)
    expect(w).toHaveLength(HISTORY_CAP)
    expect(w[0]).toBe(0)
  })

  it('caps at 60 points and drops the oldest', () => {
    let w: number[] = []
    for (let i = 0; i < HISTORY_CAP + 1; i += 1) w = pushWindow(w, i)
    expect(w).toHaveLength(HISTORY_CAP)
    expect(w[0]).toBe(1)
    expect(w[HISTORY_CAP - 1]).toBe(HISTORY_CAP)
  })
})

describe('windowMax', () => {
  it('returns 0 for an empty window', () => {
    expect(windowMax([])).toBe(0)
  })

  it('returns the largest value', () => {
    expect(windowMax([3, 9, 2])).toBe(9)
  })
})

describe('polyPoints', () => {
  it('renders nothing below two points', () => {
    expect(polyPoints([], 240, 56, 100)).toBe('')
    expect(polyPoints([50], 240, 56, 100)).toBe('')
  })

  it('normalizes a 0–100 range into the fixed 240×56 box', () => {
    expect(polyPoints([0, 100], 240, 56, 100)).toBe('2,54 238,2')
  })

  it('maps mid values proportionally', () => {
    expect(polyPoints([0, 50, 100], 240, 56, 100)).toBe('2,54 120,28 238,2')
  })

  it('clamps values above the scale', () => {
    expect(polyPoints([0, 150], 240, 56, 100)).toBe('2,54 238,2')
  })
})

describe('graph geometry constants', () => {
  it('pins the fixed sparkline box and inner margin (no magic numbers in callers)', () => {
    expect(GRAPH_W).toBe(240)
    expect(GRAPH_H).toBe(56)
    expect(GRAPH_MARGIN).toBe(2)
  })
})

describe('dotPoint', () => {
  it('returns null for empty and multi-point series', () => {
    expect(dotPoint([], 240, 56, 100)).toBeNull()
    expect(dotPoint([10, 20], 240, 56, 100)).toBeNull()
  })

  it('plots a lone observation with the same scale math as the polyline', () => {
    // y = 56 − 2 − 0.5·52 = 28, x = left inner edge where a line would start.
    expect(dotPoint([50], 240, 56, 100)).toBe('2,28')
    expect(dotPoint([0], 240, 56, 100)).toBe('2,54')
    expect(dotPoint([100], 240, 56, 100)).toBe('2,2')
  })

  it('guards degenerate domains instead of producing NaN', () => {
    // Zero/negative max falls back to a unit scale with the same clamp math
    // as the polyline (values above the scale pin to the top edge).
    expect(dotPoint([50], 240, 56, 0)).toBe('2,2')
    expect(dotPoint([50], 240, 56, -10)).toBe('2,2')
    expect(dotPoint([NaN], 240, 56, 100)).toBe('2,54')
    expect(dotPoint([Infinity], 240, 56, 100)).toBe('2,54')
    expect(dotPoint([-5], 240, 56, 100)).toBe('2,54')
    expect(dotPoint([150], 240, 56, 100)).toBe('2,2')
  })
})

describe('polyPoints degenerate domains', () => {
  it('renders a flat series as a horizontal line (never vanishes)', () => {
    expect(polyPoints([50, 50, 50], 240, 56, 100)).toBe('2,28 120,28 238,28')
    expect(polyPoints([0, 0], 240, 56, 100)).toBe('2,54 238,54')
  })

  it('maps non-finite values to the baseline instead of NaN', () => {
    expect(polyPoints([NaN, 100], 240, 56, 100)).toBe('2,54 238,2')
    expect(polyPoints([Infinity, 100], 240, 56, 100)).toBe('2,54 238,2')
  })

  it('falls back to a unit scale on zero/negative max', () => {
    expect(polyPoints([0, 1], 240, 56, 0)).toBe('2,54 238,2')
  })
})
describe('group', () => {
  it('inserts thousands separators', () => {
    expect(group(8_348_407)).toBe('8,348,407')
    expect(group(1_000_000)).toBe('1,000,000')
  })

  it('leaves small numbers unseparated', () => {
    expect(group(999)).toBe('999')
    expect(group(0)).toBe('0')
  })

  it('keeps the sign', () => {
    expect(group(-1234)).toBe('-1,234')
  })
})

describe('shortCount', () => {
  it('passes small values through exactly (no suffix, integer-rounded like group)', () => {
    expect(shortCount(999)).toBe('999')
    expect(shortCount(780)).toBe('780')
    expect(shortCount(0)).toBe('0')
    expect(shortCount(12.5)).toBe('13')
  })

  it('abbreviates thousands with one decimal and no trailing .0', () => {
    expect(shortCount(1_000)).toBe('1K')
    expect(shortCount(1_500)).toBe('1.5K')
    expect(shortCount(3_185)).toBe('3.2K')
    expect(shortCount(883_011)).toBe('883K')
  })

  it('abbreviates millions (owner finding: 13,303,724 reads → 13.3M)', () => {
    expect(shortCount(13_303_724)).toBe('13.3M')
    expect(shortCount(8_348_407)).toBe('8.3M')
    expect(shortCount(2_515_963)).toBe('2.5M')
    expect(shortCount(1_000_000)).toBe('1M')
  })

  it('rolls 999.95K-style rounding overflow up a tier instead of printing 1000K', () => {
    expect(shortCount(999_999)).toBe('1M')
    expect(shortCount(999_499)).toBe('999.5K')
  })

  it('abbreviates billions and keeps the sign', () => {
    expect(shortCount(2_340_000_000)).toBe('2.3B')
    expect(shortCount(-1_234)).toBe('-1.2K')
  })

  it('treats non-finite input like group (never NaN/Infinity on screen)', () => {
    expect(shortCount(Number.NaN)).toBe('0')
    expect(shortCount(Number.POSITIVE_INFINITY)).toBe('0')
  })
})

describe('shortLabel', () => {
  it('shortens the documented long row labels', () => {
    expect(shortLabel('PHYSICAL MEMORY')).toBe('PHYS MEM')
    expect(shortLabel('APP MEMORY')).toBe('APP MEM')
    expect(shortLabel('WIRED MEMORY')).toBe('WIRED MEM')
    expect(shortLabel('CACHED FILES')).toBe('CACHED')
    expect(shortLabel('READS IN')).toBe('READS')
    expect(shortLabel('WRITES OUT')).toBe('WRITES')
    expect(shortLabel('READS IN/SEC')).toBe('READS/S')
    expect(shortLabel('WRITES OUT/SEC')).toBe('WRITES/S')
    expect(shortLabel('DATA READ/SEC')).toBe('DATA READ/S')
    expect(shortLabel('DATA WRITTEN/SEC')).toBe('DATA WRITTEN/S')
    expect(shortLabel('PACKETS IN')).toBe('PKTS IN')
    expect(shortLabel('PACKETS OUT')).toBe('PKTS OUT')
    expect(shortLabel('PACKETS IN/SEC')).toBe('PKTS IN/S')
    expect(shortLabel('PACKETS OUT/SEC')).toBe('PKTS OUT/S')
    expect(shortLabel('DATA RECEIVED')).toBe('RX DATA')
    expect(shortLabel('DATA SENT')).toBe('TX DATA')
    expect(shortLabel('DATA RECEIVED/SEC')).toBe('RX DATA/S')
    expect(shortLabel('DATA SENT/SEC')).toBe('TX DATA/S')
  })

  it('keeps already-short labels verbatim (SYSTEM, MEMORY USED, COMPRESSED, …)', () => {
    for (const label of [
      'SYSTEM',
      'USER',
      'IDLE',
      'THREADS',
      'PROCESSES',
      'MEMORY USED',
      'SWAP USED',
      'COMPRESSED',
      'DATA READ',
      'DATA WRITTEN'
    ]) {
      expect(shortLabel(label)).toBe(label)
    }
  })

  it('passes unknown labels through (no silent drops)', () => {
    expect(shortLabel('SOMETHING NEW')).toBe('SOMETHING NEW')
  })

  it('pins the full mapping table (additive changes only)', () => {
    expect(TELEMETRY_LABEL_SHORT).toEqual({
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
    })
  })
})

describe('accumulateHistory', () => {
  it('appends every non-null metric family value', () => {
    let h: TelemetryHistory = EMPTY_HISTORY
    h = accumulateHistory(
      h,
      sample({
        cpu: { system: 10, user: 20, idle: 70, threads: 5, processes: 2 },
        memory: {
          total: 16,
          used: 8,
          percent: 50,
          pressure: 50,
          level: 'low',
          app: null,
          wired: null,
          compressed: null,
          cachedFiles: null,
          swapUsed: null
        },
        io: {
          reads: 1,
          writes: 2,
          readsPerSec: 10,
          writesPerSec: 20,
          dataRead: 3,
          dataWritten: 4,
          dataReadPerSec: 100,
          dataWrittenPerSec: 200
        },
        net: {
          packetsIn: 1,
          packetsOut: 2,
          packetsInPerSec: 30,
          packetsOutPerSec: 40,
          dataReceived: 5,
          dataSent: 6,
          dataReceivedPerSec: 300,
          dataSentPerSec: 400
        },
        gpu: 29
      }),
      100
    )
    expect(h.at).toEqual([100])
    expect(h.cpuSystem).toEqual([10])
    expect(h.cpuUser).toEqual([20])
    expect(h.pressure).toEqual([50])
    expect(h.ioRead).toEqual([100])
    expect(h.ioWrite).toEqual([200])
    expect(h.netIn).toEqual([30])
    expect(h.netOut).toEqual([40])
    expect(h.gpu).toEqual([29])
  })

  it('records a timestamped gap while a metric family is unavailable', () => {
    let h: TelemetryHistory = EMPTY_HISTORY
    h = accumulateHistory(h, EMPTY_MACHINE_SAMPLE, 100)
    expect(h.at).toEqual([100])
    expect(h.cpuSystem).toEqual([null])
    expect(h.gpu).toEqual([null])
  })

  it('caps every series at 60 points', () => {
    let h: TelemetryHistory = EMPTY_HISTORY
    for (let i = 0; i < 70; i += 1) {
      h = accumulateHistory(
        h,
        sample({ cpu: { system: i, user: null, idle: null, threads: null, processes: null } }),
        i
      )
    }
    expect(h.cpuSystem).toHaveLength(60)
    expect(h.cpuSystem[0]).toBe(10)
  })

  it('replays timestamped points and keeps their real spacing', () => {
    const history = historyFromPoints([
      {
        at: 0,
        sample: sample({
          cpu: { system: 10, user: null, idle: null, threads: null, processes: null }
        }),
        failures: []
      },
      { at: 2_000, sample: EMPTY_MACHINE_SAMPLE, failures: ['cpu'] },
      {
        at: 4_000,
        sample: sample({
          cpu: { system: 20, user: null, idle: null, threads: null, processes: null }
        }),
        failures: []
      }
    ])
    expect(history.at).toEqual([0, 2_000, 4_000])
    expect(history.cpuSystem).toEqual([10, null, 20])
  })
})

describe('timelineGeometry', () => {
  it('uses timestamps in a fixed window and leaves a visible gap for missing points', () => {
    const shape = timelineGeometry([10, null, 20, 30], [0, 2_000, 8_000, 10_000], 10_000, 100)
    expect(shape.paths).toEqual(['222.3,43.6 238,38.4'])
    expect(shape.dots).toEqual(['159.3,48.8'])
  })
})
