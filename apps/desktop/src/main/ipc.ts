import { ipcMain, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  validateOp,
  type CommandPayload,
  type ProjectPayload,
  type TelemetrySample
} from '../shared/ipc'
import { applyPrefsPatch, type Prefs } from './prefs'
import { createBridgePair, type BridgeDeps, type HarnessId, type RpcEvent } from './bridges'
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

const OPENCODE_DISCOVERY_NOTE =
  'OpenCode ACP advertises no read-only discovery method in this build; sessions surface from streamed bridge events.'

export function createDispatch(
  deps: SocketDeps,
  getBridgePair: () => BridgeDeps = getBridges
): (op: unknown, payload?: unknown) => Promise<unknown> {
  const bridgeState = async (harness: 'codex' | 'ocp'): Promise<unknown> => {
    const bridge = getBridgePair()[harness]
    return { state: bridge.state, lastDiagnostic: bridge.lastDiagnostic }
  }
  const discover = async (harness: 'codex' | 'ocp'): Promise<unknown> => {
    const bridge = getBridgePair()[harness]
    if (bridge.state !== 'live') throw new Error('not connected')
    if (harness === 'codex') {
      const models = await bridge.send('model/list', { limit: 100 })
      const threads = await bridge.send('thread/list', { limit: 100 })
      return { harness: 'codex', models: listOf(models), threads: listOf(threads) }
    }
    return { harness: 'opencode', models: [], threads: [], note: OPENCODE_DISCOVERY_NOTE }
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
    }
  }
}

async function dispatch(op: unknown, payload: unknown, deps: SocketDeps): Promise<unknown> {
  return createDispatch(deps)(op, payload)
}
