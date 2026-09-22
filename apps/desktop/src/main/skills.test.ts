import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSkillDiscoverer } from './skills'

// Main-process skill discovery (Task 37D) over lane B's pure layer. Tests
// drive the production factory with process.env.HOME pointed at tmpdir
// fixtures — never the real home, never the daemon, no home-dir writes.
const savedHome = process.env.HOME
let dir = ''

const writeSkill = (skillDir: string, frontmatter: string): void => {
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), `---\n${frontmatter}\n---\n\n# Skill\n`)
}

const writeHomeTree = (home: string): void => {
  writeSkill(join(home, '.claude', 'skills', 'mytool'), 'name: mytool\ndescription: A tool.')
  writeSkill(join(home, '.claude', 'skills', 'gstack', 'browse'), 'name: browse')
  const pkgSkills = join(
    home,
    '.cache',
    'opencode',
    'packages',
    'pkg-a',
    'node_modules',
    'pkg-a',
    'skills'
  )
  writeSkill(join(pkgSkills, 'alpha'), 'name: alpha')
  writeFileSync(
    join(home, '.cache', 'opencode', 'packages', 'pkg-a', 'node_modules', 'pkg-a', 'package.json'),
    JSON.stringify({ name: 'pkg-a' })
  )
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zero-skills-main-'))
  process.env.HOME = join(dir, 'home')
})

afterEach(() => {
  process.env.HOME = savedHome
  rmSync(dir, { recursive: true, force: true })
})

describe('createSkillDiscoverer', () => {
  it('discovers fixture groups from the HOME skill roots', () => {
    writeHomeTree(process.env.HOME as string)
    const result = createSkillDiscoverer().discover()
    expect(result.ok).toBe(true)
    expect(result.note).toBeNull()
    expect(result.groups.map((g) => g.id).sort()).toEqual(['gstack', 'pkg-a', 'standalone'])
    expect(result.groups.find((g) => g.id === 'gstack')?.skills.map((s) => s.id)).toEqual([
      'browse'
    ])
    expect(result.groups.find((g) => g.id === 'standalone')?.skills.map((s) => s.id)).toEqual([
      'mytool'
    ])
  })

  it('attributes plugin-package skills to the package family (lane B fix)', () => {
    writeHomeTree(process.env.HOME as string)
    const result = createSkillDiscoverer().discover()
    const pkg = result.groups.find((g) => g.id === 'pkg-a')
    expect(pkg?.skills.map((s) => s.id)).toEqual(['alpha'])
    expect(pkg?.skills[0]?.pluginId).toBe('pkg-a')
  })

  it('returns honest-empty self-learnt when no learned store exists', () => {
    writeHomeTree(process.env.HOME as string)
    expect(createSkillDiscoverer().discover().selfLearnt).toEqual([])
  })

  it('caches per launch and rescans only on refresh', () => {
    const home = process.env.HOME as string
    writeHomeTree(home)
    const discoverer = createSkillDiscoverer()
    expect(
      discoverer
        .discover()
        .groups.find((g) => g.id === 'standalone')
        ?.skills.map((s) => s.id)
    ).toEqual(['mytool'])
    writeSkill(join(home, '.agents', 'skills', 'late'), 'name: late')
    // Cached: the late skill is invisible until an explicit refresh.
    expect(
      discoverer
        .discover()
        .groups.find((g) => g.id === 'standalone')
        ?.skills.map((s) => s.id)
    ).toEqual(['mytool'])
    expect(
      discoverer
        .discover(true)
        .groups.find((g) => g.id === 'standalone')
        ?.skills.map((s) => s.id)
        .sort()
    ).toEqual(['late', 'mytool'])
  })

  it('fail-softs to ok:false with a note when no root is readable', () => {
    const result = createSkillDiscoverer().discover()
    expect(result).toEqual({ ok: false, groups: [], selfLearnt: [], note: expect.any(String) })
    expect((result.note as string).length).toBeGreaterThan(0)
  })
})
