import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  groupSessionsByFolder,
  readOpenCodeSessionStore,
  type OpenCodeSessionRow
} from './opencode-sessions'

// Fixture: a tmpdir store tree mirroring the REAL on-disk layout discovered on
// this machine — ~/.local/share/opencode/opencode.db (SQLite) with the real
// `session` table shape. No daemon contact, no real home-dir reads.
function fixtureDb(rows: Array<Record<string, unknown>>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-ocp-store-'))
  const dbPath = path.join(dir, 'opencode.db')
  const db = new DatabaseSync(dbPath)
  db.exec(
    `CREATE TABLE session (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      directory TEXT NOT NULL,
      title TEXT NOT NULL,
      agent TEXT,
      model TEXT,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    )`
  )
  const insert = db.prepare(
    'INSERT INTO session (id, project_id, directory, title, agent, model, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
  for (const r of rows) {
    insert.run(
      r['id'] as string,
      (r['project_id'] as string) ?? 'p1',
      r['directory'] as string,
      (r['title'] as string) ?? '',
      (r['agent'] as string | null) ?? null,
      (r['model'] as string | null) ?? null,
      (r['time_created'] as number) ?? 0,
      (r['time_updated'] as number) ?? 0
    )
  }
  db.close()
  return dbPath
}

const MODEL = JSON.stringify({ id: 'muse-spark-1.3', providerID: 'opencode-go' })

describe('groupSessionsByFolder', () => {
  it('groups by project directory with folder names, newest session first', () => {
    const sessions: OpenCodeSessionRow[] = [
      {
        id: 'old',
        title: 'Old',
        directory: '/repo/alpha',
        agent: 'general',
        model: 'muse-spark-1.3',
        createdAt: 1,
        updatedAt: 10
      },
      {
        id: 'new',
        title: 'New',
        directory: '/repo/alpha',
        agent: 'build',
        model: 'muse-spark-1.3',
        createdAt: 2,
        updatedAt: 30
      },
      {
        id: 'solo',
        title: 'Solo',
        directory: '/repo/beta',
        agent: null,
        model: null,
        createdAt: 3,
        updatedAt: 20
      }
    ]
    const groups = groupSessionsByFolder(sessions)
    expect(groups.map((g) => g.path)).toEqual(['/repo/alpha', '/repo/beta'])
    expect(groups.map((g) => g.folder)).toEqual(['alpha', 'beta'])
    expect(groups[0]?.sessions.map((s) => s.id)).toEqual(['new', 'old'])
    expect(groups[0]?.count).toBe(2)
    expect(groups[1]?.sessions.map((s) => s.id)).toEqual(['solo'])
  })
})

describe('readOpenCodeSessionStore', () => {
  it('returns folder-grouped sessions newest-first from a fixture store', () => {
    const dbPath = fixtureDb([
      {
        id: 's-old',
        directory: '/repo/alpha',
        title: 'Old session',
        agent: 'general',
        model: MODEL,
        time_created: 100,
        time_updated: 100
      },
      {
        id: 's-new',
        directory: '/repo/alpha',
        title: 'New session',
        agent: 'build',
        model: MODEL,
        time_created: 200,
        time_updated: 300
      },
      {
        id: 's-beta',
        directory: '/repo/beta',
        title: 'Beta session',
        agent: null,
        model: null,
        time_created: 150,
        time_updated: 200
      }
    ])
    const result = readOpenCodeSessionStore(dbPath)
    expect(result.ok).toBe(true)
    expect(result.groups.map((g) => g.path)).toEqual(['/repo/alpha', '/repo/beta'])
    expect(result.groups[0]?.sessions.map((s) => s.id)).toEqual(['s-new', 's-old'])
    expect(result.groups[0]?.sessions[0]).toMatchObject({
      title: 'New session',
      agent: 'build',
      model: 'muse-spark-1.3',
      updatedAt: 300
    })
    expect(result.note).toBeNull()
  })

  it('skips malformed session rows fail-soft and still groups the rest', () => {
    const dbPath = fixtureDb([
      {
        id: 'good',
        directory: '/repo/alpha',
        title: 'Good',
        time_created: 1,
        time_updated: 2
      },
      {
        id: '',
        directory: '/repo/alpha',
        title: 'Missing id',
        time_created: 3,
        time_updated: 4
      },
      {
        id: 'nodir',
        directory: '',
        title: 'Missing directory',
        time_created: 5,
        time_updated: 6
      }
    ])
    const result = readOpenCodeSessionStore(dbPath)
    expect(result.ok).toBe(true)
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]?.sessions.map((s) => s.id)).toEqual(['good'])
  })

  it('keeps the raw model string when it is not JSON', () => {
    const dbPath = fixtureDb([
      {
        id: 's1',
        directory: '/repo/alpha',
        title: 'T',
        model: 'muse-spark-1.3-plain',
        time_created: 1,
        time_updated: 1
      }
    ])
    const result = readOpenCodeSessionStore(dbPath)
    expect(result.groups[0]?.sessions[0]?.model).toBe('muse-spark-1.3-plain')
  })

  it('returns honest empty when the store file is missing', () => {
    const missing = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'zero-ocp-miss-')),
      'opencode.db'
    )
    const result = readOpenCodeSessionStore(missing)
    expect(result.ok).toBe(false)
    expect(result.groups).toEqual([])
    expect(result.note).toContain('No OpenCode sessions found')
  })

  it('returns honest empty when the store path is unreadable', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-ocp-dir-'))
    const result = readOpenCodeSessionStore(dir)
    expect(result.ok).toBe(false)
    expect(result.groups).toEqual([])
    expect(result.note).toContain('No OpenCode sessions found')
  })
})
