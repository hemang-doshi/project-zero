import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { inspectStagedSkill } from './skill-stager'

function fixture(body = '---\nname: example\ndescription: Synthetic test skill\n---\n# Example\n'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-skill-stage-'))
  fs.writeFileSync(path.join(root, 'SKILL.md'), body)
  return root
}

describe('inspectStagedSkill', () => {
  it('returns bounded file hashes without reading instructions as commands', () => {
    const root = fixture()
    try {
      fs.mkdirSync(path.join(root, 'references'))
      fs.writeFileSync(path.join(root, 'references', 'guide.md'), 'Untrusted data only')
      const result = inspectStagedSkill(root, 'owner/repo@example')
      expect(result.candidateId).toBe('owner/repo@example')
      expect(result.files.map((file) => file.path)).toEqual(['SKILL.md', 'references/guide.md'])
      expect(result.files[0].sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(result.totalBytes).toBeGreaterThan(0)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects missing metadata, links, hardlinks, devices and oversized content', () => {
    const root = fixture('No frontmatter')
    try {
      expect(() => inspectStagedSkill(root, 'owner/repo@example')).toThrow('Invalid SKILL.md')
      fs.writeFileSync(path.join(root, 'SKILL.md'), '---\nsource: unknown\n---\nname: trick\ndescription: body only')
      expect(() => inspectStagedSkill(root, 'owner/repo@example')).toThrow('Invalid SKILL.md')
      fs.writeFileSync(path.join(root, 'SKILL.md'), '---\nname: example\ndescription: Synthetic\n---\n')
      fs.symlinkSync('/etc/passwd', path.join(root, 'escape'))
      expect(() => inspectStagedSkill(root, 'owner/repo@example')).toThrow('Unsupported staged file')
      fs.unlinkSync(path.join(root, 'escape'))
      fs.linkSync(path.join(root, 'SKILL.md'), path.join(root, 'linked.md'))
      expect(() => inspectStagedSkill(root, 'owner/repo@example')).toThrow('Unsupported staged file')
      fs.unlinkSync(path.join(root, 'linked.md'))
      fs.writeFileSync(path.join(root, 'large.bin'), Buffer.alloc(300_000))
      expect(() => inspectStagedSkill(root, 'owner/repo@example')).toThrow('Staged file too large')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects malformed catalog identity and absent SKILL.md', () => {
    const root = fixture()
    try {
      expect(() => inspectStagedSkill(root, '../../escape')).toThrow('Invalid candidate')
      fs.unlinkSync(path.join(root, 'SKILL.md'))
      expect(() => inspectStagedSkill(root, 'owner/repo@example')).toThrow('Invalid SKILL.md')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
