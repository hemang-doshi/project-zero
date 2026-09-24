import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

export type CatalogSkill = {
  id: string
  source: string
  skill: string
  url: string
  installs: string
}
// eslint-disable-next-line no-control-regex -- strip terminal ANSI control bytes from CLI output.
const ANSI = /\u001b\[[0-9;]*m/g
const ID =
  /^([a-z0-9][a-z0-9.-]*\/[a-z0-9][a-z0-9.-]*)@([a-z0-9][a-z0-9:._-]*)\s+([\d.]+[KMB]?) installs$/i

export function parseSkillsFind(output: string): CatalogSkill[] {
  const lines = output
    .replace(ANSI, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
  const results: CatalogSkill[] = []
  for (let index = 0; index < lines.length - 1 && results.length < 50; index++) {
    const match = ID.exec(lines[index])
    if (!match) continue
    const url = lines[index + 1].replace(/^└\s*/, '')
    const expected = `https://skills.sh/${match[1]}/${match[2]}`
    if (url !== expected) continue
    results.push({
      id: `${match[1]}@${match[2]}`,
      source: match[1],
      skill: match[2],
      url,
      installs: match[3]
    })
  }
  return results
}

export async function searchSkillsCatalog(query: string): Promise<CatalogSkill[]> {
  const trimmed = query.trim()
  // eslint-disable-next-line no-control-regex -- reject control bytes in query argv.
  if (trimmed.length < 2 || trimmed.length > 80 || /[\r\n\u0000-\u001f]/.test(trimmed))
    throw new Error('Invalid catalog query')
  const require = createRequire(import.meta.url)
  const pkg = require('skills/package.json') as { version?: string }
  if (pkg.version !== '1.7.0') throw new Error('Unsupported skills CLI version')
  const cli = join(dirname(require.resolve('skills/package.json')), 'bin', 'cli.mjs')
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'find', trimmed], {
      shell: false,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DISABLE_TELEMETRY: '1' },
      stdio: ['ignore', 'pipe', 'ignore']
    })
    let stdout = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Catalog search timed out'))
    }, 10_000)
    child.stdout.on('data', (part: Buffer) => {
      stdout += part.toString('utf8')
      if (stdout.length > 128_000) {
        child.kill()
        reject(new Error('Catalog response too large'))
      }
    })
    child.on('error', () => {
      clearTimeout(timer)
      reject(new Error('Catalog unavailable'))
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      code === 0 ? resolve(stdout) : reject(new Error('Catalog unavailable'))
    })
  })
  return parseSkillsFind(output)
}
