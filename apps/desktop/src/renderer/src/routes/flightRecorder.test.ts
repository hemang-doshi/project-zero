import { describe, expect, it } from 'vitest'
import fixtureJson from './fixtures/cockpit.json'
import {
  flightNotice,
  flightRows,
  freshnessChip,
  isFlightNoise,
  nodeTone,
  parseSnapshot,
  visibleFlightRows,
  type FlightRow
} from './runtime.types'

const fixture = (): unknown => fixtureJson as unknown

const row = (overrides: Partial<FlightRow>): FlightRow => ({
  id: 'x',
  source: 'event',
  seq: 1,
  time: '2026-09-11T06:00:08.164134Z',
  channel: 'entity.changed',
  actor: 'zerod',
  outcome: 'RECORDED',
  tone: 'neutral',
  noise: false,
  ...overrides
})

describe('flightRows', () => {
  it('projects event and audit rows from the recorded snapshot', () => {
    const rows = flightRows(fixture())
    const events = rows.filter((r) => r.source === 'event')
    const audit = rows.filter((r) => r.source === 'audit')
    expect(events).toHaveLength(100)
    expect(audit).toHaveLength(100)
    expect(events[0]).toMatchObject({
      source: 'event',
      channel: 'entity.changed',
      outcome: 'RECORDED',
      tone: 'neutral'
    })
    expect(typeof events[0].seq).toBe('number')
    expect(audit[0]).toMatchObject({
      source: 'audit',
      channel: 'integration.observed',
      outcome: 'SUCCEEDED',
      tone: 'healthy'
    })
  })

  it('returns an empty list without a snapshot', () => {
    expect(flightRows(null)).toEqual([])
  })

  it('keeps snapshot order: events first, then audit', () => {
    const rows = flightRows(fixture())
    expect(rows[0].source).toBe('event')
    expect(rows[rows.length - 1].source).toBe('audit')
  })
})

describe('isFlightNoise', () => {
  it('hides exactly the pinned noise taxonomy', () => {
    expect(isFlightNoise('display.render')).toBe(true)
    expect(isFlightNoise('display.clear')).toBe(true)
    expect(isFlightNoise('clock.tick')).toBe(true)
    expect(isFlightNoise('sse.keepalive')).toBe(true)
    expect(isFlightNoise('ready')).toBe(true)
    expect(isFlightNoise('Display.Render')).toBe(true)
  })

  it('keeps the daemon event kinds and remaining audit actions visible', () => {
    expect(isFlightNoise('entity.changed')).toBe(false)
    expect(isFlightNoise('session.changed')).toBe(false)
    expect(isFlightNoise('state.changed')).toBe(false)
    expect(isFlightNoise('integration.observed')).toBe(false)
    expect(isFlightNoise('repo.status')).toBe(false)
    expect(isFlightNoise('capabilities.invoke')).toBe(false)
  })

  it('marks every display.render audit row as noise and nothing else', () => {
    const rows = flightRows(fixture())
    const noisy = rows.filter((r) => r.noise)
    expect(noisy).toHaveLength(rows.filter((r) => r.channel === 'display.render').length)
    expect(noisy.every((r) => r.channel === 'display.render')).toBe(true)
  })
})

describe('visibleFlightRows', () => {
  const rows = [
    row({ id: 'a', noise: false }),
    row({ id: 'b', noise: true, channel: 'display.render', source: 'audit' }),
    row({ id: 'c', noise: false })
  ]

  it('hides noise rows by default', () => {
    expect(visibleFlightRows(rows, false).map((r) => r.id)).toEqual(['a', 'c'])
  })

  it('bypasses the filter behind the show-all toggle', () => {
    expect(visibleFlightRows(rows, true)).toEqual(rows)
  })
})

describe('flightNotice', () => {
  it('reports the lower bound when history is truncated', () => {
    const notice = flightNotice(fixture())
    expect(notice).toContain('events, audit')
    expect(notice).toContain('lower bound')
  })

  it('reports the complete projection when nothing is truncated', () => {
    const value = fixture() as Record<string, unknown>
    expect(flightNotice({ ...value, truncated: {} })).toContain(
      'complete current bounded projection'
    )
  })

  it('reports a missing snapshot', () => {
    expect(flightNotice(null)).toContain('No runtime snapshot')
  })
})

describe('freshnessChip', () => {
  const snap = fixture() as Record<string, unknown>

  it('labels live snapshots with the revision', () => {
    expect(freshnessChip('live', snap)).toEqual({ label: 'LIVE · REV 5008', tone: 'healthy' })
  })

  it('grays cached snapshots when the connection is not live', () => {
    expect(freshnessChip('offline', snap)).toEqual({ label: 'CACHED', tone: 'neutral' })
    expect(freshnessChip('connecting', snap)).toEqual({ label: 'CACHED', tone: 'neutral' })
  })

  it('stays neutral without a snapshot', () => {
    expect(freshnessChip('live', null)).toEqual({ label: 'NO SNAPSHOT', tone: 'neutral' })
  })
})

describe('nodeTone', () => {
  it('maps the daemon derived status to tones while live', () => {
    expect(nodeTone('live', 'ONLINE')).toBe('healthy')
    expect(nodeTone('live', 'OFFLINE')).toBe('error')
    expect(nodeTone('live', 'SUSPECT')).toBe('attention')
    expect(nodeTone('live', 'REVOKED')).toBe('error')
    expect(nodeTone('live', 'PAIRED')).toBe('neutral')
  })

  it('grays every node when the connection is not live', () => {
    expect(nodeTone('offline', 'ONLINE')).toBe('neutral')
    expect(nodeTone('reconnecting', 'OFFLINE')).toBe('neutral')
    expect(nodeTone('connecting', 'ONLINE')).toBe('neutral')
  })
})

describe('parseSnapshot flight fields', () => {
  it('parses the truncated flags and flight lists from the capture', () => {
    const snapshot = parseSnapshot(fixture())
    expect(snapshot?.truncated).toMatchObject({ events: true, audit: true, nodes: false })
    expect(snapshot?.events).toHaveLength(100)
    expect(snapshot?.audit).toHaveLength(100)
    expect(snapshot?.events[0]).toEqual({
      seq: 191990,
      id: '1789106408161-7edd0c1b8e1b75da7ca539d5',
      kind: 'entity.changed',
      time: '2026-09-11T06:00:08.164134Z'
    })
  })

  it('tolerates snapshots without flight fields', () => {
    const value = fixture() as Record<string, unknown>
    const { events, audit, truncated, ...rest } = value
    void events
    void audit
    void truncated
    const snapshot = parseSnapshot(rest)
    expect(snapshot).not.toBeNull()
    expect(snapshot?.events).toEqual([])
    expect(snapshot?.audit).toEqual([])
    expect(snapshot?.truncated).toEqual({})
  })

  it('skips malformed flight rows without dropping the snapshot', () => {
    const value = fixture() as Record<string, unknown>
    const snapshot = parseSnapshot({ ...value, events: [null, { id: 'x' }], audit: [1] })
    expect(snapshot?.events).toEqual([])
    expect(snapshot?.audit).toEqual([])
  })
})
