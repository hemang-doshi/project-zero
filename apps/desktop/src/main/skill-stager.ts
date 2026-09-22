import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import { join, relative, sep } from 'node:path'

export type StagedSkillManifest = {
  candidateId: string
  files: Array<{ path: string; bytes: number; sha256: string }>
  totalBytes: number
}

const CANDIDATE = /^[a-z0-9][a-z0-9.-]*\/[a-z0-9][a-z0-9.-]*@[a-z0-9][a-z0-9:._-]*$/i
const MAX_FILES = 200
const MAX_FILE_BYTES = 256_000
const MAX_TOTAL_BYTES = 2_000_000

/** Inspect a completed, private CLI stage. This never executes or interprets skill instructions. */
export function inspectStagedSkill(root: string, candidateId: string): StagedSkillManifest {
  if (!CANDIDATE.test(candidateId) || candidateId.includes('..'))
    throw new Error('Invalid candidate')
  if (!fs.lstatSync(root).isDirectory()) throw new Error('Invalid stage root')
  const files: StagedSkillManifest['files'] = []
  let totalBytes = 0
  let entries = 0
  const walk = (directory: string): void => {
    for (const name of fs.readdirSync(directory).sort()) {
      if (++entries > 400) throw new Error('Too many staged entries')
      // eslint-disable-next-line no-control-regex -- staged file names must exclude control bytes.
      if (name === '.' || name === '..' || /[\x00-\x1f]/.test(name))
        throw new Error('Invalid staged path')
      const absolute = join(directory, name)
      const path = relative(root, absolute)
      if (path.startsWith(`..${sep}`) || path === '..' || path.startsWith(sep))
        throw new Error('Invalid staged path')
      const metadata = fs.lstatSync(absolute)
      if (metadata.isDirectory()) {
        walk(absolute)
        continue
      }
      if (!metadata.isFile() || metadata.nlink !== 1)
        throw new Error('Unsupported staged file')
      if (metadata.size > MAX_FILE_BYTES) throw new Error('Staged file too large')
      if (files.length >= MAX_FILES) throw new Error('Too many staged files')
      const fd = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
      let data: Buffer
      try {
        const opened = fs.fstatSync(fd)
        if (!opened.isFile() || opened.nlink !== 1 || opened.size > MAX_FILE_BYTES)
          throw new Error('Unsupported staged file')
        data = fs.readFileSync(fd)
      } finally {
        fs.closeSync(fd)
      }
      totalBytes += data.length
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Staged skill too large')
      files.push({
        path: path.split(sep).join('/'),
        bytes: data.length,
        sha256: createHash('sha256').update(data).digest('hex')
      })
      if (path === 'SKILL.md') {
        const content = data.toString('utf8')
        if (!/^---\r?\n[\s\S]{1,16000}?\r?\n---\r?\n/.test(content) ||
          !/^name:\s*\S+/m.test(content) || !/^description:\s*\S+/m.test(content))
          throw new Error('Invalid SKILL.md')
      }
    }
  }
  walk(root)
  if (!files.some((file) => file.path === 'SKILL.md')) throw new Error('Invalid SKILL.md')
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  return { candidateId, files, totalBytes }
}
