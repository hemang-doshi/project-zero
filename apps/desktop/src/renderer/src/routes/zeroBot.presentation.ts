// Zero Bot conversational presentation helpers (pure, no I/O).
//
// These turn the raw harness transcript shapes from chat.model.ts into the
// Zero-owned conversational language of spec §§27-28/39: Zero authors every
// assistant turn, provider execution is muted attribution, tool work shows as
// compact semantic summaries, and streaming labels derive only from actual
// lane evidence (honest idle otherwise).

import type { Harness } from './runtime.types'
import type { ChatItem } from './chat.model'

type ExecItem = Extract<ChatItem, { kind: 'exec' }>
type ToolItem = Extract<ChatItem, { kind: 'tool' }>

export const PROVIDER_DISPLAY: Record<Harness, string> = {
  codex: 'Codex',
  opencode: 'OpenCode'
}

export function projectErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('ENOENT') && message.includes('zero.sock')) {
    return 'Zero runtime is not running on this Mac. Registered projects need the local daemon; Codex and OpenCode history can still be browsed.'
  }
  return message
}

export type ViaAttribution = { author: 'Zero'; via: string | null }

// Zero authors the turn; the provider/model that executed it is muted,
// verbatim machine metadata (never prettified — model ids stay exact).
export function formatViaAttribution(harness: Harness, model: string | null): ViaAttribution {
  if (model === null || model === '') return { author: 'Zero', via: null }
  return { author: 'Zero', via: `via ${PROVIDER_DISPLAY[harness]} · ${model}` }
}

// Count ' · '-separated paths the transcript parsers join into detail.
export function countPathParts(detail: string): number {
  const parts = detail
    .split('·')
    .map((p) => p.trim())
    .filter((p) => p !== '')
  return parts.length
}

const READ_TOOLS = new Set(['read_file', 'read', 'Read'])

const truncateQuoted = (text: string, limit = 48): string =>
  text.length > limit ? `${text.slice(0, limit - 1)}…` : text

// Semantic one-line summary for a tool card header. Falls back to the
// verbatim tool name so no verb is ever invented for an unknown tool.
export function summarizeToolItem(item: ToolItem): string {
  const paths = countPathParts(item.detail)
  const files = (n: number): string => (n === 1 ? '1 file' : `${n} files`)
  if (item.tool === 'fileChange') {
    if (paths >= 1) return `Modified ${files(paths)}`
    return 'Modified files'
  }
  if (READ_TOOLS.has(item.tool)) {
    if (paths >= 1) return `Read ${files(paths)}`
    return 'Read file'
  }
  if (item.tool === 'webSearch') {
    const query = item.detail.trim()
    return query !== '' ? `Searched “${truncateQuoted(query)}”` : 'Searched the web'
  }
  return item.tool
}

// Semantic one-line summary for an exec card header. The command stays
// verbatim (machine metadata); only the framing verb is added.
export function summarizeExecItem(item: ExecItem): string {
  const command = item.command.length > 72 ? `${item.command.slice(0, 71)}…` : item.command
  if (item.exitCode === null) return `Running ${command}`
  return `Ran ${command}`
}

// Streaming state grounded in actual lane evidence only: a running exec, an
// in-progress tool, or trailing reasoning. Settled transcripts return null
// (honest idle — the UI shows no activity rather than a spinner).
export function streamingLabel(items: ChatItem[]): string | null {
  if (items.some((i) => i.kind === 'exec' && i.exitCode === null)) return 'Running…'
  if (items.some((i) => i.kind === 'tool' && i.status === 'inProgress')) return 'Working…'
  const last = items.length > 0 ? items[items.length - 1] : undefined
  if (last !== undefined && last.kind === 'thinking') return 'Inspecting…'
  return null
}

export type TurnItemCounts = { messages: number; thinking: number; tools: number; notices: number }

// Inspector counts: execs fold into tools (both are provider tool work).
export function turnItemCounts(items: ChatItem[]): TurnItemCounts {
  let messages = 0
  let thinking = 0
  let tools = 0
  let notices = 0
  for (const item of items) {
    if (item.kind === 'message') messages += 1
    else if (item.kind === 'thinking') thinking += 1
    else if (item.kind === 'tool' || item.kind === 'exec') tools += 1
    else notices += 1
  }
  return { messages, thinking, tools, notices }
}

export type ToolOutcomeSummary = {
  total: number
  completed: number
  failed: number
  running: number
  groups: Array<{ name: string; count: number }>
}

export function toolOutcomeSummary(items: ChatItem[]): ToolOutcomeSummary {
  let completed = 0
  let failed = 0
  let running = 0
  const groups = new Map<string, number>()
  for (const item of items) {
    if (item.kind !== 'tool' && item.kind !== 'exec') continue
    const name = item.kind === 'exec' ? 'terminal' : item.tool
    groups.set(name, (groups.get(name) ?? 0) + 1)
    const status = item.status.toLowerCase()
    if (
      status === 'error' ||
      status === 'failed' ||
      (item.kind === 'exec' && item.exitCode !== null && item.exitCode !== 0)
    )
      failed += 1
    else if (
      status === 'inprogress' ||
      status === 'pending' ||
      (item.kind === 'exec' && item.exitCode === null)
    )
      running += 1
    else completed += 1
  }
  return {
    total: completed + failed + running,
    completed,
    failed,
    running,
    groups: [...groups].map(([name, count]) => ({ name, count }))
  }
}
