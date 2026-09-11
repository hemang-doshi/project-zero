import { ipcMain, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { validateOp, type CommandPayload, type ProjectPayload } from '../shared/ipc'
import type { CockpitModel, ModelUpdate } from './cockpit-model'

export type SocketDeps = {
  socketPath: string
  fetchSnapshot: (socketPath: string, opts?: { path?: string }) => Promise<unknown>
  postCommand: (socketPath: string, body: unknown) => Promise<unknown>
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
    case 'codex.connect':
    case 'codex.disconnect':
    case 'codex.send':
    case 'ocp.connect':
    case 'ocp.disconnect':
    case 'ocp.send':
    case 'wallpaper.pick':
      throw new Error('Not yet implemented')
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
