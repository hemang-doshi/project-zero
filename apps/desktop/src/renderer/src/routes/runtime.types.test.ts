import { describe, expect, it } from 'vitest'
import fixtureJson from './fixtures/cockpit.json'
import {
  activeProjectLabel,
  connectivity,
  extrapolate,
  gitLine,
  parseSnapshot,
  parseTelemetry,
  selectSession,
  sessionChipTone,
  sessionTone,
  pressureTone,
  EMPTY_MACHINE_SAMPLE,
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

  it('parses once per snapshot reference and re-parses new references', () => {
    const snap = { ...(fixture() as Record<string, unknown>), revision: 321 }
    const first = parseSnapshot(snap)
    const second = parseSnapshot(snap)
    expect(second).toBe(first) // same reference → cached projection
    const changed = { ...snap, revision: 322 }
    const next = parseSnapshot(changed)
    expect(next).not.toBe(first) // new reference → re-parse
    expect(next?.revision).toBe(322)
  })

  it('caches malformed snapshots by reference too', () => {
    const bad = { version: '9.9' }
    expect(parseSnapshot(bad)).toBeNull()
    expect(parseSnapshot(bad)).toBeNull()
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

describe('sessionTone', () => {
  it('maps session states to tones', () => {
    expect(sessionTone('RUNNING')).toBe('healthy')
    expect(sessionTone('PAUSED')).toBe('attention')
    expect(sessionTone('IDLE')).toBe('neutral')
    expect(sessionTone('QUEUED')).toBe('error')
    expect(sessionTone(null)).toBe('error')
  })
})

describe('sessionChipTone', () => {
  it('keeps the live tone mapping', () => {
    expect(sessionChipTone('live', 'RUNNING')).toBe('healthy')
    expect(sessionChipTone('live', 'PAUSED')).toBe('attention')
    expect(sessionChipTone('live', 'IDLE')).toBe('neutral')
  })

  it('grays cached states when the connection is not live', () => {
    expect(sessionChipTone('offline', 'RUNNING')).toBe('neutral')
    expect(sessionChipTone('reconnecting', 'RUNNING')).toBe('neutral')
    expect(sessionChipTone('connecting', 'RUNNING')).toBe('neutral')
  })

  it('keeps error for a missing snapshot in every connection state', () => {
    expect(sessionChipTone('live', null)).toBe('error')
    expect(sessionChipTone('offline', null)).toBe('error')
  })
})

describe('activeProjectLabel', () => {
  it('shows the project name only while live', () => {
    expect(activeProjectLabel('live', 'Project Zero')).toBe('Project Zero')
    expect(activeProjectLabel('live', '')).toBe('No active project')
    expect(activeProjectLabel('offline', 'Project Zero')).toBe('No active project')
    expect(activeProjectLabel('reconnecting', 'Project Zero')).toBe('No active project')
  })
})

describe('extrapolate', () => {
  it('returns null without a snapshot', () => {
    expect(extrapolate(null, true, 1_000, 5_000)).toBeNull()
  })

  it('adds elapsed time while ticking against a receivedAt baseline', () => {
    expect(extrapolate(1_000, true, 1_000, 4_000)).toBe(4_000)
  })

  it('freezes the snapshot value when not ticking', () => {
    expect(extrapolate(1_000, false, 1_000, 9_000)).toBe(1_000)
  })

  it('freezes when receivedAt is unknown', () => {
    expect(extrapolate(1_000, true, null, 9_000)).toBe(1_000)
  })

  it('clamps a stale baseline where now precedes receivedAt', () => {
    expect(extrapolate(1_000, true, 5_000, 2_000)).toBe(1_000)
  })
})

describe('machine sample shape', () => {
  it('starts with every panel unavailable', () => {
    const sample: MachineSample = { cpu: null, memory: null, io: null, net: null, gpu: null }
    expect(sample).toEqual(EMPTY_MACHINE_SAMPLE)
  })
})

const WELL_FORMED: Record<string, unknown> = {
  cpu: { system: 4.25, user: 30, idle: 65.75, threads: 3185, processes: 780 },
  memory: {
    total: 17_179_869_184,
    used: 13_421_772_800,
    percent: 78.125,
    pressure: 78.125,
    level: 'medium',
    app: 5_368_709_120,
    wired: 3_221_225_472,
    compressed: 4_831_838_208,
    cachedFiles: 2_684_354_560,
    swapUsed: 536_870_912
  },
  io: {
    reads: 8_348_407,
    writes: 2_515_963,
    readsPerSec: 12.5,
    writesPerSec: 3.5,
    dataRead: 156_378_263_552,
    dataWritten: 47_597_654_016,
    dataReadPerSec: 1_048_576,
    dataWrittenPerSec: 262_144
  },
  net: {
    packetsIn: 883_011,
    packetsOut: 883_011,
    packetsInPerSec: 25.5,
    packetsOutPerSec: 21.5,
    dataReceived: 951_953_745,
    dataSent: 951_953_745,
    dataReceivedPerSec: 40_960,
    dataSentPerSec: 20_480
  },
  gpu: 29
}

describe('parseTelemetry', () => {
  it('parses a well-formed sampler payload into the panel sample', () => {
    expect(parseTelemetry(WELL_FORMED)).toEqual(WELL_FORMED)
  })

  it('keeps nulls for absent or malformed parts instead of dropping the sample', () => {
    expect(parseTelemetry({})).toEqual(EMPTY_MACHINE_SAMPLE)
    expect(
      parseTelemetry({
        cpu: 'x',
        memory: { total: 0 },
        io: { reads: 'no', dataWritten: 5 },
        net: 'nonsense',
        gpu: 9
      })
    ).toEqual({
      cpu: null,
      memory: {
        total: 0,
        used: 0,
        percent: 0,
        pressure: 0,
        level: 'low',
        app: null,
        wired: null,
        compressed: null,
        cachedFiles: null,
        swapUsed: null
      },
      io: {
        reads: null,
        writes: null,
        readsPerSec: null,
        writesPerSec: null,
        dataRead: null,
        dataWritten: 5,
        dataReadPerSec: null,
        dataWrittenPerSec: null
      },
      net: null,
      gpu: 9
    })
    expect(parseTelemetry(null)).toEqual(EMPTY_MACHINE_SAMPLE)
    expect(parseTelemetry('nonsense')).toEqual(EMPTY_MACHINE_SAMPLE)
  })

  it('collapses malformed cells to null while keeping valid siblings', () => {
    const sample = parseTelemetry({
      ...WELL_FORMED,
      io: {
        reads: 'x',
        writes: Number.NaN,
        readsPerSec: 1,
        writesPerSec: 'no',
        dataRead: 100,
        dataWritten: null,
        dataReadPerSec: 2,
        dataWrittenPerSec: true
      }
    })
    expect(sample.io?.reads).toBeNull()
    expect(sample.io?.writes).toBeNull()
    expect(sample.io?.readsPerSec).toBe(1)
    expect(sample.io?.writesPerSec).toBeNull()
    expect(sample.io?.dataRead).toBe(100)
    expect(sample.io?.dataWritten).toBeNull()
    expect(sample.io?.dataReadPerSec).toBe(2)
    expect(sample.io?.dataWrittenPerSec).toBeNull()
  })

  it('rejects a malformed memory family honestly', () => {
    expect(parseTelemetry({ ...WELL_FORMED, memory: { total: 'no' } }).memory).toBeNull()
    expect(parseTelemetry({ ...WELL_FORMED, memory: null }).memory).toBeNull()
  })
})

describe('pressureTone', () => {
  it('maps kernel pressure levels to tones', () => {
    expect(pressureTone('low')).toBe('healthy')
    expect(pressureTone('medium')).toBe('attention')
    expect(pressureTone('high')).toBe('error')
  })
})
