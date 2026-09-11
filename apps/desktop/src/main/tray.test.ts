import { describe, expect, it, vi, type Mock } from 'vitest'
import { elapsed } from '../shared/format'
import type { SSEEvent } from '../shared/protocol'
import { CockpitModel } from './cockpit-model'
import type { ModelUpdate } from './cockpit-model'
import {
  trayDetailLine,
  trayFocusLine,
  trayMenuItems,
  trayStatusLabel,
  type TrayActions
} from './tray'

const LIVE: ModelUpdate = {
  snapshot: null,
  state: 'live',
  receivedAt: 1_000,
  lastError: null
}

// Snapshot shaped after the daemon's GET /v0.1/cockpit projection.
const LIVE_SNAPSHOT = {
  version: '0.1',
  revision: 321,
  timestamp: 't',
  session: {
    id: 's1',
    project_id: 'project-zero',
    project: 'Project Zero',
    state: 'RUNNING',
    elapsed_ms: 60_000,
    since_ms: 1,
    revision: 321
  },
  nodes: [
    {
      id: 'desk-display-01',
      revoked: false,
      capabilities: ['display.render'],
      last_seen: null,
      status: 'ONLINE'
    }
  ],
  integrations: [],
  approvals: [{ id: 'a1' }],
  firings: [{ state: 'PENDING' }, { state: 'PENDING' }, { state: 'SUCCEEDED' }],
  truncated: { approvals: true, firings: false },
  invocations: [{ id: 'i1', capability: 'display.render', status: 'SUCCEEDED', node: 'd1' }]
}

const withSnapshot = (over: Record<string, unknown>): ModelUpdate => ({
  ...LIVE,
  snapshot: { ...LIVE_SNAPSHOT, ...over }
})

type TrayActionSpies = {
  openDesktop: Mock<() => void>
  quit: Mock<() => void>
}

const actions = (): TrayActionSpies => ({
  openDesktop: vi.fn<() => void>(),
  quit: vi.fn<() => void>()
})

const asTrayActions = (a: TrayActionSpies): TrayActions => ({
  openDesktop: () => a.openDesktop(),
  quit: () => a.quit()
})

describe('trayStatusLabel', () => {
  it('maps each connection state to its exact label', () => {
    expect(trayStatusLabel('connecting')).toBe('Connecting')
    expect(trayStatusLabel('live')).toBe('Runtime live')
    expect(trayStatusLabel('reconnecting')).toBe('Reconnecting')
    expect(trayStatusLabel('offline')).toBe('Runtime offline')
  })
})

describe('trayFocusLine', () => {
  it('shows No focus session when the snapshot has no session', () => {
    expect(trayFocusLine('live', null, 2_000, 1_000)).toBe('No focus session')
    expect(trayFocusLine('live', {}, 2_000, 1_000)).toBe('No focus session')
  })

  it('shows No focus session for an idle session', () => {
    const u = withSnapshot({ session: { ...LIVE_SNAPSHOT.session, state: 'IDLE' } })
    expect(trayFocusLine('live', u.snapshot, 2_000, 1_000)).toBe('No focus session')
  })

  it('extrapolates a running focus session while live', () => {
    expect(trayFocusLine('live', LIVE_SNAPSHOT, 31_000, 1_000)).toBe(elapsed(60_000 + 30_000))
  })

  it('freezes the base elapsed for a paused session even while live', () => {
    const u = withSnapshot({ session: { ...LIVE_SNAPSHOT.session, state: 'PAUSED' } })
    expect(trayFocusLine('live', u.snapshot, 31_000, 1_000)).toBe(elapsed(60_000))
  })

  it('freezes the base elapsed when no receive time is known', () => {
    expect(trayFocusLine('live', LIVE_SNAPSHOT, 31_000, null)).toBe(elapsed(60_000))
  })

  it('never extrapolates a cached session while reconnecting or offline', () => {
    expect(trayFocusLine('reconnecting', LIVE_SNAPSHOT, 31_000, 1_000)).toBe(elapsed(60_000))
    expect(trayFocusLine('offline', LIVE_SNAPSHOT, 31_000, 1_000)).toBe(elapsed(60_000))
    expect(trayFocusLine('connecting', LIVE_SNAPSHOT, 31_000, 1_000)).toBe(elapsed(60_000))
  })
})

describe('trayDetailLine', () => {
  it('is absent when the runtime is not live, even with a cached snapshot', () => {
    expect(trayDetailLine('offline', LIVE_SNAPSHOT)).toBeNull()
    expect(trayDetailLine('reconnecting', LIVE_SNAPSHOT)).toBeNull()
    expect(trayDetailLine('connecting', LIVE_SNAPSHOT)).toBeNull()
  })

  it('is absent when live but no snapshot has arrived', () => {
    expect(trayDetailLine('live', null)).toBeNull()
    expect(trayDetailLine('live', {})).toBeNull()
  })

  it('maps the latest display invocation status to delivery labels', () => {
    const inv = (status: string): Record<string, unknown> => ({
      ...LIVE_SNAPSHOT.invocations[0],
      status
    })
    expect(
      trayDetailLine('live', withSnapshot({ invocations: [inv('SUCCEEDED')] }).snapshot)
    ).toMatch(/^Delivered ·/)
    expect(
      trayDetailLine('live', withSnapshot({ invocations: [inv('DISPATCHED')] }).snapshot)
    ).toMatch(/^Awaiting delivery ·/)
    expect(trayDetailLine('live', withSnapshot({ invocations: [inv('QUEUED')] }).snapshot)).toMatch(
      /^Queued ·/
    )
    expect(trayDetailLine('live', withSnapshot({ invocations: [inv('FAILED')] }).snapshot)).toMatch(
      /^Stale or uncertain ·/
    )
  })

  it('falls back to committed-locally when idle-less snapshots carry no display delivery', () => {
    expect(trayDetailLine('live', withSnapshot({ invocations: [] }).snapshot)).toMatch(
      /^Committed locally ·/
    )
    const idle = withSnapshot({
      invocations: [],
      session: { ...LIVE_SNAPSHOT.session, state: 'IDLE' }
    })
    expect(trayDetailLine('live', idle.snapshot)).toMatch(/^Stale or uncertain ·/)
  })

  it('counts approvals plus pending firings with a truncated lower bound', () => {
    expect(trayDetailLine('live', withSnapshot({}).snapshot)).toMatch(/· Attention 3\+$/)
    const clean = withSnapshot({
      approvals: [],
      firings: [],
      truncated: {}
    })
    expect(trayDetailLine('live', clean.snapshot)).toMatch(/· Attention 0$/)
  })
})

describe('trayMenuItems', () => {
  it('renders exactly the compact companion menu', () => {
    const a = actions()
    const update = withSnapshot({})
    const items = trayMenuItems(update, 31_000, asTrayActions(a))
    expect(items).toHaveLength(6)
    expect(items[0]).toEqual({ label: 'Runtime live', enabled: false })
    expect(items[1]).toEqual({ label: elapsed(90_000), enabled: false })
    expect(items[2]).toEqual({ label: 'Delivered · Attention 3+', enabled: false })
    expect(items[3]).toEqual({ type: 'separator' })
    expect(items[4].label).toBe('Open Zero Desktop')
    expect(items[4].enabled).not.toBe(false)
    expect(items[5].label).toBe('Quit')
    expect(items[5].enabled).not.toBe(false)
  })

  it('omits the delivery/attention line when it is absent', () => {
    const a = actions()
    const items = trayMenuItems({ ...LIVE, snapshot: null }, 31_000, asTrayActions(a))
    expect(items).toHaveLength(5)
    expect(items[2]).toEqual({ type: 'separator' })
  })

  it('wires Open Zero Desktop and Quit to the injected actions', () => {
    const a = actions()
    const items = trayMenuItems(LIVE, 31_000, asTrayActions(a))
    const open = items[3].click as (() => void) | undefined
    open?.()
    expect(a.openDesktop).toHaveBeenCalledOnce()
    const quit = items[4].click as (() => void) | undefined
    quit?.()
    expect(a.quit).toHaveBeenCalledOnce()
  })
})

type StreamCtl = { emit: (e: SSEEvent) => void; end: (err?: Error) => void }
type FetchSlot = { resolve: (v: unknown) => void }
type ModelHarness = {
  model: CockpitModel
  streams: StreamCtl[]
  fetches: FetchSlot[]
  updates: ModelUpdate[]
}

function harness(): ModelHarness {
  const streams: StreamCtl[] = []
  const fetches: FetchSlot[] = []
  const model = new CockpitModel(
    '/tmp/fake.sock',
    () => new Promise((resolve) => fetches.push({ resolve })),
    (_socket, onEvent, onEnd) => {
      const ctl: StreamCtl = {
        emit: (e) => onEvent(e),
        end: (e) => onEnd(e)
      }
      streams.push(ctl)
      return () => {}
    },
    { schedule: () => () => {} }
  )
  const updates: ModelUpdate[] = []
  model.subscribe((u) => updates.push({ ...u }))
  return { model, streams, fetches, updates }
}

const ready = (): SSEEvent => ({
  name: 'ready',
  data: JSON.stringify({ revision: 1, domains: [], timestamp: 't' })
})

describe('tray with the real cockpit model (no daemon contact)', () => {
  it('flows live model updates into the menu labels and actions', async () => {
    const h = harness()
    const a = actions()
    h.model.start()
    await vi.waitFor(() => expect(h.streams).toHaveLength(1))
    h.streams[0].emit(ready())
    await vi.waitFor(() => expect(h.fetches).toHaveLength(1))
    h.fetches[0].resolve(LIVE_SNAPSHOT)
    await vi.waitFor(() => expect(h.updates.at(-1)?.state).toBe('live'))

    const last = h.updates.at(-1)!
    const items = trayMenuItems(last, last.receivedAt! + 5_000, asTrayActions(a))
    expect(items[0].label).toBe('Runtime live')
    expect(items[1].label).toBe(elapsed(60_000 + 5_000))
    expect(items[2].label).toBe('Delivered · Attention 3+')
    const open = items[4].click as (() => void) | undefined
    open?.()
    expect(a.openDesktop).toHaveBeenCalledOnce()
    const quit = items[5].click as (() => void) | undefined
    quit?.()
    expect(a.quit).toHaveBeenCalledOnce()
  })

  it('gates the delivery line and freezes focus while the stream reconnects', async () => {
    const h = harness()
    h.model.start()
    await vi.waitFor(() => expect(h.streams).toHaveLength(1))
    h.streams[0].emit(ready())
    await vi.waitFor(() => expect(h.fetches).toHaveLength(1))
    h.fetches[0].resolve(LIVE_SNAPSHOT)
    await vi.waitFor(() => expect(h.updates.at(-1)?.state).toBe('live'))

    h.streams[0].end(new Error('reset'))
    await vi.waitFor(() => expect(h.updates.at(-1)?.state).toBe('reconnecting'))
    const last = h.updates.at(-1)!
    const items = trayMenuItems(last, 999_000, asTrayActions(actions()))
    expect(items[0].label).toBe('Reconnecting')
    expect(items[1].label).toBe(elapsed(60_000))
    expect(items).toHaveLength(5)
    expect(items[2]).toEqual({ type: 'separator' })
  })

  it('shows the offline status after stop', async () => {
    const h = harness()
    h.model.start()
    await vi.waitFor(() => expect(h.streams).toHaveLength(1))
    h.model.stop()
    await vi.waitFor(() => expect(h.updates.at(-1)?.state).toBe('offline'))
    const items = trayMenuItems(h.updates.at(-1)!, 999_000, asTrayActions(actions()))
    expect(items[0].label).toBe('Runtime offline')
  })
})
