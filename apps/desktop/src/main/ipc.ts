import { ipcMain, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { validateOp, type CommandPayload, type ProjectPayload } from '../shared/ipc'
import { createBridgePair, type BridgeDeps } from './bridges'
import type { CockpitModel, ModelUpdate } from './cockpit-model'

export type SocketDeps = {
  socketPath: string
  fetchSnapshot: (socketPath: string, opts?: { path?: string }) => Promise<unknown>
  postCommand: (socketPath: string, body: unknown) => Promise<unknown>
}

const prefsDir = join(process.env.HOME ?? '', 'Library', 'Application Support', 'ProjectZero')

let bridgesSingleton: BridgeDeps | null = null

function getBridges(): BridgeDeps {
  if (!bridgesSingleton) bridgesSingleton = createBridgePair({ prefsDir })
  return bridgesSingleton
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

function projectPath(id: string): string {
  return `/v0.1/projects/${encodeURIComponent(id)}`
}

function buildCommand(
  op: string,
  body?: Record<string, unknown>
): { id: string; op: string; body: Record<string, unknown> } {
  return { id: randomUUID(), op, body: body ?? {} }
}

async function dispatch(op: unknown, payload: unknown, deps: SocketDeps): Promise<unknown> {
  if (typeof op !== 'string' || !validateOp(op)) throw new Error('Unknown op')
  switch (op) {
    case 'prefs.get':
    case 'prefs.set':
    case 'wallpaper.pick':
      throw new Error('Not yet implemented')
    case 'codex.connect':
      return getBridges().codex.connect()
    case 'codex.disconnect':
      return getBridges().codex.disconnect()
    case 'codex.send':
      throw new Error('send blocked until runtime path ships')
    case 'ocp.connect':
      return getBridges().ocp.connect()
    case 'ocp.disconnect':
      return getBridges().ocp.disconnect()
    case 'ocp.send':
      throw new Error('send blocked until runtime path ships')
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
  }
}
