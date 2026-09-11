import { describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { BridgeDeps, HarnessId, RpcEvent } from './bridges'
import { attachBridgePush, createDispatch, type SocketDeps } from './ipc'
import { defaultPrefs, type Prefs } from './prefs'
import { PrefsStore } from './prefs'
import type { TelemetrySample } from '../shared/ipc'

type FakeBridge = {
  state: 'disconnected' | 'connecting' | 'live'
  lastDiagnostic: string | null
  sends: Array<{ method: string; params: unknown }>
  events: Array<(ev: RpcEvent) => void>
  send: (method: string, params?: unknown) => Promise<unknown>
  onEvent: (cb: (ev: RpcEvent) => void) => () => void
  connect: () => Promise<'live'>
  disconnect: () => 'disconnected'
}

function fakeBridge(state: FakeBridge['state']): FakeBridge {
  const sends: Array<{ method: string; params: unknown }> = []
  const events: Array<(ev: RpcEvent) => void> = []
  return {
    state,
    lastDiagnostic: state === 'live' ? null : `${harnessName(state)} diagnostic`,
    sends,
    events,
    send: (method, params) => {
      sends.push({ method, params: params ?? {} })
      if (method === 'model/list')
        return Promise.resolve({ data: [{ id: 'gpt-5.6-luna', displayName: 'Luna' }] })
      if (method === 'thread/list')
        return Promise.resolve({ data: [{ id: 't1', name: 'Thread one' }] })
      return Promise.resolve({})
    },
    onEvent: (cb) => {
      events.push(cb)
      return () => {}
    },
    connect: () => Promise.resolve('live'),
    disconnect: () => 'disconnected'
  }
}

function harnessName(state: string): string {
  return state
}

const TELEMETRY_SAMPLE: TelemetrySample = {
  cpu: 4.2,
  ram: { used: 8, total: 16, percent: 50 },
  ssd: { used: 100, total: 245, percent: 40.8 },
  gpu: null
}

const deps = (): SocketDeps => ({
  socketPath: '/tmp/no-such-test.sock',
  fetchSnapshot: vi.fn(() => Promise.resolve({})),
  postCommand: vi.fn(() => Promise.resolve({})),
  store: new PrefsStore(fs.mkdtempSync(path.join(os.tmpdir(), 'zero-ipc-prefs-'))),
  pickImage: vi.fn(() => Promise.resolve(null)),
  sampleTelemetry: vi.fn(() => Promise.resolve(TELEMETRY_SAMPLE))
})

function fakePair(codex: FakeBridge, ocp: FakeBridge): BridgeDeps {
  return {
    codex: codex as unknown as BridgeDeps['codex'],
    ocp: ocp as unknown as BridgeDeps['ocp']
  }
}

describe('bridge state ops', () => {
  it('returns bridge state and diagnostic without contacting the daemon', async () => {
    const codex = fakeBridge('disconnected')
    const invoke = createDispatch(deps(), () => fakePair(codex, fakeBridge('live')))
    await expect(invoke('codex.state')).resolves.toEqual({
      state: 'disconnected',
      lastDiagnostic: 'disconnected diagnostic'
    })
    await expect(invoke('ocp.state')).resolves.toEqual({
      state: 'live',
      lastDiagnostic: null
    })
  })
})

describe('discovery ops', () => {
  it('probes model/list then thread/list through the bridge send while live', async () => {
    const codex = fakeBridge('live')
    const invoke = createDispatch(deps(), () => fakePair(codex, fakeBridge('disconnected')))
    await expect(invoke('codex.discover')).resolves.toEqual({
      harness: 'codex',
      models: [{ id: 'gpt-5.6-luna', displayName: 'Luna' }],
      threads: [{ id: 't1', name: 'Thread one' }]
    })
    expect(codex.sends).toEqual([
      { method: 'model/list', params: { limit: 100 } },
      { method: 'thread/list', params: { limit: 100 } }
    ])
  })

  it('rejects discovery while the bridge is not live and sends nothing', async () => {
    const codex = fakeBridge('disconnected')
    const invoke = createDispatch(deps(), () => fakePair(codex, fakeBridge('disconnected')))
    await expect(invoke('codex.discover')).rejects.toThrow('not connected')
    expect(codex.sends).toEqual([])
  })

  it('answers opencode discovery honestly empty without any session probe', async () => {
    const ocp = fakeBridge('live')
    const invoke = createDispatch(deps(), () => fakePair(fakeBridge('disconnected'), ocp))
    const result = (await invoke('ocp.discover')) as {
      harness: HarnessId
      models: unknown[]
      threads: unknown[]
      note: string
    }
    expect(result.harness).toBe('opencode')
    expect(result.models).toEqual([])
    expect(result.threads).toEqual([])
    expect(result.note).toContain('read-only discovery')
    expect(ocp.sends).toEqual([])
  })

  it('falls back to an empty list when the harness answers without a data array', async () => {
    const codex = fakeBridge('live')
    codex.send = (method) =>
      method === 'model/list' ? Promise.resolve({ nope: 1 }) : Promise.resolve([1, 2])
    const invoke = createDispatch(deps(), () => fakePair(codex, fakeBridge('disconnected')))
    const result = (await invoke('codex.discover')) as { models: unknown[]; threads: unknown[] }
    expect(result.models).toEqual([])
    expect(result.threads).toEqual([1, 2])
  })
})

describe('send remains honestly blocked', () => {
  it.each(['codex.send', 'ocp.send'])('%s still throws the pinned block message', async (op) => {
    const invoke = createDispatch(deps(), () => fakePair(fakeBridge('live'), fakeBridge('live')))
    await expect(invoke(op, { method: 'turn/start', params: {} })).rejects.toThrow(
      'send blocked until runtime path ships'
    )
  })
})

describe('prefs ops', () => {
  it('returns the stored prefs on prefs.get without daemon contact', async () => {
    const d = deps()
    d.store.save({ ...defaultPrefs(), wallpaper: { kind: 'cream', mode: 'cover' } })
    const invoke = createDispatch(d, () => fakePair(fakeBridge('live'), fakeBridge('live')))
    const p = (await invoke('prefs.get')) as Prefs
    expect(p.version).toBe(1)
    expect(p.wallpaper).toEqual({ kind: 'cream', mode: 'cover' })
    expect(d.fetchSnapshot).not.toHaveBeenCalled()
  })
  it('persists a patch so a later get reflects it', async () => {
    const d = deps()
    const invoke = createDispatch(d, () => fakePair(fakeBridge('live'), fakeBridge('live')))
    await invoke('prefs.set', {
      icons: { 'icon-desk': { x: 40, y: 44 } },
      windows: { network: { x: 0, y: 0, w: 560, h: 480 } }
    })
    const p = (await invoke('prefs.get')) as Prefs
    expect(p.icons['icon-desk']).toEqual({ x: 40, y: 44 })
    expect(p.windows.network).toEqual({ x: 0, y: 0, w: 560, h: 480 })
    expect(p.windows.desk).toEqual(defaultPrefs().windows.desk)
  })
  it('rejects a wholly malformed set payload and leaves prefs.json intact', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-ipc-prefs-'))
    const store = new PrefsStore(dir)
    store.save(defaultPrefs())
    const d: SocketDeps = {
      socketPath: '/tmp/no-such-test.sock',
      fetchSnapshot: vi.fn(() => Promise.resolve({})),
      postCommand: vi.fn(() => Promise.resolve({})),
      store,
      pickImage: vi.fn(() => Promise.resolve(null)),
      sampleTelemetry: vi.fn(() => Promise.resolve(TELEMETRY_SAMPLE))
    }
    const invoke = createDispatch(d, () => fakePair(fakeBridge('live'), fakeBridge('live')))
    await expect(invoke('prefs.set', 'nonsense')).rejects.toThrow('Malformed prefs payload')
    expect(fs.readFileSync(path.join(dir, 'prefs.json'), 'utf8')).toContain('"version": 1')
  })
  it('drops malformed individual fields but keeps valid ones (fail-soft)', async () => {
    const d = deps()
    const invoke = createDispatch(d, () => fakePair(fakeBridge('live'), fakeBridge('live')))
    await invoke('prefs.set', {
      wallpaper: { kind: 'nope' },
      icons: { 'icon-desk': { x: 8, y: 9 } }
    })
    const p = (await invoke('prefs.get')) as Prefs
    expect(p.wallpaper.kind).toBe('dotted-green')
    expect(p.icons['icon-desk']).toEqual({ x: 8, y: 9 })
  })
})

describe('wallpaper.pick', () => {
  it('returns the picked image path from the injected dialog and touches no socket', async () => {
    const d = deps()
    d.pickImage = vi.fn(() => Promise.resolve('/Users/x/w.png'))
    const invoke = createDispatch(d, () => fakePair(fakeBridge('live'), fakeBridge('live')))
    await expect(invoke('wallpaper.pick')).resolves.toBe('/Users/x/w.png')
    expect(d.pickImage).toHaveBeenCalledOnce()
    expect(d.fetchSnapshot).not.toHaveBeenCalled()
  })
  it('returns null when the dialog is canceled', async () => {
    const d = deps()
    d.pickImage = vi.fn(() => Promise.resolve(null))
    const invoke = createDispatch(d, () => fakePair(fakeBridge('live'), fakeBridge('live')))
    await expect(invoke('wallpaper.pick')).resolves.toBeNull()
  })
})

describe('telemetry.sample', () => {
  it('answers with the injected local sampler payload without daemon contact', async () => {
    const d = deps()
    const invoke = createDispatch(d, () => fakePair(fakeBridge('live'), fakeBridge('live')))
    await expect(invoke('telemetry.sample')).resolves.toBe(TELEMETRY_SAMPLE)
    expect(d.sampleTelemetry).toHaveBeenCalledOnce()
    expect(d.fetchSnapshot).not.toHaveBeenCalled()
  })
})

describe('attachBridgePush', () => {
  it('forwards bridge events tagged with the bridge harness identity', () => {
    const codex = fakeBridge('live')
    const ocp = fakeBridge('live')
    const pushes: Array<{ channel: string; payload: unknown }> = []
    const win = {
      isDestroyed: (): boolean => false,
      webContents: {
        send: (channel: string, payload: unknown): void => {
          pushes.push({ channel, payload })
        }
      }
    }
    const stop = attachBridgePush(fakePair(codex, ocp), win as never)
    codex.events[0]({ method: 'item/agentMessage/delta', params: { delta: 'hi' } })
    ocp.events[0]({ method: 'session/update' })
    expect(pushes).toHaveLength(2)
    expect(pushes[0]).toMatchObject({ channel: 'zero:bridge', payload: { harness: 'codex' } })
    expect(pushes[1]).toMatchObject({ channel: 'zero:bridge', payload: { harness: 'opencode' } })
    stop()
  })

  it('drops pushes to a destroyed window', () => {
    const codex = fakeBridge('live')
    const pushes: unknown[] = []
    const win = {
      isDestroyed: (): boolean => true,
      webContents: {
        send: (channel: string, payload: unknown): void => void pushes.push([channel, payload])
      }
    }
    attachBridgePush(fakePair(codex, fakeBridge('live')), win as never)
    codex.events[0]({ method: 'x' })
    expect(pushes).toHaveLength(0)
  })
})
