import { ipcMain, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  validateOp,
  type ArtworkPayload,
  type CommandPayload,
  type DevicesListPayload,
  type DevicesListResult,
  type ProjectPayload,
  type ProjectListItem,
  type PromptSubmitPayload,
  type PromptDecidePayload,
  type SkillsDiscoverPayload,
  type SkillsDiscoverResult,
  type TelemetrySample,
  type ThreadGetPayload
} from '../shared/ipc'
import { applyPrefsPatch, type Prefs } from './prefs'
import { createBridgePair, type BridgeDeps, type HarnessId, type RpcEvent } from './bridges'
import { defaultOpenCodeDbPath, readOpenCodeSessionStore } from './opencode-sessions'
import { artworkDataUrl } from './artwork-image'
import { searchSkillsCatalog, type CatalogSkill } from './skills-catalog'
import { PromptGateway, type PromptRequest } from './prompt-gateway'
import { dispatchProviderPrompt } from './provider-dispatch'
import type { CockpitModel, ModelUpdate } from './cockpit-model'

export type PrefsStoreLike = {
  load(): Prefs
  save(prefs: Prefs): void
}

export type SocketDeps = {
  socketPath: string
  fetchSnapshot: (socketPath: string, opts?: { path?: string }) => Promise<unknown>
  postCommand: (socketPath: string, body: unknown) => Promise<unknown>
  store: PrefsStoreLike
  pickImage: () => Promise<string | null>
  sampleTelemetry: () => Promise<TelemetrySample>
  listDevices: (refreshBt: boolean) => Promise<DevicesListResult>
  discoverSkills: (refresh: boolean) => Promise<SkillsDiscoverResult>
  searchSkills?: (query: string) => Promise<CatalogSkill[]>
  providerDispatch?: (request: PromptRequest) => Promise<{ turnId: string }>
  openCodeDbPath?: string
}

const prefsDir = join(process.env.HOME ?? '', 'Library', 'Application Support', 'ProjectZero')

let bridgesSingleton: BridgeDeps | null = null

function getBridges(): BridgeDeps {
  if (!bridgesSingleton) bridgesSingleton = createBridgePair({ prefsDir })
  return bridgesSingleton
}

export function bridgePair(): BridgeDeps {
  return getBridges()
}

export function registerIpcHandlers(deps: SocketDeps): void {
  const invoke = createDispatch(deps)
  ipcMain.handle('zero:invoke', (_event, op: unknown, payload: unknown) => invoke(op, payload))
}

export function attachCockpitPush(model: CockpitModel, win: BrowserWindow): void {
  model.subscribe((u: ModelUpdate) => {
    if (!win.isDestroyed()) win.webContents.send('zero:cockpit', u)
  })
}

export function attachBridgePush(bridges: BridgeDeps, win: BrowserWindow): () => void {
  const push = (harness: HarnessId) => (ev: RpcEvent) => {
    if (!win.isDestroyed()) win.webContents.send('zero:bridge', { harness, event: ev })
  }
  const unCodex = bridges.codex.onEvent(push('codex'))
  const unOcp = bridges.ocp.onEvent(push('opencode'))
  return () => {
    unCodex()
    unOcp()
  }
}

function projectPath(id: string): string {
  return `/v0.1/projects/${encodeURIComponent(id)}`
}

function projectList(value: unknown): ProjectListItem[] {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Malformed projects response')
  }
  const raw = (value as { projects?: unknown }).projects
  if (raw === null) return [] // Go encodes a nil slice as null for a valid empty registry.
  if (!Array.isArray(raw)) throw new Error('Malformed projects response')
  const projects = raw
  if (projects.length > 500) throw new Error('Projects response too large')
  return projects.flatMap((project) => {
    if (typeof project !== 'object' || project === null) throw new Error('Malformed project row')
    const row = project as Record<string, unknown>
    if (
      typeof row.id !== 'string' ||
      !row.id ||
      typeof row.name !== 'string' ||
      typeof row.path !== 'string'
    ) {
      throw new Error('Malformed project row')
    }
    return row.removed === true ? [] : [{ id: row.id, name: row.name, path: row.path }]
  })
}

function buildCommand(
  op: string,
  body?: Record<string, unknown>
): { id: string; op: string; body: Record<string, unknown> } {
  return { id: randomUUID(), op, body: body ?? {} }
}

function listOf(result: unknown): unknown[] {
  if (Array.isArray(result)) return result
  const data =
    typeof result === 'object' && result !== null
      ? (result as Record<string, unknown>)['data']
      : undefined
  return Array.isArray(data) ? data : []
}

function promptRequest(value: unknown, decision = false): PromptRequest & Partial<PromptDecidePayload> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Malformed prompt')
  const row = value as Record<string, unknown>
  const required = decision
    ? ['provider', 'model', 'threadId', 'text', 'holdId', 'action']
    : ['provider', 'model', 'threadId', 'text']
  if (Object.keys(row).length !== required.length || required.some((key) => !Object.hasOwn(row, key)))
    throw new Error('Malformed prompt')
  if (
    row.provider !== 'codex' ||
    typeof row.model !== 'string' || row.model.length < 1 || row.model.length > 120 ||
    typeof row.threadId !== 'string' || row.threadId.length < 1 || row.threadId.length > 120 ||
    typeof row.text !== 'string' || !row.text.trim() || Buffer.byteLength(row.text, 'utf8') > 32_000 ||
    (decision && (typeof row.holdId !== 'string' || !/^[0-9a-f-]{36}$/i.test(row.holdId) ||
      (row.action !== 'cancel' && row.action !== 'send-once')))
  ) throw new Error('Malformed prompt')
  return row as PromptSubmitPayload & Partial<PromptDecidePayload>
}

export function createDispatch(
  deps: SocketDeps,
  getBridgePair: () => BridgeDeps = getBridges
): (op: unknown, payload?: unknown) => Promise<unknown> {
  const gateway = new PromptGateway(
    deps.providerDispatch ?? ((request) => dispatchProviderPrompt(request, {
      codex: getBridgePair().codex,
      projects: async () => projectList(await deps.fetchSnapshot(deps.socketPath, { path: '/v0.1/projects' }))
    }))
  )
  const bridgeState = async (harness: 'codex' | 'ocp'): Promise<unknown> => {
    const bridge = getBridgePair()[harness]
    return { state: bridge.state, lastDiagnostic: bridge.lastDiagnostic }
  }
  const discover = async (harness: 'codex' | 'ocp'): Promise<unknown> => {
    if (harness === 'codex') {
      const bridge = getBridgePair().codex
      if (bridge.state !== 'live') throw new Error('not connected')
      const models = await bridge.send('model/list', { limit: 100 })
      const threads = await bridge.send('thread/list', { limit: 100 })
      return { harness: 'codex', models: listOf(models), threads: listOf(threads) }
    }
    // OpenCode sessions come from the on-disk session store, not the ACP wire
    // (which advertises no read-only list method): a local read-only scan, so
    // no bridge connection is required and nothing is ever sent or spawned.
    const store = readOpenCodeSessionStore(deps.openCodeDbPath ?? defaultOpenCodeDbPath())
    return {
      harness: 'opencode',
      models: [],
      threads: [],
      folders: store.groups,
      note: store.note
    }
  }
  const threads = async (): Promise<unknown> => {
    const bridge = getBridgePair().codex
    if (bridge.state !== 'live') throw new Error('not connected')
    const result = await bridge.send('thread/list', { limit: 100 })
    return { harness: 'codex', threads: listOf(result) }
  }
  const threadGet = async (payload: unknown): Promise<unknown> => {
    const { threadId } = (payload ?? {}) as Partial<ThreadGetPayload>
    if (typeof threadId !== 'string' || threadId === '') {
      throw new Error('Malformed thread payload')
    }
    const bridge = getBridgePair().codex
    if (bridge.state !== 'live') throw new Error('not connected')
    const result = await bridge.send('thread/read', { threadId, includeTurns: true })
    const root =
      typeof result === 'object' && result !== null ? (result as Record<string, unknown>) : {}
    return { harness: 'codex', thread: root['thread'] ?? null }
  }
  // The daemon caches artwork by content digest (entities kind='artwork'); the
  // cockpit display projection deliberately omits the blob, so this op reads
  // the evidence route and converts RGB565 to a PNG data URL. Any daemon error
  // or malformed asset fails soft to dataUrl null (honest no-cover render).
  const artworkFetch = async (payload: unknown): Promise<unknown> => {
    const { id } = (payload ?? {}) as Partial<ArtworkPayload>
    if (typeof id !== 'string' || !/^[0-9a-f]{8,64}$/i.test(id)) {
      throw new Error('Malformed artwork payload')
    }
    try {
      const asset = await deps.fetchSnapshot(deps.socketPath, { path: `/v0.1/artwork/${id}` })
      const root =
        typeof asset === 'object' && asset !== null ? (asset as Record<string, unknown>) : {}
      const artwork =
        typeof root['artwork'] === 'object' && root['artwork'] !== null
          ? (root['artwork'] as Record<string, unknown>)
          : {}
      const rgb565 = typeof artwork['rgb565'] === 'string' ? artwork['rgb565'] : null
      return { dataUrl: rgb565 !== null ? artworkDataUrl(rgb565) : null }
    } catch {
      return { dataUrl: null }
    }
  }
  return async (op: unknown, payload?: unknown): Promise<unknown> => {
    if (typeof op !== 'string' || !validateOp(op)) throw new Error('Unknown op')
    switch (op) {
      case 'prefs.get':
        return deps.store.load()
      case 'prefs.set': {
        const next = applyPrefsPatch(deps.store.load(), payload)
        deps.store.save(next)
        return next
      }
      case 'wallpaper.pick':
        return deps.pickImage()
      case 'codex.connect':
        return getBridgePair().codex.connect()
      case 'codex.disconnect':
        return getBridgePair().codex.disconnect()
      case 'codex.send':
        throw new Error('send blocked until runtime path ships')
      case 'codex.state':
        return bridgeState('codex')
      case 'codex.discover':
        return discover('codex')
      case 'codex.threads':
        return threads()
      case 'codex.thread.get':
        return threadGet(payload)
      case 'ocp.connect':
        return getBridgePair().ocp.connect()
      case 'ocp.disconnect':
        return getBridgePair().ocp.disconnect()
      case 'ocp.send':
        throw new Error('send blocked until runtime path ships')
      case 'prompt.submit':
        return gateway.submit(promptRequest(payload))
      case 'prompt.decide': {
        const request = promptRequest(payload, true)
        return gateway.decide(request.holdId!, request.action!, request)
      }
      case 'ocp.state':
        return bridgeState('ocp')
      case 'ocp.discover':
        return discover('ocp')
      case 'snapshot.fetch':
        return deps.fetchSnapshot(deps.socketPath)
      case 'command.send': {
        const { op: commandOp, body } = (payload ?? {}) as Partial<CommandPayload>
        if (typeof commandOp !== 'string') throw new Error('Malformed command payload')
        return deps.postCommand(deps.socketPath, buildCommand(commandOp, body))
      }
      case 'project.get': {
        const { id } = (payload ?? {}) as Partial<ProjectPayload>
        if (typeof id !== 'string') throw new Error('Malformed project payload')
        return deps.fetchSnapshot(deps.socketPath, { path: projectPath(id) })
      }
      case 'projects.list':
        return projectList(await deps.fetchSnapshot(deps.socketPath, { path: '/v0.1/projects' }))
      case 'telemetry.sample':
        return deps.sampleTelemetry()
      case 'devices.list': {
        const { refreshBt } = (payload ?? {}) as Partial<DevicesListPayload>
        return deps.listDevices(refreshBt === true)
      }
      case 'artwork.fetch':
        return artworkFetch(payload)
      case 'skills.discover': {
        // Live skill grid: a local filesystem scan, never the daemon. The
        // discoverer itself fail-softs, but the IPC boundary double-guards so
        // a throwing injection can never surface as an IPC rejection.
        const { refresh } = (payload ?? {}) as Partial<SkillsDiscoverPayload>
        try {
          return await deps.discoverSkills(refresh === true)
        } catch {
          return {
            ok: false,
            groups: [],
            selfLearnt: [],
            note: 'Skill discovery failed; the vial grid is honestly empty.'
          } satisfies SkillsDiscoverResult
        }
      }
      case 'skills.search': {
        if (
          typeof payload !== 'object' ||
          payload === null ||
          Array.isArray(payload) ||
          Object.keys(payload).length !== 1
        )
          throw new Error('Malformed catalog query')
        const query = (payload as { query?: unknown }).query
        if (typeof query !== 'string' || query.trim().length < 2 || query.length > 80) {
          throw new Error('Malformed catalog query')
        }
        return (deps.searchSkills ?? searchSkillsCatalog)(query.trim())
      }
    }
  }
}
