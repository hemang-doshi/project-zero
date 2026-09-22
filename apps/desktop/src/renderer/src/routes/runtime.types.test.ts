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
  selectSpotify,
  EMPTY_MACHINE_SAMPLE,
  type MachineSample
} from './runtime.types'

const fixture = (): unknown => fixtureJson as unknown

describe('selectSession', () => {
  it('reads the session fields the routes render', () => {
    const session = selectSession(fixture())
    expect(session).toEqual({
      id: 'sample-session-001',
      project_id: 'project-zero',
      project: 'Project Zero',
      state: 'RUNNING',
      elapsed_ms: 120000,
      since_ms: 1767225600000,
      revision: 1
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
  it('parses the anonymized sample snapshot', () => {
    const snapshot = parseSnapshot(fixture())
    expect(snapshot).not.toBeNull()
    expect(snapshot?.version).toBe('0.1')
    expect(snapshot?.nodes).toHaveLength(2)
    expect(snapshot?.nodes[0]).toEqual({
      id: 'desk-display-01',
      revoked: false,
      capabilities: ['display.render', 'display.clear'],
      last_seen: '2026-01-01T00:00:00Z',
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
    expect(gitLine(fixture())).toEqual({ branch: 'main', dirty: 'true' })
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
  cpu: { system: 4.25, user: 30, idle: 65.75, threads: 128, processes: 42 },
  memory: {
    total: 17_179_869_184,
    used: 8_589_934_592,
    percent: 50,
    pressure: 50,
    level: 'medium',
    app: 4_294_967_296,
    wired: 1_610_612_736,
    compressed: 1_073_741_824,
    cachedFiles: 1_610_612_736,
    swapUsed: 134_217_728
  },
  io: {
    reads: 1_234_567,
    writes: 2_345_678,
    readsPerSec: 12.5,
    writesPerSec: 3.5,
    dataRead: 1_073_741_824,
    dataWritten: 268_435_456,
    dataReadPerSec: 1_048_576,
    dataWrittenPerSec: 262_144
  },
  net: {
    packetsIn: 12_345,
    packetsOut: 6_789,
    packetsInPerSec: 4.5,
    packetsOutPerSec: 3.5,
    dataReceived: 2_000_000,
    dataSent: 1_500_000,
    dataReceivedPerSec: 1_024,
    dataSentPerSec: 512
  },
  gpu: 42
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

describe('cockpit audio projection (Task 26)', () => {
  it('parses the fixture audio block the daemon projection now carries', () => {
    const snapshot = parseSnapshot(fixture())
    expect(snapshot?.audio).toEqual({
      level: 8,
      bass: 118,
      sequence: 142,
      status: 'ACTIVE'
    })
  })

  it('collapses malformed or absent audio to null without failing the snapshot', () => {
    const value = fixture() as Record<string, unknown>
    expect(parseSnapshot({ ...value, audio: 'nope' })?.audio).toBeNull()
    expect(parseSnapshot({ ...value, audio: { bass: 'x', status: 3 } })?.audio).toBeNull()
    expect(parseSnapshot({ ...value, audio: { bass: -3, status: 'ACTIVE' } })?.audio).toBeNull()
    const noAudio = { ...value } as Record<string, unknown>
    delete noAudio.audio
    expect(parseSnapshot(noAudio)?.audio).toBeNull()
    expect(parseSnapshot(noAudio)).not.toBeNull()
  })
})

describe('selectSpotify', () => {
  it('reads the bounded media fields the desk card renders', () => {
    const spotify = selectSpotify(fixture())
    expect(spotify).toEqual({
      enabled: true,
      status: 'ONLINE',
      state: 'paused',
      track: 'Example Track',
      artist: 'Example Artist',
      artworkId: '0000000000000000000000000000000000000000000000000000000000000000',
      audioCapture: 'DISABLED'
    })
  })

  it('is null when the snapshot has no spotify integration', () => {
    const value = fixture() as Record<string, unknown>
    expect(selectSpotify({ ...value, integrations: [] })).toBeNull()
    expect(selectSpotify({ ...value, integrations: 'no' })).toBeNull()
    expect(selectSpotify(null)).toBeNull()
  })

  it('keeps non-string media fields out of the honest projection', () => {
    const value = fixture() as Record<string, unknown>
    const integrations = (value.integrations as Record<string, unknown>[]).map((i) =>
      i.id === 'spotify' ? { ...i, data: { state: 3, track: null, artist: 'X', artwork_id: 4 } } : i
    )
    const spotify = selectSpotify({ ...value, integrations })
    expect(spotify).toEqual({
      enabled: true,
      status: 'ONLINE',
      state: '',
      track: '',
      artist: 'X',
      artworkId: null,
      audioCapture: ''
    })
  })
})
