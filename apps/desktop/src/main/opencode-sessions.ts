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
