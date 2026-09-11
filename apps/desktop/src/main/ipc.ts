import { ipcMain, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  validateOp,
  type ArtworkPayload,
  type CommandPayload,
  type ProjectPayload,
  type TelemetrySample,
  type ThreadGetPayload
} from '../shared/ipc'
import { applyPrefsPatch, type Prefs } from './prefs'
import { createBridgePair, type BridgeDeps, type HarnessId, type RpcEvent } from './bridges'
import { defaultOpenCodeDbPath, readOpenCodeSessionStore } from './opencode-sessions'
import { artworkDataUrl } from './artwork-image'
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
  ipcMain.handle('zero:invoke', (_event, op: unknown, payload: unknown) =>
    dispatch(op, payload, deps)
  )
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

export function createDispatch(
  deps: SocketDeps,
  getBridgePair: () => BridgeDeps = getBridges
): (op: unknown, payload?: unknown) => Promise<unknown> {
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
      case 'telemetry.sample':
        return deps.sampleTelemetry()
      case 'artwork.fetch':
        return artworkFetch(payload)
    }
  }
}

async function dispatch(op: unknown, payload: unknown, deps: SocketDeps): Promise<unknown> {
  return createDispatch(deps)(op, payload)
}
