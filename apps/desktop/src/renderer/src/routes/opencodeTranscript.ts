import { MAX_CHAT_ITEMS, type ChatItem } from './chat.model'
import { openCodeUsageFromSession, type VerifiedUsage } from './providerUsage'

type Rec = Record<string, unknown>
const rec = (value: unknown): Rec | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Rec) : null
const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const json = (value: unknown): string => {
  try {
    return value === undefined ? '' : JSON.stringify(value)
  } catch {
    return ''
  }
}

export type TranscriptUsage = VerifiedUsage

export function parseOpenCodeTranscript(
  value: unknown,
  observedAt = Date.now()
): {
  items: ChatItem[]
  dropped: number
  usage: TranscriptUsage | null
} {
  const root = rec(value)
  const messages = array(root?.messages)
  const items: ChatItem[] = []
  for (const entry of messages) {
    const message = rec(entry)
    const info = rec(message?.info)
    const role = info?.role === 'user' ? 'user' : info?.role === 'assistant' ? 'assistant' : null
    for (const rawPart of array(message?.parts)) {
      const part = rec(rawPart)
      if (part === null) continue
      const id = str(part.id) || `${str(info?.id)}:${items.length}`
      if (part.type === 'text' && role !== null && str(part.text) !== '') {
        items.push({ kind: 'message', role, text: str(part.text), id })
      } else if (part.type === 'reasoning') {
        items.push({ kind: 'thinking', text: str(part.text), summary: '', id })
      } else if (part.type === 'tool') {
        const state = rec(part.state)
        const input = rec(state?.input)
        const tool = str(part.tool)
        if (tool === 'bash' && typeof input?.command === 'string') {
          const metadata = rec(state?.metadata)
          items.push({
            kind: 'exec',
            command: input.command,
            cwd: str(input.workdir),
            output: typeof state?.output === 'string' ? state.output : null,
            exitCode: typeof metadata?.exitCode === 'number' ? metadata.exitCode : null,
            status: str(state?.status),
            id
          })
        } else if (tool !== '') {
          items.push({
            kind: 'tool',
            tool,
            server: null,
            detail: json(state?.input),
            result: typeof state?.output === 'string' ? state.output : null,
            status: str(state?.status),
            id
          })
        }
      }
    }
  }
  const dropped = Math.max(0, items.length - MAX_CHAT_ITEMS)
  const usage = openCodeUsageFromSession(value, observedAt)
  return { items: dropped > 0 ? items.slice(dropped) : items, dropped, usage }
}
