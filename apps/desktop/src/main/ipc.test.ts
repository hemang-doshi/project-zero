import { describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { BridgeDeps, HarnessId, RpcEvent } from './bridges'
import { attachBridgePush, createDispatch, type SocketDeps } from './ipc'
import { defaultPrefs, type Prefs } from './prefs'
import { PrefsStore } from './prefs'
import type { DevicesListResult, TelemetrySample } from '../shared/ipc'

type FakeBridge = {
  state: 'disconnected' | 'connecting' | 'live'
  lastDiagnostic: string | null
  sends: Array<{ method: string; params: unknown }>
  events: Array<(ev: RpcEvent) => void>
  send: (method: string, params?: unknown) => Promise<unknown>
  onEvent: (cb: (ev: RpcEvent) => void) => () => void
  connect: () => Promise<'live'>
  disconnect: () => 'disconnected'
  respond: (id: string | number, result: unknown) => void
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
    disconnect: () => 'disconnected',
    respond: vi.fn()
  }
}

function harnessName(state: string): string {
  return state
}

const TELEMETRY_SAMPLE: TelemetrySample = {
  cpu: null,
  memory: null,
  io: null,
  net: null,
  gpu: null
}

const deps = (): SocketDeps => ({
  socketPath: '/tmp/no-such-test.sock',
  fetchSnapshot: vi.fn(() => Promise.resolve({})),
  postCommand: vi.fn(() => Promise.resolve({})),
  store: new PrefsStore(fs.mkdtempSync(path.join(os.tmpdir(), 'zero-ipc-prefs-'))),
  pickImage: vi.fn(() => Promise.resolve(null)),
  sampleTelemetry: vi.fn(() => Promise.resolve(TELEMETRY_SAMPLE)),
  listDevices: vi.fn((): Promise<DevicesListResult> =>
    Promise.resolve({ devices: [], note: 'No local USB or Bluetooth devices seen.' })
  ),
  discoverSkills: vi.fn(() => Promise.resolve({ ok: true, groups: [], selfLearnt: [], note: null }))
})

describe('projects.list', () => {
  it('reads only the registered-project endpoint and returns bounded active fields', async () => {
    const d = deps()
    d.fetchSnapshot = vi.fn(async () => ({
      projects: [
        { id: 'p1', name: 'Zero', path: '/code/zero', aliases: ['secret'] },
        { id: 'p2', name: 'Old', path: '/code/old', removed: true }
      ]
    }))
    const invoke = createDispatch(d)
    await expect(invoke('projects.list')).resolves.toEqual([
      { id: 'p1', name: 'Zero', path: '/code/zero' }
    ])
    expect(d.fetchSnapshot).toHaveBeenCalledWith(d.socketPath, { path: '/v0.1/projects' })
  })

  it('rejects malformed responses rather than inventing an empty list', async () => {
    const d = deps()
    d.fetchSnapshot = vi.fn(async () => ({ projects: [{ id: 'p1', name: 'Zero' }] }))
    await expect(createDispatch(d)('projects.list')).rejects.toThrow('Malformed project row')
  })

  it('accepts a daemon nil slice as an empty registered-project list', async () => {
    const d = deps()
    d.fetchSnapshot = vi.fn(async () => ({ projects: null }))
    await expect(createDispatch(d)('projects.list')).resolves.toEqual([])
  })
})

describe('skills.search', () => {
  it('uses a bounded, read-only catalog query and rejects extra payload fields', async () => {
    const d = deps()
    const candidate = {
      id: 'owner/repo@skill',
      source: 'owner/repo',
      skill: 'skill',
      url: 'https://skills.sh/owner/repo/skill',
      installs: '10'
    }
    d.searchSkills = vi.fn(async () => [candidate])
    const invoke = createDispatch(d)
    await expect(invoke('skills.search', { query: '  react  ' })).resolves.toEqual([candidate])
    expect(d.searchSkills).toHaveBeenCalledWith('react')
    await expect(invoke('skills.search', { query: 'react', shell: true })).rejects.toThrow(
      'Malformed catalog query'
    )
    await expect(invoke('skills.search', { query: 'x' })).rejects.toThrow('Malformed catalog query')
    expect(d.searchSkills).toHaveBeenCalledTimes(1)
  })
})

describe('prompt gateway IPC', () => {
  const clean = {
    provider: 'codex',
    model: 'gpt-5.6-sol',
    threadId: 't1',
    text: 'hello Zero'
  }
  it('dispatches only through the gateway and rejects malformed or extra fields', async () => {
    const d = deps()
    const providerDispatch = vi.fn(async () => ({ turnId: 'turn-1' }))
    d.providerDispatch = providerDispatch
    const invoke = createDispatch(d)
    await expect(invoke('prompt.submit', clean)).resolves.toEqual({
      state: 'accepted',
      turnId: 'turn-1'
    })
    expect(providerDispatch).toHaveBeenCalledOnce()
    await expect(invoke('prompt.submit', { ...clean, bypass: true })).rejects.toThrow(
      'Malformed prompt'
    )
    await expect(invoke('prompt.submit', { ...clean, text: 'x'.repeat(32_001) })).rejects.toThrow(
      'Malformed prompt'
    )
    await expect(invoke('prompt.submit', { ...clean, provider: 'other' })).rejects.toThrow(
      'Malformed prompt'
    )
    await expect(invoke('prompt.submit', { ...clean, provider: 'opencode' })).resolves.toEqual({
      state: 'accepted',
      turnId: 'turn-1'
    })
    expect(providerDispatch).toHaveBeenCalledTimes(2)
  })

  it('holds sensitive text until one exact-bound approval, and consumes the hold', async () => {
    const d = deps()
    const providerDispatch = vi.fn(async () => ({ turnId: 'turn-2' }))
    d.providerDispatch = providerDispatch
    const invoke = createDispatch(d)
    const sensitive = { ...clean, text: 'password = synthetic-secret-123' }
    const held = (await invoke('prompt.submit', sensitive)) as { state: string; holdId: string }
    expect(held.state).toBe('held')
    expect(providerDispatch).not.toHaveBeenCalled()
    await expect(
      invoke('prompt.decide', { ...sensitive, holdId: held.holdId, action: 'send-once' })
    ).resolves.toEqual({ state: 'accepted', turnId: 'turn-2' })
    await expect(
      invoke('prompt.decide', { ...sensitive, holdId: held.holdId, action: 'send-once' })
    ).resolves.toMatchObject({ state: 'blocked' })
    expect(providerDispatch).toHaveBeenCalledOnce()
  })
})

describe('conversation.new', () => {
  it('starts a Codex thread in the explicitly selected absolute cwd', async () => {
    const codex = fakeBridge('live')
    codex.send = vi.fn(async () => ({ thread: { id: 'new-codex' } }))
    const invoke = createDispatch(deps(), () => fakePair(codex, fakeBridge('disconnected')))
    await expect(
      invoke('conversation.new', {
        provider: 'codex',
        cwd: '/repo/one',
        model: 'gpt-5.6-sol'
      })
    ).resolves.toEqual({ provider: 'codex', threadId: 'new-codex' })
    expect(codex.send).toHaveBeenCalledWith(
      'thread/start',
      expect.objectContaining({
        cwd: '/repo/one',
        model: 'gpt-5.6-sol',
        approvalPolicy: 'on-request'
      })
    )
  })

  it('starts an OpenCode ACP session without sending a prompt', async () => {
    const ocp = fakeBridge('live')
    ocp.send = vi.fn(async () => ({ sessionId: 'new-ocp' }))
    const invoke = createDispatch(deps(), () => fakePair(fakeBridge('disconnected'), ocp))
    await expect(
      invoke('conversation.new', {
        provider: 'opencode',
        cwd: '/repo/two',
        model: 'anthropic/claude-sonnet'
      })
    ).resolves.toEqual({ provider: 'opencode', threadId: 'new-ocp' })
    expect(ocp.send).toHaveBeenCalledWith('session/new', { cwd: '/repo/two', mcpServers: [] })
    expect(ocp.send).not.toHaveBeenCalledWith('session/prompt', expect.anything())
  })
})

describe('provider.permission.decide', () => {
  it('maps an explicit OpenCode allow-once decision to its ACP request response', async () => {
    const ocp = fakeBridge('live')
    const invoke = createDispatch(deps(), () => fakePair(fakeBridge('disconnected'), ocp))
    await expect(
      invoke('provider.permission.decide', {
        provider: 'opencode',
        requestId: 42,
        action: 'allow-once',
        optionId: 'allow-tool'
      })
    ).resolves.toEqual({ accepted: true })
    expect(ocp.respond).toHaveBeenCalledWith(42, {
      outcome: { outcome: 'selected', optionId: 'allow-tool' }
    })
  })

  it('maps a Codex rejection without allowing arbitrary response payloads', async () => {
    const codex = fakeBridge('live')
    const invoke = createDispatch(deps(), () => fakePair(codex, fakeBridge('disconnected')))
    await expect(
      invoke('provider.permission.decide', {
        provider: 'codex',
        requestId: 'approval-1',
        action: 'reject'
      })
    ).resolves.toEqual({ accepted: true })
    expect(codex.respond).toHaveBeenCalledWith('approval-1', { decision: 'decline' })
    await expect(
      invoke('provider.permission.decide', {
        provider: 'codex',
        requestId: 'approval-2',
        action: 'allow-once',
        raw: { decision: 'acceptForSession' }
      })
    ).rejects.toThrow('Malformed permission decision')
  })
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

  it('answers opencode discovery from the local session store while disconnected', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-ipc-ocp-'))
    const dbPath = path.join(dir, 'opencode.db')
    const { DatabaseSync } = await import('node:sqlite')
    const setup = new DatabaseSync(dbPath)
    setup.exec(
      'CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, directory TEXT NOT NULL, title TEXT NOT NULL, agent TEXT, model TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL)'
    )
    const insert = setup.prepare(
      'INSERT INTO session (id, project_id, directory, title, agent, model, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    insert.run(
      's-new',
      'p1',
      '/repo/alpha',
      'New session',
      'build',
      JSON.stringify({ id: 'muse-spark-1.3' }),
      200,
      300
    )
    insert.run('s-beta', 'p1', '/repo/beta', 'Beta session', null, null, 150, 200)
    setup.close()
    const d = deps()
    d.openCodeDbPath = dbPath
    const ocp = fakeBridge('disconnected')
    const invoke = createDispatch(d, () => fakePair(fakeBridge('disconnected'), ocp))
    const result = (await invoke('ocp.discover')) as {
      harness: HarnessId
      models: unknown[]
      threads: unknown[]
      folders: Array<{
        folder: string
        path: string
        count: number
        sessions: Array<{ id: string; title: string; model: string | null; updatedAt: number }>
      }>
      note: string | null
    }
    expect(result.harness).toBe('opencode')
    expect(result.models).toEqual([])
    expect(result.threads).toEqual([])
    expect(result.folders.map((f) => f.path)).toEqual(['/repo/alpha', '/repo/beta'])
    expect(result.folders[0]).toMatchObject({
      folder: 'alpha',
      count: 1,
      sessions: [{ id: 's-new', title: 'New session', model: 'muse-spark-1.3', updatedAt: 300 }]
    })
    expect(result.note).toBeNull()
    expect(ocp.sends).toEqual([])
  })

  it('fails opencode discovery soft to honest empty when the store is missing', async () => {
    const d = deps()
    d.openCodeDbPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'zero-ipc-ocp-miss-')),
      'opencode.db'
    )
    const ocp = fakeBridge('disconnected')
    const invoke = createDispatch(d, () => fakePair(fakeBridge('disconnected'), ocp))
    const result = (await invoke('ocp.discover')) as {
      harness: HarnessId
      folders: unknown[]
      note: string | null
    }
    expect(result.harness).toBe('opencode')
    expect(result.folders).toEqual([])
    expect(result.note).toContain('No OpenCode sessions found')
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

describe('thread read ops', () => {
  it('opens only a discovered OpenCode session from the bounded local store', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-ocp-export-'))
    const dbPath = path.join(dir, 'opencode.db')
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT NOT NULL, title TEXT, agent TEXT, model TEXT, time_created INTEGER, time_updated INTEGER);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER, time_updated INTEGER, data TEXT NOT NULL);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER, time_updated INTEGER, data TEXT NOT NULL);
    `)
    db.prepare('INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      's-existing',
      '/repo',
      'Existing',
      null,
      null,
      1,
      2
    )
    db.prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?)').run(
      'm1',
      's-existing',
      1,
      1,
      JSON.stringify({ role: 'user' })
    )
    db.prepare('INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)').run(
      'p1',
      'm1',
      's-existing',
      1,
      1,
      JSON.stringify({ type: 'text', text: 'hello' })
    )
    db.close()
    const d = deps()
    d.openCodeDbPath = dbPath
    const invoke = createDispatch(d)
    await expect(invoke('ocp.thread.get', { threadId: 's-existing' })).resolves.toMatchObject({
      harness: 'opencode',
      session: {
        info: { id: 's-existing', directory: '/repo' },
        messages: [{ parts: [{ text: 'hello' }] }]
      }
    })
    await expect(invoke('ocp.thread.get', { threadId: 'unknown' })).rejects.toThrow(/not found/i)
  })
  it('codex.threads lists threads via a bounded read-only thread/list probe', async () => {
    const codex = fakeBridge('live')
    const invoke = createDispatch(deps(), () => fakePair(codex, fakeBridge('disconnected')))
    await expect(invoke('codex.threads')).resolves.toEqual({
      harness: 'codex',
      threads: [{ id: 't1', name: 'Thread one' }]
    })
    expect(codex.sends).toEqual([{ method: 'thread/list', params: { limit: 100 } }])
  })

  it('prepares a live OpenCode session and returns only its advertised models', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-ocp-prepare-'))
    const dbPath = path.join(dir, 'opencode.db')
    const db = new DatabaseSync(dbPath)
    db.exec(
      'CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT NOT NULL, title TEXT, agent TEXT, model TEXT, time_created INTEGER, time_updated INTEGER)'
    )
    db.prepare('INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      's1',
      '/repo',
      'Existing',
      null,
      null,
      1,
      2
    )
    db.close()
    const d = deps()
    d.openCodeDbPath = dbPath
    const ocp = fakeBridge('live')
    ocp.send = vi.fn(async () => ({
      sessionId: 's1',
      configOptions: [
        {
          id: 'model',
          currentValue: 'openai/gpt-5',
          options: [
            { value: 'openai/gpt-5', name: 'GPT-5' },
            { value: 'anthropic/claude-sonnet', name: 'Claude Sonnet' }
          ]
        }
      ]
    }))
    const invoke = createDispatch(d, () => fakePair(fakeBridge('disconnected'), ocp))
    await expect(invoke('ocp.thread.prepare', { threadId: 's1' })).resolves.toEqual({
      sessionId: 's1',
      cwd: '/repo',
      currentModel: 'openai/gpt-5',
      models: [
        { id: 'openai/gpt-5', name: 'GPT-5' },
        { id: 'anthropic/claude-sonnet', name: 'Claude Sonnet' }
      ]
    })
    expect(ocp.send).toHaveBeenCalledWith('session/load', {
      sessionId: 's1',
      cwd: '/repo',
      mcpServers: []
    })
  })

  it('codex.threads rejects while not connected and sends nothing', async () => {
    const codex = fakeBridge('disconnected')
    const invoke = createDispatch(deps(), () => fakePair(codex, fakeBridge('disconnected')))
    await expect(invoke('codex.threads')).rejects.toThrow('not connected')
    expect(codex.sends).toEqual([])
  })

  it('codex.thread.get reads one transcript via thread/read with full turns', async () => {
    const codex = fakeBridge('live')
    const thread = {
      id: 't1',
      preview: 'hello',
      createdAt: 42,
      turns: [
        {
          id: 'turn1',
          items: [{ id: 'i1', type: 'agentMessage', text: 'hi' }],
          status: 'completed'
        }
      ]
    }
    const send = codex.send.bind(codex)
    codex.send = (method, params) => {
      codex.sends.push({ method, params: params ?? {} })
      return method === 'thread/read' ? Promise.resolve({ thread }) : send(method, params)
    }
    const invoke = createDispatch(deps(), () => fakePair(codex, fakeBridge('disconnected')))
    await expect(invoke('codex.thread.get', { threadId: 't1' })).resolves.toEqual({
      harness: 'codex',
      thread
    })
    expect(codex.sends).toEqual([
      { method: 'thread/read', params: { threadId: 't1', includeTurns: true } }
    ])
  })

  it('codex.thread.get bounds a large saved transcript to its latest 400 items', async () => {
    const codex = fakeBridge('live')
    const turns = Array.from({ length: 450 }, (_, index) => ({
      id: `turn-${index}`,
      items: [{ id: `item-${index}`, type: 'agentMessage', text: `message ${index}` }],
      status: 'completed'
    }))
    codex.send = vi.fn(async () => ({ thread: { id: 'large', turns } }))
    const invoke = createDispatch(deps(), () => fakePair(codex, fakeBridge('disconnected')))
    const result = (await invoke('codex.thread.get', { threadId: 'large' })) as {
      thread: { turns: Array<{ id: string }> }
    }
    expect(result.thread.turns).toHaveLength(400)
    expect(result.thread.turns[0]?.id).toBe('turn-50')
    expect(result.thread.turns.at(-1)?.id).toBe('turn-449')
  })

  it('codex.thread.get rejects a malformed or empty threadId', async () => {
    const codex = fakeBridge('live')
    const invoke = createDispatch(deps(), () => fakePair(codex, fakeBridge('disconnected')))
    await expect(invoke('codex.thread.get', undefined)).rejects.toThrow('Malformed thread payload')
    await expect(invoke('codex.thread.get', { threadId: '' })).rejects.toThrow(
      'Malformed thread payload'
    )
    expect(codex.sends).toEqual([])
  })

  it('codex.thread.get rejects while not connected and sends nothing', async () => {
    const codex = fakeBridge('disconnected')
    const invoke = createDispatch(deps(), () => fakePair(codex, fakeBridge('disconnected')))
    await expect(invoke('codex.thread.get', { threadId: 't1' })).rejects.toThrow('not connected')
    expect(codex.sends).toEqual([])
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
      sampleTelemetry: vi.fn(() => Promise.resolve(TELEMETRY_SAMPLE)),
      listDevices: vi.fn(() => Promise.resolve({ devices: [], note: null })),
      discoverSkills: vi.fn(() =>
        Promise.resolve({ ok: true, groups: [], selfLearnt: [], note: null })
      )
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

describe('devices.list', () => {
  it('answers with the injected lister payload without daemon contact', async () => {
    const d = deps()
    const payload: DevicesListResult = {
      devices: [
        {
          id: 'usb-1-2-3',
          name: 'Gaming Keyboard',
          transport: 'usb',
          kind: 'keyboard',
          vendor: 'BY Tech'
        }
      ],
      note: null
    }
    d.listDevices = vi.fn(() => Promise.resolve(payload))
    const invoke = createDispatch(d, () => fakePair(fakeBridge('live'), fakeBridge('live')))
    await expect(invoke('devices.list')).resolves.toBe(payload)
    expect(d.listDevices).toHaveBeenCalledWith(false)
    expect(d.fetchSnapshot).not.toHaveBeenCalled()
  })

  it('passes an explicit Bluetooth refresh through, defaults to cached', async () => {
    const d = deps()
    d.listDevices = vi.fn(() => Promise.resolve({ devices: [], note: null }))
    const invoke = createDispatch(d, () => fakePair(fakeBridge('live'), fakeBridge('live')))
    await invoke('devices.list', { refreshBt: true })
    await invoke('devices.list', {})
    await invoke('devices.list', { refreshBt: 'yes' })
    expect(d.listDevices).toHaveBeenNthCalledWith(1, true)
    expect(d.listDevices).toHaveBeenNthCalledWith(2, false)
    expect(d.listDevices).toHaveBeenNthCalledWith(3, false)
  })
})

const ARTWORK_BYTES = Buffer.alloc(2048)
ARTWORK_BYTES[0] = 0xff
ARTWORK_BYTES[1] = 0xff

describe('artwork.fetch', () => {
  it('fetches the daemon asset route and converts RGB565 to a PNG data URL', async () => {
    const d = deps()
    d.fetchSnapshot = vi.fn(() =>
      Promise.resolve({
        version: '0.2',
        id: 'a'.repeat(64),
        artwork: { rgb565: ARTWORK_BYTES.toString('base64') }
      })
    )
    const invoke = createDispatch(d, () => fakePair(fakeBridge('live'), fakeBridge('live')))
    const result = (await invoke('artwork.fetch', { id: 'a'.repeat(64) })) as {
      dataUrl: string | null
    }
    expect(d.fetchSnapshot).toHaveBeenCalledWith('/tmp/no-such-test.sock', {
      path: '/v0.1/artwork/' + 'a'.repeat(64)
    })
    expect(result.dataUrl?.startsWith('data:image/png;base64,iVBOR')).toBe(true)
  })

  it('fails soft to a null data URL when the daemon rejects the digest', async () => {
    const d = deps()
    d.fetchSnapshot = vi.fn(() => Promise.reject(new Error('Cockpit snapshot rejected (400)')))
    const invoke = createDispatch(d, () => fakePair(fakeBridge('live'), fakeBridge('live')))
    await expect(invoke('artwork.fetch', { id: 'a'.repeat(64) })).resolves.toEqual({
      dataUrl: null
    })
  })

  it('returns a null data URL when the asset lacks valid RGB565 bytes', async () => {
    const d = deps()
    d.fetchSnapshot = vi.fn(() => Promise.resolve({ version: '0.2', artwork: { rgb565: 'AAAA' } }))
    const invoke = createDispatch(d, () => fakePair(fakeBridge('live'), fakeBridge('live')))
    await expect(invoke('artwork.fetch', { id: 'a'.repeat(64) })).resolves.toEqual({
      dataUrl: null
    })
  })

  it('rejects malformed ids without contacting the daemon', async () => {
    const d = deps()
    const invoke = createDispatch(d, () => fakePair(fakeBridge('live'), fakeBridge('live')))
    await expect(invoke('artwork.fetch', { id: 'not hex!' })).rejects.toThrow(
      'Malformed artwork payload'
    )
    await expect(invoke('artwork.fetch', {})).rejects.toThrow('Malformed artwork payload')
    expect(d.fetchSnapshot).not.toHaveBeenCalled()
  })
})

describe('skills.discover', () => {
  const payload = {
    ok: true,
    groups: [
      {
        id: 'gstack',
        name: 'Gstack',
        color: '#10B981',
        glyph: 'flask' as const,
        skills: [{ id: 'browse', name: 'Browse', source: 'installed' as const, pluginId: 'gstack' }]
      }
    ],
    selfLearnt: [],
    note: null
  }
  const withDiscoverer = (
    discoverSkills: (refresh: boolean) => Promise<typeof payload>
  ): SocketDeps => {
    const d = deps()
    d.discoverSkills = discoverSkills
    return d
  }
  it('answers with the injected discoverer payload without daemon contact', async () => {
    const discoverSkills = vi.fn(() => Promise.resolve(payload))
    const d = withDiscoverer(discoverSkills)
    const invoke = createDispatch(d, () => fakePair(fakeBridge('live'), fakeBridge('live')))
    await expect(invoke('skills.discover')).resolves.toBe(payload)
    expect(discoverSkills).toHaveBeenCalledWith(false)
    expect(d.fetchSnapshot).not.toHaveBeenCalled()
  })
  it('passes an explicit refresh through, defaults to cached', async () => {
    const discoverSkills = vi.fn(() => Promise.resolve(payload))
    const invoke = createDispatch(withDiscoverer(discoverSkills), () =>
      fakePair(fakeBridge('live'), fakeBridge('live'))
    )
    await invoke('skills.discover', { refresh: true })
    await invoke('skills.discover', {})
    await invoke('skills.discover', { refresh: 'yes' })
    expect(discoverSkills).toHaveBeenNthCalledWith(1, true)
    expect(discoverSkills).toHaveBeenNthCalledWith(2, false)
    expect(discoverSkills).toHaveBeenNthCalledWith(3, false)
  })
  it('fail-softs to honest empty when the discoverer rejects, never throws', async () => {
    const invoke = createDispatch(
      withDiscoverer(() => Promise.reject(new Error('disk gone'))),
      () => fakePair(fakeBridge('live'), fakeBridge('live'))
    )
    const result = (await invoke('skills.discover')) as {
      ok: boolean
      groups: unknown[]
      selfLearnt: unknown[]
      note: unknown
    }
    expect(result.ok).toBe(false)
    expect(result.groups).toEqual([])
    expect(result.selfLearnt).toEqual([])
    expect(typeof result.note).toBe('string')
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
