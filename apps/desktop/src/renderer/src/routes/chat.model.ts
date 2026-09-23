import type { Harness } from './runtime.types'
import type { ProjectListItem } from '../../../shared/ipc'

// Wire shapes are the Codex app-server ThreadItem variants (schema generated
// from the pinned toolchain binary; see task-22-report.md for the schema
// evidence). Parsing is lenient: malformed items are skipped, unknown types
// surface as honest notice rows, nothing is dropped silently.

export type ThreadRow = {
  id: string
  name: string
  preview: string
  createdAt: number | null
  recencyAt: number | null
  model: string | null
  provider: string
  status: string
  projectId?: string | null
  cwd?: string | null
}

export type ChatItem =
  | { kind: 'message'; role: 'user' | 'assistant'; text: string; id: string }
  | { kind: 'thinking'; text: string; summary: string; id: string }
  | {
      kind: 'exec'
      command: string
      cwd: string
      output: string | null
      exitCode: number | null
      status: string
      id: string
    }
  | {
      kind: 'tool'
      tool: string
      server: string | null
      detail: string
      result: string | null
      status: string
      id: string
    }
  | { kind: 'notice'; text: string; id: string }

export type ThinkingGroup = {
  kind: 'thinking-group'
  id: string
  items: Array<Extract<ChatItem, { kind: 'thinking' }>>
}
export type DisplayItem = Exclude<ChatItem, { kind: 'thinking' }> | ThinkingGroup

export function groupVisibleItems(items: ChatItem[]): DisplayItem[] {
  const display: DisplayItem[] = []
  let reasoning: ThinkingGroup['items'] = []
  const flush = (trailing: boolean): void => {
    if (reasoning.length === 0) return
    if (trailing || reasoning.some((item) => item.summary.trim() || item.text.trim())) {
      display.push({ kind: 'thinking-group', id: `thinking:${reasoning[0]?.id}`, items: reasoning })
    }
    reasoning = []
  }
  for (const item of items) {
    if (item.kind === 'thinking') reasoning.push(item)
    else {
      flush(false)
      display.push(item)
    }
  }
  flush(true)
  return display
}

export const MAX_CHAT_ITEMS = 400

type Rec = Record<string, unknown>

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

export function parseThreadRows(value: unknown): ThreadRow[] {
  const root = isRec(value) ? value : null
  const raw = asArray(root?.threads)
  const rows: ThreadRow[] = []
  for (const item of raw) {
    const r = isRec(item) ? item : null
    if (r === null || !isStr(r.id) || r.id === '') continue
    rows.push({
      id: r.id,
      name: isStr(r.name) ? r.name : '',
      preview: isStr(r.preview) ? r.preview : '',
      createdAt: isNum(r.createdAt) ? r.createdAt : null,
      recencyAt: isNum(r.recencyAt) ? r.recencyAt : null,
      model: isStr(r.model) ? r.model : null,
      provider: isStr(r.modelProvider) ? r.modelProvider : '',
      status: isStr(r.status) ? r.status : '',
      projectId: isStr(r.projectId) && r.projectId !== '' ? r.projectId : null,
      cwd: isStr(r.cwd) && r.cwd !== '' ? r.cwd : null
    })
  }
  rows.sort((a, b) => threadTimestamp(b) - threadTimestamp(a))
  return rows
}

export function groupThreadsByRegisteredProject(
  projects: ProjectListItem[],
  threads: ThreadRow[]
): {
  groups: Array<{ project: ProjectListItem; rows: ThreadRow[] }>
  unprojected: ThreadRow[]
} {
  const groups = projects.map((project) => ({ project, rows: [] as ThreadRow[] }))
  const byId = new Map(groups.map((group) => [group.project.id, group]))
  const byPath = [...groups].sort((a, b) => b.project.path.length - a.project.path.length)
  const unprojected: ThreadRow[] = []
  for (const row of [...threads].sort((a, b) => threadTimestamp(b) - threadTimestamp(a))) {
    const explicit = row.projectId ? byId.get(row.projectId) : undefined
    const fromCwd = row.cwd
      ? byPath.find(
          ({ project }) => row.cwd === project.path || row.cwd?.startsWith(`${project.path}/`)
        )
      : undefined
    const group = explicit ?? fromCwd
    if (group) {
      group.rows.push(row)
    } else if (row.cwd) {
      let providerGroup = groups.find(({ project }) => project.id === `cwd:${row.cwd}`)
      if (!providerGroup) {
        const parts = row.cwd.split('/').filter(Boolean)
        providerGroup = {
          project: { id: `cwd:${row.cwd}`, name: parts.at(-1) ?? row.cwd, path: row.cwd },
          rows: []
        }
        groups.push(providerGroup)
      }
      providerGroup.rows.push(row)
    } else unprojected.push(row)
  }
  return { groups, unprojected }
}

export function groupThreadsByFolder(
  projectPath: string,
  rows: ThreadRow[]
): Array<{ path: string | null; label: string; rows: ThreadRow[] }> {
  const byPath = new Map<string | null, { path: string | null; label: string; rows: ThreadRow[] }>()
  for (const row of rows) {
    const path = row.cwd ?? null
    let group = byPath.get(path)
    if (!group) {
      const label =
        path === null
          ? 'Unknown folder'
          : path === projectPath
            ? 'Project root'
            : path.startsWith(`${projectPath}/`)
              ? path.slice(projectPath.length + 1)
              : 'Linked folder'
      group = { path, label, rows: [] }
      byPath.set(path, group)
    }
    group.rows.push(row)
  }
  return [...byPath.values()]
}

export function threadTimestamp(row: ThreadRow): number {
  return row.recencyAt ?? row.createdAt ?? 0
}

export function threadTitle(row: ThreadRow, limit = 60): string {
  const base = row.name !== '' ? row.name : row.preview
  if (!isStr(base) || base.trim() === '') return 'untitled'
  const clean = base.trim()
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean
}

// --- transcript parsing -----------------------------------------------------

const textOf = (v: unknown): string | null => (isStr(v) ? v : null)

const stringsJoined = (v: unknown, joiner: string): string => asArray(v).filter(isStr).join(joiner)

const outputBodyText = (v: unknown): string | null => {
  if (isStr(v)) return v
  if (!isRec(v)) return null
  const content = asArray(v.content)
  const texts: string[] = []
  for (const item of content) {
    const r = isRec(item) ? item : null
    const text = r === null ? null : textOf(r.text)
    if (text !== null) texts.push(text)
  }
  return texts.length > 0 ? texts.join('\n') : null
}

const argsDetail = (item: Rec): string => {
  const args = item.arguments
  if (isStr(args)) return args
  if (isRec(args) || Array.isArray(args)) {
    try {
      return JSON.stringify(args)
    } catch {
      return ''
    }
  }
  return ''
}

function parseItem(raw: unknown): ChatItem | null {
  const item = isRec(raw) ? raw : null
  if (item === null) return null
  const id = textOf(item.id) ?? ''
  switch (item.type) {
    case 'userMessage': {
      const content = asArray(item.content)
      const texts: string[] = []
      for (const part of content) {
        const r = isRec(part) ? part : null
        const text = r === null ? null : textOf(r.text)
        if (text !== null) texts.push(text)
      }
      return texts.length === 0
        ? null
        : { kind: 'message', role: 'user', text: texts.join('\n'), id }
    }
    case 'agentMessage': {
      const text = textOf(item.text)
      return text === null ? null : { kind: 'message', role: 'assistant', text, id }
    }
    case 'reasoning': {
      const text = stringsJoined(item.content, '\n')
      const summary = stringsJoined(item.summary, ' ')
      return { kind: 'thinking', text, summary, id }
    }
    case 'commandExecution': {
      const command = textOf(item.command)
      if (command === null) return null
      const exitCode = isNum(item.exitCode) ? item.exitCode : null
      return {
        kind: 'exec',
        command,
        cwd: textOf(item.cwd) ?? '',
        output: textOf(item.aggregatedOutput),
        exitCode,
        status: textOf(item.status) ?? '',
        id
      }
    }
    case 'mcpToolCall': {
      const tool = textOf(item.tool)
      if (tool === null) return null
      return {
        kind: 'tool',
        tool,
        server: textOf(item.server),
        detail: argsDetail(item),
        result: outputBodyText(item.result),
        status: textOf(item.status) ?? '',
        id
      }
    }
    case 'dynamicToolCall': {
      const tool = textOf(item.tool)
      if (tool === null) return null
      return {
        kind: 'tool',
        tool,
        server: textOf(item.namespace),
        detail: argsDetail(item),
        result: outputBodyText(item.contentItems),
        status: textOf(item.status) ?? '',
        id
      }
    }
    case 'webSearch': {
      const query = textOf(item.query) ?? ''
      return {
        kind: 'tool',
        tool: 'webSearch',
        server: null,
        detail: query,
        result: null,
        status: '',
        id
      }
    }
    case 'fileChange': {
      const changes = asArray(item.changes)
      const paths = changes
        .map((c) => (isRec(c) ? textOf(c.path) : null))
        .filter((p): p is string => p !== null)
      if (paths.length === 0 && !isStr(item.status)) return null
      return {
        kind: 'tool',
        tool: 'fileChange',
        server: null,
        detail: paths.join(' · '),
        result: null,
        status: textOf(item.status) ?? '',
        id
      }
    }
    case 'functionCallOutput': {
      const name = textOf(item.name)
      if (name === null) return null
      return {
        kind: 'tool',
        tool: name,
        server: textOf(item.namespace),
        detail: '',
        result: outputBodyText(item.output),
        status: '',
        id
      }
    }
    default: {
      const text = textOf(item.type)
      return text === null ? null : { kind: 'notice', text, id }
    }
  }
}

export function parseTranscript(value: unknown): { items: ChatItem[]; dropped: number } {
  const root = isRec(value) ? value : null
  const thread = isRec(root?.thread) ? root.thread : null
  const turns = asArray(thread?.turns)
  const raw: unknown[] = []
  for (const turn of turns) {
    const t = isRec(turn) ? turn : null
    if (t === null) continue
    raw.push(...asArray(t.items))
  }
  const parsed: ChatItem[] = []
  for (const item of raw) {
    const chat = parseItem(item)
    if (chat !== null) parsed.push(chat)
  }
  if (parsed.length <= MAX_CHAT_ITEMS) return { items: parsed, dropped: 0 }
  return {
    items: parsed.slice(parsed.length - MAX_CHAT_ITEMS),
    dropped: parsed.length - MAX_CHAT_ITEMS
  }
}

// --- live merge (zero:bridge events append to the open transcript) ----------

export function mergeChatItem(items: ChatItem[], next: ChatItem): ChatItem[] {
  const idx = items.findIndex((i) => i.id !== '' && i.id === next.id)
  const merged = idx >= 0 ? items.map((i, n) => (n === idx ? next : i)) : [...items, next]
  if (merged.length <= MAX_CHAT_ITEMS) return merged
  return merged.slice(merged.length - MAX_CHAT_ITEMS)
}

// Merge a thread/read transcript under items that arrived live while the read
// was in flight. Newest state per item id wins: a lane item with the same id
// is kept as-is (the live event is newer evidence than the read snapshot) and
// the read fills only the ids the lane does not have, in read order. Lane-only
// items append after the read transcript (they arrived later). Bounded.
export function mergeTranscript(
  lane: ChatItem[],
  read: ChatItem[]
): { items: ChatItem[]; dropped: number } {
  if (lane.length === 0) return { items: read, dropped: 0 }
  const laneById = new Map<string, ChatItem>()
  for (const item of lane) if (item.id !== '') laneById.set(item.id, item)
  const readIds = new Set<string>()
  const merged: ChatItem[] = []
  for (const item of read) {
    if (item.id !== '') readIds.add(item.id)
    merged.push(laneById.get(item.id) ?? item)
  }
  for (const item of lane) {
    if (item.id === '' || !readIds.has(item.id)) merged.push(item)
  }
  if (merged.length <= MAX_CHAT_ITEMS) return { items: merged, dropped: 0 }
  return {
    items: merged.slice(merged.length - MAX_CHAT_ITEMS),
    dropped: merged.length - MAX_CHAT_ITEMS
  }
}

const appendDelta = (current: string | null, delta: string): string =>
  current === null ? delta : current + delta

export function applyBridgeEvent(
  items: ChatItem[],
  method: string,
  params: unknown
): { items: ChatItem[]; changed: boolean } {
  const p = isRec(params) ? params : null
  if (p === null) return { items, changed: false }
  const threadId = textOf(p.threadId)
  if (threadId === null) return { items, changed: false }
  if (method === 'item/started' || method === 'item/completed') {
    const itemRec = isRec(p.item) ? p.item : null
    if (itemRec === null || textOf(itemRec.id) === null) return { items, changed: false }
    const chat = parseItem(p.item)
    if (chat === null) return { items, changed: false }
    return { items: mergeChatItem(items, chat), changed: true }
  }
  const itemId = textOf(p.itemId)
  if (itemId === null) {
    return { items, changed: false }
  }
  if (
    method !== 'item/agentMessage/delta' &&
    method !== 'item/reasoning/textDelta' &&
    method !== 'item/reasoning/summaryTextDelta' &&
    method !== 'item/commandExecution/outputDelta'
  ) {
    return { items, changed: false }
  }
  const delta = textOf(p.delta)
  if (delta === null || delta === '') return { items, changed: false }
  const idx = items.findIndex((i) => i.id === itemId)
  if (idx < 0) {
    const seeded =
      method === 'item/reasoning/textDelta' || method === 'item/reasoning/summaryTextDelta'
        ? ({ kind: 'thinking', text: '', summary: '', id: itemId } as const)
        : method === 'item/commandExecution/outputDelta'
          ? ({
              kind: 'exec',
              command: '',
              cwd: '',
              output: '',
              exitCode: null,
              status: 'inProgress',
              id: itemId
            } as const)
          : ({ kind: 'message', role: 'assistant', text: '', id: itemId } as const)
    const grown =
      seeded.kind === 'thinking'
        ? { ...seeded, text: delta }
        : seeded.kind === 'exec'
          ? { ...seeded, output: delta }
          : { ...seeded, text: delta }
    const next = mergeChatItem(items, grown)
    return { items: next, changed: true }
  }
  const target = items[idx]
  let grown: ChatItem
  if (target.kind === 'message' && method === 'item/agentMessage/delta') {
    grown = { ...target, text: appendDelta(target.text, delta) }
  } else if (target.kind === 'thinking') {
    grown = { ...target, text: appendDelta(target.text, delta) }
  } else if (target.kind === 'exec' && method === 'item/commandExecution/outputDelta') {
    grown = { ...target, output: appendDelta(target.output, delta) }
  } else {
    return { items, changed: false }
  }
  return { items: mergeChatItem(items, grown), changed: true }
}

// --- per-harness bounded bridge event log (Task 13 carry) -------------------

export type BridgeEvent = {
  harness: Harness
  method: string
  params: unknown
}

export type HarnessEventLog = { events: BridgeEvent[]; dropped: number }

export const MAX_BRIDGE_EVENTS = 100

export const EMPTY_HARNESS_LOG: Record<Harness, HarnessEventLog> = {
  codex: { events: [], dropped: 0 },
  opencode: { events: [], dropped: 0 }
}

export function pushHarnessEvent(
  log: Record<Harness, HarnessEventLog>,
  push: BridgeEvent
): Record<Harness, HarnessEventLog> {
  const lane = log[push.harness] ?? { events: [], dropped: 0 }
  const events = [...lane.events, push]
  const next = events.length > MAX_BRIDGE_EVENTS ? events.slice(-MAX_BRIDGE_EVENTS) : events
  const dropped = events.length - next.length
  if (dropped === 0 && events.length === lane.events.length) return log
  return { ...log, [push.harness]: { events: next, dropped: lane.dropped + dropped } }
}
