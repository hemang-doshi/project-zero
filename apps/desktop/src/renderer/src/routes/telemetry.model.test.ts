import { describe, expect, it } from 'vitest'
import {
  group,
  polyPoints,
  dotPoint,
  pushWindow,
  windowMax,
  accumulateHistory,
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
      })
    )
    expect(h.cpuSystem).toEqual([10])
    expect(h.cpuUser).toEqual([20])
    expect(h.pressure).toEqual([50])
    expect(h.ioRead).toEqual([100])
    expect(h.ioWrite).toEqual([200])
    expect(h.netIn).toEqual([30])
    expect(h.netOut).toEqual([40])
  })

  it('keeps each series untouched while its value is null', () => {
    let h: TelemetryHistory = EMPTY_HISTORY
    h = accumulateHistory(h, EMPTY_MACHINE_SAMPLE)
    expect(h).toEqual(EMPTY_HISTORY)
  })

  it('caps every series at 60 points', () => {
    let h: TelemetryHistory = EMPTY_HISTORY
    for (let i = 0; i < 70; i += 1) {
      h = accumulateHistory(
        h,
        sample({ cpu: { system: i, user: null, idle: null, threads: null, processes: null } })
      )
    }
    expect(h.cpuSystem).toHaveLength(60)
    expect(h.cpuSystem[0]).toBe(10)
  })
})
