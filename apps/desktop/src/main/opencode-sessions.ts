import { basename, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type OpenCodeSessionRow = {
  id: string
  title: string
  directory: string
  agent: string | null
  model: string | null
  createdAt: number
  updatedAt: number
}

export type OpenCodeFolderGroup = {
  folder: string
  path: string
  count: number
  sessions: OpenCodeSessionRow[]
}

export type OpenCodeStoreResult = {
  ok: boolean
  groups: OpenCodeFolderGroup[]
  note: string | null
}

export const MAX_OPENCODE_SESSIONS = 500
export const MAX_OPENCODE_MESSAGES = 500
export const MAX_OPENCODE_PARTS = 2_000

export type OpenCodeStoredMessage = {
  info: Record<string, unknown> & { id: string }
  parts: Array<Record<string, unknown> & { id: string }>
}

export type OpenCodeStoredSession = {
  info: Record<string, unknown> & { id: string; directory: string }
  messages: OpenCodeStoredMessage[]
}

export function defaultOpenCodeDbPath(home: string = process.env.HOME ?? ''): string {
  return join(home, '.local', 'share', 'opencode', 'opencode.db')
}

export function groupSessionsByFolder(sessions: OpenCodeSessionRow[]): OpenCodeFolderGroup[] {
  const byDir = new Map<string, OpenCodeSessionRow[]>()
  for (const session of sessions) {
    const list = byDir.get(session.directory) ?? []
    list.push(session)
    byDir.set(session.directory, list)
  }
  const groups: OpenCodeFolderGroup[] = [...byDir.entries()].map(([dir, rows]) => {
    rows.sort((a, b) => b.updatedAt - a.updatedAt)
    return {
      folder: basename(dir) === '' ? dir : basename(dir),
      path: dir,
      count: rows.length,
      sessions: rows
    }
  })
  groups.sort((a, b) => newestOf(b) - newestOf(a))
  return groups
}

function newestOf(group: OpenCodeFolderGroup): number {
  return group.sessions[0]?.updatedAt ?? 0
}

function parseModel(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed === 'object' && parsed !== null) {
      const id = (parsed as Record<string, unknown>)['id']
      if (typeof id === 'string' && id !== '') return id
    }
    return value
  } catch {
    return value
  }
}

function parseRow(row: unknown): OpenCodeSessionRow | null {
  if (typeof row !== 'object' || row === null) return null
  const rec = row as Record<string, unknown>
  if (typeof rec['id'] !== 'string' || rec['id'] === '') return null
  if (typeof rec['directory'] !== 'string' || rec['directory'] === '') return null
  return {
    id: rec['id'],
    title: typeof rec['title'] === 'string' ? rec['title'] : '',
    directory: rec['directory'],
    agent: typeof rec['agent'] === 'string' && rec['agent'] !== '' ? rec['agent'] : null,
    model: parseModel(rec['model']),
    createdAt: typeof rec['time_created'] === 'number' ? rec['time_created'] : 0,
    updatedAt: typeof rec['time_updated'] === 'number' ? rec['time_updated'] : 0
  }
}

// Read-only scan of OpenCode's on-disk session store (SQLite). Never writes,
// never spawns, never touches the network: a missing or unreadable store
// returns honest empty with a note instead of throwing.
export function readOpenCodeSessionStore(
  dbPath: string,
  opts?: { limit?: number }
): OpenCodeStoreResult {
  const limit = opts?.limit ?? MAX_OPENCODE_SESSIONS
  let db: DatabaseSync | null = null
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
    const rows = db
      .prepare(
        'SELECT id, directory, title, agent, model, time_created, time_updated FROM session ORDER BY time_updated DESC LIMIT ?'
      )
      .all(limit) as unknown[]
    const sessions: OpenCodeSessionRow[] = []
    for (const row of rows) {
      const parsed = parseRow(row)
      if (parsed !== null) sessions.push(parsed)
    }
    return { ok: true, groups: groupSessionsByFolder(sessions), note: null }
  } catch {
    return {
      ok: false,
      groups: [],
      note: `No OpenCode sessions found (session store unreadable at ${dbPath}).`
    }
  } finally {
    try {
      db?.close()
    } catch {
      /* closing a read-only handle must never wedge discovery */
    }
  }
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export function readOpenCodeSession(dbPath: string, sessionId: string): OpenCodeStoredSession {
  let db: DatabaseSync | null = null
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
    const session = db.prepare('SELECT * FROM session WHERE id = ? LIMIT 1').get(sessionId) as
      Record<string, unknown> | undefined
    if (!session || typeof session['directory'] !== 'string')
      throw new Error('OpenCode session not found')
    const rawMessages = db
      .prepare(
        `SELECT id, data FROM (
        SELECT id, data, time_created FROM message WHERE session_id = ? ORDER BY time_created DESC LIMIT ?
      ) ORDER BY time_created ASC`
      )
      .all(sessionId, MAX_OPENCODE_MESSAGES) as Array<Record<string, unknown>>
    const messages: OpenCodeStoredMessage[] = rawMessages.map((row) => ({
      info: { ...jsonRecord(row['data']), id: String(row['id'] ?? '') },
      parts: []
    }))
    const byId = new Map(messages.map((message) => [message.info.id, message]))
    const rawParts = db
      .prepare(
        `SELECT id, message_id, data FROM (
        SELECT id, message_id, data, time_created FROM part WHERE session_id = ? ORDER BY time_created DESC LIMIT ?
      ) ORDER BY time_created ASC`
      )
      .all(sessionId, MAX_OPENCODE_PARTS) as Array<Record<string, unknown>>
    for (const row of rawParts) {
      const message = byId.get(String(row['message_id'] ?? ''))
      if (message) message.parts.push({ ...jsonRecord(row['data']), id: String(row['id'] ?? '') })
    }
    return {
      info: {
        ...session,
        id: String(session['id']),
        directory: session['directory']
      },
      messages
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'OpenCode session not found') throw error
    throw new Error('OpenCode session store unreadable')
  } finally {
    try {
      db?.close()
    } catch {
      /* closing a read-only handle must never wedge transcript reads */
    }
  }
}
