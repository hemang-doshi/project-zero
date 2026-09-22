import { realpathSync } from 'node:fs'
import { isAbsolute, relative } from 'node:path'
import type { ProjectListItem } from '../shared/ipc'

export type ProviderRequest = {
  provider: 'codex' | 'opencode'
  model: string
  text: string
  threadId: string
}
type Bridge = { state: string; send: (method: string, params: unknown) => Promise<unknown> }
type Deps = {
  codex: Bridge
  projects: () => Promise<ProjectListItem[]>
  realpath?: (path: string) => string
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

export async function dispatchProviderPrompt(
  request: ProviderRequest,
  deps: Deps
): Promise<{ turnId: string }> {
  if (request.provider !== 'codex') throw new Error('Provider dispatch unavailable')
  if (deps.codex.state !== 'live') throw new Error('Provider disconnected')
  if (!request.threadId || !request.model || !request.text.trim())
    throw new Error('Invalid prompt destination')
  const projects = await deps.projects()
  const read = record(
    await deps.codex.send('thread/read', { threadId: request.threadId, includeTurns: false })
  )
  const thread = record(read?.thread)
  if (
    !thread ||
    thread.id !== request.threadId ||
    typeof thread.projectId !== 'string' ||
    typeof thread.cwd !== 'string'
  ) {
    throw new Error('Thread has no verified project binding')
  }
  const project = projects.find((item) => item.id === thread.projectId)
  if (!project || !isAbsolute(project.path) || !isAbsolute(thread.cwd))
    throw new Error('Project not registered')
  const resolve = deps.realpath ?? realpathSync
  const root = resolve(project.path)
  const cwd = resolve(thread.cwd)
  const inside = relative(root, cwd)
  if (inside === '..' || inside.startsWith('../') || isAbsolute(inside))
    throw new Error('Thread cwd outside registered project')
  if (deps.codex.state !== 'live') throw new Error('Provider disconnected')
  const response = record(
    await deps.codex.send('turn/start', {
      threadId: request.threadId,
      input: [{ type: 'text', text: request.text, text_elements: [] }],
      model: request.model,
      effort: 'medium'
    })
  )
  const turn = record(response?.turn)
  if (!turn || typeof turn.id !== 'string' || turn.id === '')
    throw new Error('Malformed turn acceptance')
  return { turnId: turn.id }
}
