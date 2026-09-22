import { execFile } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { promisify } from 'node:util'

const runFile = promisify(execFile)
const CANDIDATES = ['/opt/homebrew/bin/opencode', '/usr/local/bin/opencode']

export async function exportOpenCodeSession(threadId: string): Promise<unknown> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(threadId)) throw new Error('Invalid OpenCode session id')
  const exe = CANDIDATES.find((path) => {
    try {
      accessSync(path, constants.X_OK)
      return true
    } catch {
      return false
    }
  })
  if (exe === undefined) throw new Error('OpenCode CLI not installed')
  let stdout: string
  try {
    ;({ stdout } = await runFile(exe, ['export', threadId, '--sanitize'], {
      timeout: 10_000,
      maxBuffer: 8 * 1024 * 1024
    }))
  } catch {
    throw new Error('OpenCode session export failed')
  }
  try {
    const value: unknown = JSON.parse(stdout)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error()
    const info = (value as Record<string, unknown>).info
    const messages = (value as Record<string, unknown>).messages
    if (
      typeof info !== 'object' ||
      info === null ||
      (info as Record<string, unknown>).id !== threadId ||
      !Array.isArray(messages)
    ) throw new Error()
    return value
  } catch {
    throw new Error('OpenCode returned an invalid session export')
  }
}
