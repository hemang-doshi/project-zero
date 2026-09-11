import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  candidateSelfLearntRoots,
  colorForPlugin,
  defaultSkillRoots,
  discoverPlugins,
  discoverSelfLearnt,
  glyphForPlugin,
  parseSkillFrontmatter,
  PLUGIN_COLORS,
  PLUGIN_GLYPHS,
  STANDALONE_GROUP_ID,
  type FsDeps
} from './skillPlugins'

// Node-backed FsDeps over real tmpdir fixtures. Production main-process
// code builds the same three lambdas over the real skill roots; the module
// under test never imports node:fs itself (renderer-safe).
const nodeDeps = (): FsDeps => ({
  readdir: (dir) => {
    try {
      return readdirSync(dir)
    } catch {
      return null
    }
  },
  readFile: (path) => {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return null
    }
  },
  isDirectory: (path) => {
    try {
      return statSync(path).isDirectory()
    } catch {
      return false
    }
  }
})

const writeSkill = (dir: string, frontmatter: string): void => {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n\n# Skill\n`)
}

// Plugin-container fixture: <root>/<plugin>/<skill>/SKILL.md plus one
// flat <root>/<skill>/SKILL.md standalone install.
const writePluginTree = (root: string): void => {
  writeSkill(join(root, 'gstack', 'browse'), 'name: browse\ndescription: Fast headless browser.')
  writeSkill(join(root, 'gstack', 'autoplan'), 'name: autoplan\ndescription: Auto-review pipeline.')
  writeSkill(join(root, 'mytool'), 'name: mytool\ndescription: A standalone tool.')
}

const withTmp = (fn: (dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'skill-plugins-'))
  try {
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('parseSkillFrontmatter', () => {
  it('reads name and quoted description', () => {
    expect(parseSkillFrontmatter('---\nname: supabase\ndescription: "Does things."\n---\n'))
      .toEqual({ name: 'supabase', description: 'Does things.' })
  })

  it('reads literal-block descriptions', () => {
    const text = '---\nname: claude\ndescription: |\n  Line one.\n  Line two.\n---\n'
    expect(parseSkillFrontmatter(text)).toEqual({ name: 'claude', description: 'Line one.\nLine two.' })
  })

  it('folds folded-block descriptions', () => {
    const text = '---\nname: x\ndescription: >\n  Line one.\n  Line two.\n---\n'
    expect(parseSkillFrontmatter(text).description).toBe('Line one. Line two.')
  })

  it('fail-softs to {} without frontmatter', () => {
    expect(parseSkillFrontmatter('# No frontmatter\n')).toEqual({})
    expect(parseSkillFrontmatter('')).toEqual({})
    expect(parseSkillFrontmatter('---\nname: unterminated\n')).toEqual({})
  })
})

describe('discoverPlugins', () => {
  it('groups nested skills by parent folder and isolates flat installs', () => {
    withTmp((dir) => {
      writePluginTree(dir)
      const groups = discoverPlugins([dir], nodeDeps())
      const gstack = groups.find((g) => g.id === 'gstack')
      const alone = groups.find((g) => g.id === STANDALONE_GROUP_ID)
      expect(gstack).toBeDefined()
      expect(gstack?.skills.map((s) => s.id)).toEqual(['autoplan', 'browse'])
      expect(gstack?.skills.every((s) => s.pluginId === 'gstack' && s.source === 'installed')).toBe(true)
      expect(alone?.skills.map((s) => s.id)).toEqual(['mytool'])
      expect(alone?.skills[0]?.pluginId).toBeNull()
    })
  })

  it('orders plugin groups A-Z with standalone last, skills by name', () => {
    withTmp((dir) => {
      writeSkill(join(dir, 'zebra', 'zskill'), 'name: zskill')
      writeSkill(join(dir, 'alpha', 'bskill'), 'name: bskill')
      writeSkill(join(dir, 'alpha', 'askill'), 'name: askill')
      writeSkill(join(dir, 'solo'), 'name: solo')
      const groups = discoverPlugins([dir], nodeDeps())
      expect(groups.map((g) => g.id)).toEqual(['alpha', 'zebra', STANDALONE_GROUP_ID])
      expect(groups[0]?.skills.map((s) => s.id)).toEqual(['askill', 'bskill'])
    })
  })

  it('skips malformed entries fail-soft and falls back to folder names', () => {
    withTmp((dir) => {
      mkdirSync(join(dir, 'empty-dir'))
      writeFileSync(join(dir, 'not-a-dir.txt'), 'hello')
      mkdirSync(join(dir, 'broken'), { recursive: true })
      writeFileSync(join(dir, 'broken', 'SKILL.md'), 'not: [valid\n  - yaml\n')
      writeSkill(join(dir, 'good'), 'name: good')
      const groups = discoverPlugins([dir], nodeDeps())
      const alone = groups.find((g) => g.id === STANDALONE_GROUP_ID)
      // empty-dir + stray file skipped; broken frontmatter kept under its
      // folder name; good parsed normally.
      expect(alone?.skills.map((s) => s.id).sort()).toEqual(['broken', 'good'])
    })
  })

  it('returns [] for empty and missing dirs', () => {
    withTmp((dir) => {
      expect(discoverPlugins([join(dir, 'nothing-here')], nodeDeps())).toEqual([])
      mkdirSync(join(dir, 'empty'))
      expect(discoverPlugins([join(dir, 'empty')], nodeDeps())).toEqual([])
      expect(discoverPlugins([], nodeDeps())).toEqual([])
    })
  })

  it('returns [] with no deps (renderer has no filesystem)', () => {
    expect(discoverPlugins(['/whatever'])).toEqual([])
  })

  it('treats a container with its own SKILL.md as one skill, not a plugin', () => {
    withTmp((dir) => {
      // Mirrors ~/.claude/skills/gstack: repo root carries SKILL.md while
      // also holding skill subdirs — the root wins, no double-count.
      writeSkill(join(dir, 'gstack'), 'name: gstack\ndescription: The stack.')
      writeSkill(join(dir, 'gstack', 'browse'), 'name: browse')
      const groups = discoverPlugins([dir], nodeDeps())
      expect(groups.map((g) => g.id)).toEqual([STANDALONE_GROUP_ID])
      expect(groups[0]?.skills.map((s) => s.id)).toEqual(['gstack'])
    })
  })

  it('attributes a package skills/ dir to the package name', () => {
    withTmp((dir) => {
      const skills = join(dir, 'somepkg', 'skills')
      writeSkill(join(skills, 'brainstorming'), 'name: brainstorming')
      writeFileSync(join(dir, 'somepkg', 'package.json'), JSON.stringify({ name: 'superpowers' }))
      const groups = discoverPlugins([skills], nodeDeps())
      expect(groups.map((g) => g.id)).toEqual(['superpowers'])
      expect(groups[0]?.skills[0]?.pluginId).toBe('superpowers')
    })
  })

  it('dedupes first-root-wins across roots', () => {
    withTmp((dir) => {
      const a = join(dir, 'a')
      const b = join(dir, 'b')
      writeSkill(join(a, 'dup'), 'name: dup\ndescription: From A.')
      writeSkill(join(b, 'dup'), 'name: dup\ndescription: From B.')
      const groups = discoverPlugins([a, b], nodeDeps())
      const alone = groups.find((g) => g.id === STANDALONE_GROUP_ID)
      expect(alone?.skills).toHaveLength(1)
      expect(alone?.skills[0]?.description).toBe('From A.')
    })
  })
})

describe('glyphForPlugin / colorForPlugin', () => {
  it('is deterministic', () => {
    for (const id of ['gstack', 'superpowers', 'playwright', STANDALONE_GROUP_ID, '']) {
      expect(glyphForPlugin(id)).toBe(glyphForPlugin(id))
      expect(colorForPlugin(id)).toBe(colorForPlugin(id))
    }
  })

  it('stays inside the contract vocabularies', () => {
    for (const id of ['gstack', 'superpowers', 'playwright', 'alpha', 'zebra', STANDALONE_GROUP_ID]) {
      expect(PLUGIN_GLYPHS).toContain(glyphForPlugin(id))
      expect(PLUGIN_COLORS).toContain(colorForPlugin(id))
    }
  })

  it('pins known assignments so scene drift is visible', () => {
    expect(glyphForPlugin('gstack')).toBe('flask')
    expect(colorForPlugin('gstack')).toBe('#10B981')
    expect(glyphForPlugin(STANDALONE_GROUP_ID)).toBe('bolt')
    expect(colorForPlugin(STANDALONE_GROUP_ID)).toBe('#A83300')
  })
})

describe('discoverSelfLearnt', () => {
  it('returns [] with no deps and [] for missing roots (honest absence)', () => {
    expect(discoverSelfLearnt()).toEqual([])
    withTmp((dir) => {
      expect(discoverSelfLearnt({ ...nodeDeps(), roots: [join(dir, 'nope')] })).toEqual([])
      expect(discoverSelfLearnt({ ...nodeDeps() })).toEqual([])
    })
  })

  it('parses injected learned roots as self-learnt, sorted by name', () => {
    withTmp((dir) => {
      const learned = join(dir, 'learned')
      writeSkill(join(learned, 'zeta'), 'name: zeta\ndescription: Second.')
      writeSkill(join(learned, 'alpha'), 'name: alpha\ndescription: First.')
      mkdirSync(join(learned, 'empty'))
      const found = discoverSelfLearnt({ ...nodeDeps(), roots: [learned] })
      expect(found.map((s) => s.id)).toEqual(['alpha', 'zeta'])
      expect(found.every((s) => s.source === 'self-learnt' && s.pluginId === null)).toBe(true)
    })
  })
})

describe('root helpers', () => {
  it('builds the diagnosed skill roots from a home dir', () => {
    expect(defaultSkillRoots('/Users/test')).toEqual([
      '/Users/test/.claude/skills',
      '/Users/test/.agents/skills',
      '/Users/test/.config/opencode/skills',
      '/Users/test/.config/opencode/skills-codex',
      '/Users/test/.codex/skills'
    ])
  })

  it('lists the checked-and-absent self-learnt candidates', () => {
    expect(candidateSelfLearntRoots('/Users/test')).toEqual([
      '/Users/test/.config/project-zero/skills-learned',
      '/Users/test/.claude/skills-learned'
    ])
  })
})
