import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { isAbsolute } from 'node:path'

export type ProviderRequest = {
  provider: 'codex' | 'opencode'
  model: string
  text: string
  threadId: string
}
type Bridge = { state: string; send: (method: string, params: unknown) => Promise<unknown> }
type Deps = {
  codex: Bridge
  opencode: Bridge
  openCodeSession: (id: string) => { id: string; directory: string } | null
  realpath?: (path: string) => string
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

function modelOption(value: unknown): Record<string, unknown> | null {
  const root = record(value)
  return root?.id === 'model' && Array.isArray(root.options) ? root : null
}

function optionValues(config: Record<string, unknown>): string[] {
  return (config.options as unknown[]).flatMap((item) => {
    const row = record(item)
    return typeof row?.value === 'string' ? [row.value] : []
  })
}

async function dispatchCodex(request: ProviderRequest, deps: Deps): Promise<{ turnId: string }> {
  if (deps.codex.state !== 'live') throw new Error('Provider disconnected')
  const read = record(
    await deps.codex.send('thread/read', { threadId: request.threadId, includeTurns: false })
  )
  const thread = record(read?.thread)
  if (
    !thread ||
    thread.id !== request.threadId ||
    typeof thread.cwd !== 'string' ||
    !isAbsolute(thread.cwd)
  ) {
    throw new Error('Thread has no verified cwd')
  }
  const resolve = deps.realpath ?? realpathSync
  resolve(thread.cwd)
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

async function dispatchOpenCode(request: ProviderRequest, deps: Deps): Promise<{ turnId: string }> {
  if (deps.opencode.state !== 'live') throw new Error('Provider disconnected')
  const binding = deps.openCodeSession(request.threadId)
  if (!binding || binding.id !== request.threadId || !isAbsolute(binding.directory))
    throw new Error('OpenCode session has no verified cwd')
  const resolve = deps.realpath ?? realpathSync
  const loaded = record(
    await deps.opencode.send('session/load', {
      sessionId: request.threadId,
      cwd: resolve(binding.directory),
      mcpServers: []
    })
  )
  const configs = Array.isArray(loaded?.configOptions) ? loaded.configOptions : []
  const model = configs.map(modelOption).find((item) => item !== null) ?? null
  if (!model || !optionValues(model).includes(request.model)) throw new Error('Model unavailable')
  if (model.currentValue !== request.model) {
    await deps.opencode.send('session/set_config_option', {
      sessionId: request.threadId,
      configId: 'model',
      type: 'id',
      value: request.model
    })
  }
  if (deps.opencode.state !== 'live') throw new Error('Provider disconnected')
  const result = record(
    await deps.opencode.send('session/prompt', {
      sessionId: request.threadId,
      prompt: [{ type: 'text', text: request.text }]
    })
  )
  if (typeof result?.stopReason !== 'string') throw new Error('Malformed prompt completion')
  return { turnId: `ocp-${randomUUID()}` }
}

export async function dispatchProviderPrompt(
  request: ProviderRequest,
  deps: Deps
): Promise<{ turnId: string }> {
  if (!request.threadId || !request.model || !request.text.trim())
    throw new Error('Invalid prompt destination')
  return request.provider === 'codex'
    ? dispatchCodex(request, deps)
    : dispatchOpenCode(request, deps)
}
