import { describe, expect, it } from 'vitest'
import fixtureJson from './fixtures/cockpit.json'
import {
  connectivity,
  gitLine,
  mostLoaded,
  parseSnapshot,
  selectSession,
  sessionTone,
  type MachineSample
} from './runtime.types'

const fixture = (): unknown => fixtureJson as unknown

describe('selectSession', () => {
  it('reads the session fields the routes render', () => {
    const session = selectSession(fixture())
    expect(session).toEqual({
      id: '1788913498387-dfc67f5f489247d2685e37b0',
      project_id: 'project-zero',
      project: 'Project Zero',
      state: 'RUNNING',
      elapsed_ms: 188571082,
      since_ms: 1788981229646,
      revision: 321
    })
  })

  it('rejects non-objects and malformed sessions', () => {
    expect(selectSession(null)).toBeNull()
    expect(selectSession('x')).toBeNull()
    expect(selectSession({ session: { project: 3 } })).toBeNull()
    expect(selectSession({ other: true })).toBeNull()
  })
})

describe('parseSnapshot', () => {
  it('parses the recorded production snapshot', () => {
    const snapshot = parseSnapshot(fixture())
    expect(snapshot).not.toBeNull()
    expect(snapshot?.version).toBe('0.1')
    expect(snapshot?.nodes).toHaveLength(2)
    expect(snapshot?.nodes[0]).toEqual({
      id: 'desk-display-01',
      revoked: false,
      capabilities: ['display.render', 'display.clear'],
      last_seen: '2026-09-11T05:59:49.463537Z',
      status: 'ONLINE'
    })
    expect(snapshot?.integrations.map((i) => i.id)).toEqual(['git', 'spotify', 'codex'])
  })

  it('coerces numeric revoked flags', () => {
    const snapshot = parseSnapshot(fixture())
    expect(snapshot?.nodes[1]).toMatchObject({ id: 'desk-simulator', revoked: false })
  })

  it('rejects wrong version and malformed shapes', () => {
    const value = fixture() as Record<string, unknown>
    expect(parseSnapshot({ ...value, version: '9.9' })).toBeNull()
    expect(parseSnapshot({ ...value, nodes: 'nope' })).toBeNull()
    expect(parseSnapshot({ ...value, session: 4 })).toBeNull()
    expect(parseSnapshot(undefined)).toBeNull()
  })
})

describe('connectivity', () => {
  const snap = fixture() as Record<string, unknown>

  it('is offline when the connection is not live', () => {
    expect(connectivity('offline', snap).tone).toBe('error')
    expect(connectivity('reconnecting', snap).tone).toBe('attention')
    expect(connectivity('connecting', snap).tone).toBe('attention')
  })

  it('reports connected display nodes when live', () => {
    const c = connectivity('live', snap)
    expect(c.tone).toBe('healthy')
    expect(c.detail).toBe('desk-display-01 online · desk-simulator offline')
  })

  it('is stale when no display node is online', () => {
    const first = (snap.nodes as Record<string, unknown>[])[0]
    const value = { ...snap, nodes: [{ ...first, status: 'OFFLINE' }] }
    expect(connectivity('live', value).tone).toBe('attention')
  })

  it('is offline when no display-capable node exists', () => {
    const value = { ...snap, nodes: [{ id: 'n', revoked: 0, capabilities: [], status: 'ONLINE' }] }
    expect(connectivity('live', value).tone).toBe('error')
  })
})

describe('gitLine', () => {
  it('reads the git integration data when present', () => {
    expect(gitLine(fixture())).toEqual({ branch: 'build/v0.2', dirty: 'true' })
  })

  it('returns null without a git integration', () => {
    const value = fixture() as Record<string, unknown>
    const integrations = (value.integrations as unknown[]).filter(
      (i) => (i as { id?: string }).id !== 'git'
    )
    expect(gitLine({ ...value, integrations })).toBeNull()
  })
})

describe('mostLoaded', () => {
  it('picks the highest loaded percent metric', () => {
    expect(mostLoaded({ cpu: 12.5, ram: 40, ssd: 999, gpu: 3 })).toBe('ram')
    expect(mostLoaded({ cpu: 90, ram: 10, ssd: 0, gpu: 88 })).toBe('cpu')
  })

  it('returns null without any percent sample', () => {
    expect(mostLoaded({ cpu: null, ram: null, ssd: 5_000, gpu: null })).toBeNull()
  })

  it('ignores non-finite values', () => {
    expect(mostLoaded({ cpu: Number.NaN, ram: 1, ssd: null, gpu: null })).toBe('ram')
  })
})

describe('sessionTone', () => {
  it('maps session states to tones', () => {
    expect(sessionTone('RUNNING')).toBe('healthy')
    expect(sessionTone('PAUSED')).toBe('attention')
    expect(sessionTone('IDLE')).toBe('neutral')
    expect(sessionTone('QUEUED')).toBe('error')
    expect(sessionTone(null)).toBe('error')
  })
})

describe('machine sample shape', () => {
  it('starts with every tile unavailable', () => {
    const sample: MachineSample = { cpu: null, ram: null, ssd: null, gpu: null }
    expect([sample.cpu, sample.ram, sample.ssd, sample.gpu]).toEqual([null, null, null, null])
  })
})
