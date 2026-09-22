import { describe, expect, it } from 'vitest'
import {
  agentRuns,
  bassPolyline,
  initBass,
  pushBass,
  TRACE_WINDOW,
  type BridgeStatePair
} from './desk.model'
import type { BridgeEvent } from './runtime.types'

const ev = (harness: 'codex' | 'opencode', method: string, params?: unknown): BridgeEvent => ({
  harness,
  method,
  params
})

describe('pushBass', () => {
  it('starts as a flat zero window', () => {
    const trace = initBass()
    expect(trace.points).toHaveLength(TRACE_WINDOW)
    expect(trace.points.every((p) => p === 0)).toBe(true)
  })

  it('damps each new live sample toward the target (visual interpolation)', () => {
    let trace = initBass()
    trace = pushBass(trace, { bass: 255, status: 'ACTIVE' }, true, true)
    const damped = trace.points[trace.points.length - 1]
    expect(damped).toBeGreaterThan(0)
    expect(damped).toBeLessThan(1)
    trace = pushBass(trace, { bass: 255, status: 'ACTIVE' }, true, true)
    expect(trace.points[trace.points.length - 1]).toBeGreaterThan(damped)
    expect(trace.points[trace.points.length - 1]).toBeLessThan(1)
  })

  it('flattens toward zero while playback is paused', () => {
    let trace = initBass()
    for (let i = 0; i < 20; i++) {
      trace = pushBass(trace, { bass: 255, status: 'ACTIVE' }, true, true)
    }
    trace = pushBass(trace, { bass: 255, status: 'ACTIVE' }, true, false)
    expect(trace.points[trace.points.length - 1]).toBeLessThan(
      trace.points[trace.points.length - 2]
    )
  })

  it('appends the decayed value when the daemon reports paused/unavailable capture', () => {
    let trace = initBass()
    for (let i = 0; i < 20; i++) {
      trace = pushBass(trace, { bass: 255, status: 'ACTIVE' }, true, true)
    }
    for (let i = 0; i < 60; i++) {
      trace = pushBass(trace, { bass: 255, status: 'PAUSED' }, true, true)
    }
    expect(trace.points.every((p) => p === 0)).toBe(true)
  })

  it('flattens the whole window when the runtime connection is not live', () => {
    let trace = initBass()
    for (let i = 0; i < 10; i++) {
      trace = pushBass(trace, { bass: 255, status: 'ACTIVE' }, true, true)
    }
    expect(trace.points.some((p) => p > 0)).toBe(true)
    trace = pushBass(trace, { bass: 255, status: 'ACTIVE' }, false, true)
    expect(trace.points.every((p) => p === 0)).toBe(true)
  })

  it('rolls the window (keeps the newest TRACE_WINDOW samples)', () => {
    let trace = initBass()
    for (let i = 0; i < TRACE_WINDOW + 30; i++) {
      trace = pushBass(trace, { bass: i % 256, status: 'ACTIVE' }, true, true)
    }
    expect(trace.points).toHaveLength(TRACE_WINDOW)
    const last = trace.points[trace.points.length - 1]
    const prev = trace.points[trace.points.length - 2]
    expect(last).not.toBe(prev)
  })
})

describe('bassPolyline', () => {
  it('maps the damped window to an SVG trace with the newest sample right-most', () => {
    const trace = initBass()
    let next = trace
    for (let i = 0; i < 8; i++) {
      next = pushBass(next, { bass: 255, status: 'ACTIVE' }, true, true)
    }
    const points = bassPolyline(next.points, 220, 44)
    const coords = points.split(' ')
    expect(coords).toHaveLength(TRACE_WINDOW)
    const first = coords[0].split(',').map(Number)
    const last = coords[coords.length - 1].split(',').map(Number)
    expect(first[0]).toBe(1)
    expect(last[0]).toBe(219)
    // flat trace sits on the baseline; a live trace rises above it
    const flat = bassPolyline(trace.points, 220, 44)
    expect(flat.split(' ')[0]).toBe('1,40')
    expect(last[1]).toBeLessThan(40)
  })
})

describe('agentRuns', () => {
  const LIVE: BridgeStatePair = { codex: 'live', opencode: 'live' }

  it('shows an active run while the live bridge streamed a turn start', () => {
    const runs = agentRuns([ev('codex', 'turn/started', { threadId: 't1' })], LIVE)
    expect(runs).toEqual([{ id: 'codex:t1', harness: 'codex', label: 't1', state: 'ACTIVE' }])
  })

  it('drops the run after the matching turn completes', () => {
    const runs = agentRuns(
      [
        ev('codex', 'turn/started', { threadId: 't1' }),
        ev('codex', 'item/started', { threadId: 't1' }),
        ev('codex', 'turn/completed', { threadId: 't1' })
      ],
      LIVE
    )
    expect(runs).toEqual([])
  })

  it('keeps the run active across interleaved items and closes per thread', () => {
    const runs = agentRuns(
      [
        ev('codex', 'turn/started', { threadId: 'a' }),
        ev('codex', 'turn/completed', { threadId: 'a' }),
        ev('codex', 'turn/started', { threadId: 'b' })
      ],
      LIVE
    )
    expect(runs).toEqual([{ id: 'codex:b', harness: 'codex', label: 'b', state: 'ACTIVE' }])
  })

  it('shows opencode session activity as an active run', () => {
    const runs = agentRuns([ev('opencode', 'session/update', { sessionId: 's1' })], LIVE)
    expect(runs).toEqual([{ id: 'opencode:s1', harness: 'opencode', label: 's1', state: 'ACTIVE' }])
  })

  it('uses the default key when the event carries no session identity', () => {
    const runs = agentRuns([ev('codex', 'turn/started', {})], LIVE)
    expect(runs).toEqual([
      { id: 'codex:default', harness: 'codex', label: 'default', state: 'ACTIVE' }
    ])
  })

  it('never renders retained evidence as an active run', () => {
    const offline: BridgeStatePair = { codex: 'disconnected', opencode: 'disconnected' }
    expect(
      agentRuns(
        [
          ev('codex', 'turn/started', { threadId: 't1' }),
          ev('opencode', 'session/update', { sessionId: 's1' })
        ],
        offline
      )
    ).toEqual([])
    expect(
      agentRuns([ev('codex', 'turn/started', { threadId: 't1' })], {
        codex: 'unknown',
        opencode: 'unknown'
      })
    ).toEqual([])
  })

  it('keeps an unknown harness event out of the runs list', () => {
    const runs = agentRuns([ev('codex', 'session/started', { threadId: 't9' })], LIVE)
    expect(runs).toEqual([])
  })

  it('caps the bounded display at 8 runs', () => {
    const events: BridgeEvent[] = []
    for (let i = 0; i < 12; i++) {
      events.push(ev('codex', 'turn/started', { threadId: `t${i}` }))
    }
    const runs = agentRuns(events, LIVE)
    expect(runs).toHaveLength(8)
    expect(runs[0].label).toBe('t4')
    expect(runs[7].label).toBe('t11')
  })
})
