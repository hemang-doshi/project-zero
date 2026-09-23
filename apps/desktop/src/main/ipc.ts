import { ipcMain, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import {
  validateOp,
  type ArtworkPayload,
  type CommandPayload,
  type ConversationNewPayload,
  type DevicesListPayload,
  type DevicesListResult,
  type ProjectPayload,
  type ProviderPermissionPayload,
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
import {
  defaultOpenCodeDbPath,
  readOpenCodeSession,
  readOpenCodeSessionStore
} from './opencode-sessions'
import { artworkDataUrl } from './artwork-image'
import { searchSkillsCatalog, type CatalogSkill } from './skills-catalog'
import { PromptGateway, type PromptRequest } from './prompt-gateway'
import { dispatchProviderPrompt, ProviderDispatchError } from './provider-dispatch'
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
  providerDispatch?: (request: PromptRequest) => Promise<{ turnId: string; threadId?: string }>
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

function boundCodexThread(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const thread = value as Record<string, unknown>
  if (!Array.isArray(thread['turns'])) return thread
  const turns: unknown[] = []
  let itemBudget = 400
  let turnBudget = 400
  for (let index = thread['turns'].length - 1; index >= 0 && turnBudget > 0; index -= 1) {
    const rawTurn = thread['turns'][index]
    if (typeof rawTurn !== 'object' || rawTurn === null || Array.isArray(rawTurn)) continue
    const turn = rawTurn as Record<string, unknown>
    const rawItems = Array.isArray(turn['items']) ? turn['items'] : []
    if (rawItems.length > 0 && itemBudget === 0) break
    const items = rawItems.slice(Math.max(0, rawItems.length - itemBudget))
    itemBudget -= items.length
    turnBudget -= 1
    turns.unshift({ ...turn, items })
  }
  return { ...thread, turns }
}

function promptRequest(
  value: unknown,
  decision = false
): PromptRequest & Partial<PromptDecidePayload> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Malformed prompt')
  const row = value as Record<string, unknown>
  const draft = Object.hasOwn(row, 'draftId')
  const required = decision
    ? draft
      ? ['provider', 'model', 'cwd', 'draftId', 'text', 'holdId', 'action']
      : ['provider', 'model', 'threadId', 'text', 'holdId', 'action']
    : draft
      ? ['provider', 'model', 'cwd', 'draftId', 'text']
      : ['provider', 'model', 'threadId', 'text']
  if (
    Object.keys(row).length !== required.length ||
    required.some((key) => !Object.hasOwn(row, key))
  )
    throw new Error('Malformed prompt')
  if (
    (row.provider !== 'codex' && row.provider !== 'opencode') ||
    typeof row.model !== 'string' ||
    row.model.length < 1 ||
    row.model.length > 120 ||
    (draft
      ? typeof row.cwd !== 'string' ||
        !isAbsolute(row.cwd) ||
        row.cwd.length > 4096 ||
        typeof row.draftId !== 'string' ||
        !/^[A-Za-z0-9_-]{1,120}$/.test(row.draftId)
      : typeof row.threadId !== 'string' || row.threadId.length < 1 || row.threadId.length > 120) ||
    typeof row.text !== 'string' ||
    !row.text.trim() ||
    Buffer.byteLength(row.text, 'utf8') > 32_000 ||
    (decision &&
      (typeof row.holdId !== 'string' ||
        !/^[0-9a-f-]{36}$/i.test(row.holdId) ||
        (row.action !== 'cancel' && row.action !== 'send-once')))
  )
    throw new Error('Malformed prompt')
  return row as PromptSubmitPayload & Partial<PromptDecidePayload>
}

export function createDispatch(
  deps: SocketDeps,
  getBridgePair: () => BridgeDeps = getBridges
): (op: unknown, payload?: unknown) => Promise<unknown> {
  const createdOpenCodeSessions = new Map<string, string>()
  const draftBindings = new Map<
    string,
    { provider: 'codex' | 'opencode'; cwd: string; threadId: string }
  >()
  const dispatch = async (
    request: PromptRequest
  ): Promise<{ turnId: string; threadId?: string }> => {
    if (deps.providerDispatch) return deps.providerDispatch(request)
    let threadId = request.threadId
    if (!threadId) {
      if (!request.cwd || !request.draftId) throw new Error('Malformed draft')
      const cwd = realpathSync(request.cwd)
      const bound = draftBindings.get(request.draftId)
      if (bound) {
        if (bound.provider !== request.provider || bound.cwd !== cwd)
          throw new Error('Draft binding changed')
        threadId = bound.threadId
      } else {
        const created = (await newConversation({
          provider: request.provider,
          cwd,
          model: request.model
        })) as { threadId: string }
        threadId = created.threadId
        draftBindings.set(request.draftId, { provider: request.provider, cwd, threadId })
        if (request.provider === 'opencode') createdOpenCodeSessions.set(threadId, cwd)
      }
    }
    try {
      const result = await dispatchProviderPrompt(
        { ...request, threadId },
        {
          codex: getBridgePair().codex,
          opencode: getBridgePair().ocp,
          openCodeSession: (id) => {
            const createdCwd = createdOpenCodeSessions.get(id)
            if (createdCwd) return { id, directory: createdCwd }
            const store = readOpenCodeSessionStore(deps.openCodeDbPath ?? defaultOpenCodeDbPath())
            const session = store.groups
              .flatMap((group) => group.sessions)
              .find((row) => row.id === id)
            return session ? { id: session.id, directory: session.directory } : null
          },
          onDiagnostic: (entry) => console.warn('Zero provider dispatch failed', entry)
        }
      )
      return request.draftId ? { ...result, threadId } : result
    } catch (error) {
      if (request.draftId)
        throw new ProviderDispatchError(
          error instanceof ProviderDispatchError ? error.reason : 'dispatch-unavailable',
          threadId
        )
      throw error
    }
  }
  const gateway = new PromptGateway(dispatch)
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
    return { harness: 'codex', thread: boundCodexThread(root['thread']) }
  }
  const prepareOpenCode = async (payload: unknown): Promise<unknown> => {
    const { threadId } = (payload ?? {}) as Partial<ThreadGetPayload>
    if (typeof threadId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(threadId))
      throw new Error('Malformed OpenCode session id')
    const bridge = getBridgePair().ocp
    if (bridge.state !== 'live') throw new Error('not connected')
    const store = readOpenCodeSessionStore(deps.openCodeDbPath ?? defaultOpenCodeDbPath())
    const session = store.groups
      .flatMap((group) => group.sessions)
      .find((row) => row.id === threadId)
    if (!session) throw new Error('OpenCode session not found')
    const result = await bridge.send('session/load', {
      sessionId: threadId,
      cwd: session.directory,
      mcpServers: []
    })
    const root =
      typeof result === 'object' && result !== null ? (result as Record<string, unknown>) : {}
    const configs = Array.isArray(root['configOptions']) ? root['configOptions'] : []
    const model = configs.find(
      (value) =>
        typeof value === 'object' &&
        value !== null &&
        (value as Record<string, unknown>)['id'] === 'model'
    ) as Record<string, unknown> | undefined
    const options = Array.isArray(model?.['options']) ? model.options : []
    const models = options.flatMap((value) => {
      if (typeof value !== 'object' || value === null) return []
      const row = value as Record<string, unknown>
      if (typeof row['value'] !== 'string' || row['value'] === '') return []
      return [
        { id: row['value'], name: typeof row['name'] === 'string' ? row['name'] : row['value'] }
      ]
    })
    return {
      sessionId: threadId,
      cwd: session.directory,
      currentModel: typeof model?.['currentValue'] === 'string' ? model.currentValue : null,
      models
    }
  }
  const newConversation = async (payload: unknown): Promise<unknown> => {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload))
      throw new Error('Malformed conversation request')
    const { provider, cwd, model } = payload as Partial<ConversationNewPayload>
    if (
      (provider !== 'codex' && provider !== 'opencode') ||
      typeof cwd !== 'string' ||
      !isAbsolute(cwd) ||
      typeof model !== 'string' ||
      model === '' ||
      model.length > 120
    )
      throw new Error('Malformed conversation request')
    const bridge = provider === 'codex' ? getBridgePair().codex : getBridgePair().ocp
    if (bridge.state !== 'live') throw new Error('not connected')
    if (provider === 'codex') {
      const result = await bridge.send('thread/start', {
        cwd,
        model,
        approvalPolicy: 'on-request',
        sandbox: 'workspace-write'
      })
      const root =
        typeof result === 'object' && result !== null ? (result as Record<string, unknown>) : {}
      const thread =
        typeof root['thread'] === 'object' && root['thread'] !== null
          ? (root['thread'] as Record<string, unknown>)
          : {}
      if (typeof thread['id'] !== 'string' || thread['id'] === '')
        throw new Error('Malformed thread creation')
      return { provider, threadId: thread['id'] }
    }
    const result = await bridge.send('session/new', { cwd, mcpServers: [] })
    const root =
      typeof result === 'object' && result !== null ? (result as Record<string, unknown>) : {}
    if (typeof root['sessionId'] !== 'string' || root['sessionId'] === '')
      throw new Error('Malformed session creation')
    return { provider, threadId: root['sessionId'] }
  }
  const decideProviderPermission = (payload: unknown): { accepted: true } => {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload))
      throw new Error('Malformed permission decision')
    const row = payload as Record<string, unknown>
    const { provider, requestId, action, optionId } = row as Partial<ProviderPermissionPayload>
    const expectedKeys =
      action === 'allow-once' && provider === 'opencode'
        ? ['provider', 'requestId', 'action', 'optionId']
        : ['provider', 'requestId', 'action']
    if (
      Object.keys(row).length !== expectedKeys.length ||
      expectedKeys.some((key) => !Object.hasOwn(row, key)) ||
      (provider !== 'codex' && provider !== 'opencode') ||
      (typeof requestId !== 'string' && typeof requestId !== 'number') ||
      requestId === '' ||
      (action !== 'allow-once' && action !== 'reject') ||
      (provider === 'opencode' &&
        action === 'allow-once' &&
        (typeof optionId !== 'string' || optionId === ''))
    )
      throw new Error('Malformed permission decision')
    const bridge = provider === 'codex' ? getBridgePair().codex : getBridgePair().ocp
    if (bridge.state !== 'live') throw new Error('not connected')
    if (provider === 'opencode') {
      bridge.respond(
        requestId,
        action === 'allow-once'
          ? { outcome: { outcome: 'selected', optionId } }
          : { outcome: { outcome: 'cancelled' } }
      )
    } else {
      bridge.respond(requestId, { decision: action === 'allow-once' ? 'accept' : 'decline' })
    }
    return { accepted: true }
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
      case 'conversation.new':
        return newConversation(payload)
      case 'provider.permission.decide':
        return decideProviderPermission(payload)
      case 'ocp.state':
        return bridgeState('ocp')
      case 'ocp.discover':
        return discover('ocp')
      case 'ocp.thread.get': {
        const { threadId } = (payload ?? {}) as Partial<ThreadGetPayload>
        if (typeof threadId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(threadId))
          throw new Error('Malformed OpenCode session id')
        const store = readOpenCodeSessionStore(deps.openCodeDbPath ?? defaultOpenCodeDbPath())
        if (
          !store.groups.some((group) => group.sessions.some((session) => session.id === threadId))
        )
          throw new Error('OpenCode session not found')
        const session = readOpenCodeSession(
          deps.openCodeDbPath ?? defaultOpenCodeDbPath(),
          threadId
        )
        return { harness: 'opencode', session }
      }
      case 'ocp.thread.prepare':
        return prepareOpenCode(payload)
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
