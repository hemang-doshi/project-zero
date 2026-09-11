// Skill plugin discovery layer (Task 37 lane B).
//
// DIAGNOSIS (read-only, this machine, 2026-09-11) — the scene lane (C) and
// the vial-model lane (A) consume this contract; the rules below are binding:
//
// Where installed skills live (exact paths, live counts of dirs containing
// a SKILL.md file):
//   ~/.claude/skills/                  73 skills, flat <skill>/SKILL.md
//   ~/.agents/skills/                  28 skills, flat <skill>/SKILL.md
//   ~/.config/opencode/skills/         13 entries (symlinks into
//                                      ~/.claude/skills, e.g. hyperframes)
//   ~/.config/opencode/skills-codex/   17 entries (symlinks into
//                                      ~/.codex/skills, e.g. playwright)
//   ~/.codex/skills/                   84 entries, flat; gstack skills are
//                                      vendored here with a `gstack-` prefix
//                                      (gstack-browse, gstack-ship, …)
//   opencode plugin cache:
//     ~/.cache/opencode/packages/superpowers@git+https:/
//       …/node_modules/superpowers/skills/   14 skills, flat
//
// How "plugin" is expressed: there is NO manifest. Plugin identity is
// structural and comes in three shapes, all observed on this machine:
//   1. opencode `plugin` entries in ~/.config/opencode/opencode.json
//      (here: "superpowers@git+https://github.com/obra/superpowers.git") —
//      the package's `skills/` subdirectory holds that plugin's skills.
//   2. Whole-repo symlink containers: ~/.claude/skills/gstack ->
//      ~/.gstack/repos/gstack, whose subdirectories are skills.
//   3. Name-prefix vendoring: `gstack-*` entries inside ~/.codex/skills.
//
// PLUGIN-GROUPING RULE (binding for discoverPlugins): the parent folder is
// the plugin. A skill found at <root>/<skill>/SKILL.md has no plugin parent
// and lands in the `standalone` group. A skill found at
// <root>/<plugin>/<skill>/SKILL.md (the container itself carries no
// SKILL.md) lands in the group whose id is the parent folder name. A root
// whose own basename is `skills` and whose parent holds a package.json with
// a string `name` is a plugin package's skills dir (shape 1 above): its
// depth-1 skills group under the short package name instead of standalone.
// A container entry that ALSO carries its own SKILL.md (observed: the
// `gstack` symlink — repo root has SKILL.md and skill subdirs) counts as ONE
// standalone skill; its children are NOT recursed, so the flat installs of
// the same skills are never double-counted. Roots are scanned in order and
// the first sighting of a (group, id) pair wins.
//
// SELF-LEARNT VERDICT (binding for discoverSelfLearnt): there is NO
// self-learnt skill store on this machine. Searched and found empty:
//   - every skill dir above for learned markers
//     (rg for self-learn|self_learn|learned-in|learnt: no hits),
//   - the daemon: core/ contains no skill code at all,
//   - daemon state DBs (.runtime/live/zero.db, .runtime/v02-dev/zero.db):
//     `strings | rg -i skill` returns nothing,
//   - repo-local: no .opencode/, no .claude/skills, .codex/ holds only
//     hooks.json.
// (runtime.types.ts SKILL_FIXTURES use sources like `learned-in-codex` only
// as fixture labels, not as a store.) discoverSelfLearnt therefore returns
// [] unless the caller injects explicit roots via deps — the [] is the
// honest answer, never fabricated entries.
//
// This module is renderer-safe AND main-process-safe: it imports nothing
// (no node:fs, no node:path). All filesystem access arrives through the
// injectable FsDeps param. The main process builds one in ~3 lines:
//   { readdir: d => tryOrNull(() => fs.readdirSync(d)),
//     readFile: p => tryOrNull(() => fs.readFileSync(p, 'utf8')),
//     isDirectory: p => tryFalse(() => fs.statSync(p).isDirectory()) }
// Tests inject tmpdir fixtures the same way.

export type SkillGlyph = 'flask' | 'masks' | 'stack' | 'bolt' | 'orb'

export type SkillSummary = {
  id: string
  name: string
  source: 'installed' | 'self-learnt'
  pluginId: string | null
  description?: string
  icon?: string
}

export type PluginGroup = {
  id: string
  name: string
  color: string
  glyph: SkillGlyph
  skills: SkillSummary[]
}

// Injectable filesystem surface. Every member is total (never throws):
// readdir returns null for missing/unreadable dirs, readFile returns null
// for missing/unreadable files, isDirectory returns false for anything that
// is not a readable directory (including symlinks-to-dirs? No: callers that
// want symlinked skill installs followed — ~/.config/opencode/skills/* and
// ~/.claude/skills/gstack are ALL symlinks — must resolve them, e.g. via
// statSync rather than lstatSync).
export type FsDeps = {
  readdir: (dir: string) => string[] | null
  readFile: (path: string) => string | null
  isDirectory: (path: string) => boolean
}

export type SelfLearntDeps = FsDeps & {
  // Explicit roots holding learned skills as <root>/<skill>/SKILL.md.
  // Omitted/empty => [] (no self-learnt store is known — see verdict above).
  roots?: string[]
}

export const STANDALONE_GROUP_ID = 'standalone'
export const STANDALONE_GROUP_NAME = 'Standalone'

// Glyph vocabulary, fixed order — glyphForPlugin indexes into this exact
// array, so the order is part of the contract with the scene lane.
export const PLUGIN_GLYPHS: readonly SkillGlyph[] = ['flask', 'masks', 'stack', 'bolt', 'orb']

// Vial palette. Hardcoded ZERO_TOKENS hexes (token names in comments) — no
// new hues introduced. colorForPlugin indexes into this exact array.
export const PLUGIN_COLORS: readonly string[] = [
  '#F54E00', // brandOrange
  '#3B82F6', // highlightBlue
  '#10B981', // statusGreen
  '#F7DF94', // markerYellow
  '#A83300', // primaryAuthority
  '#8C9E82' // wallpaper
]

// Diagnosed read-only skill roots on this machine, built from a home dir so
// the function stays pure (no os.homedir import — renderer-safe).
export function defaultSkillRoots(homeDir: string): string[] {
  const home = homeDir.replace(/\/+$/, '')
  return [
    `${home}/.claude/skills`,
    `${home}/.agents/skills`,
    `${home}/.config/opencode/skills`,
    `${home}/.config/opencode/skills-codex`,
    `${home}/.codex/skills`
  ]
}

// Candidate self-learnt locations, checked on this machine and ABSENT (see
// verdict above). Exported so a future store can be wired without changing
// this module's shape; discoverSelfLearnt does NOT consult these by itself
// because silently scanning a hardcoded home from the renderer would be a
// lie about where data comes from — the caller passes explicit roots.
export function candidateSelfLearntRoots(homeDir: string): string[] {
  const home = homeDir.replace(/\/+$/, '')
  return [`${home}/.config/project-zero/skills-learned`, `${home}/.claude/skills-learned`]
}

const NULL_DEPS: FsDeps = {
  readdir: () => null,
  readFile: () => null,
  isDirectory: () => false
}

const joinPath = (dir: string, entry: string): string => `${dir.replace(/\/+$/, '')}/${entry}`

// FNV-1a (32-bit) over UTF-16 code units. Chosen because it is tiny,
// dependency-free, and stable across engines (unlike localeCompare-based
// tricks) — glyph/color assignment must not move between runs.
const fnv1a = (s: string): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function glyphForPlugin(pluginId: string): SkillGlyph {
  return PLUGIN_GLYPHS[fnv1a(pluginId) % PLUGIN_GLYPHS.length] as SkillGlyph
}

export function colorForPlugin(pluginId: string): string {
  return PLUGIN_COLORS[fnv1a(pluginId) % PLUGIN_COLORS.length] as string
}

export type SkillFrontmatter = {
  name?: string
  description?: string
}

const stripQuotes = (v: string): string => {
  const t = v.trim()
  if (t.length >= 2) {
    const first = t[0] as string
    const last = t[t.length - 1] as string
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return t.slice(1, -1)
  }
  return t
}

// Minimal renderer-safe frontmatter reader for SKILL.md files. Handles the
// shapes observed in the wild: `name: foo`, `description: "quoted…"`,
// `description: 'single…'`, and literal/folded blocks (`description: |` /
// `description: >` with indented continuations). Anything else fail-softs
// to {} — the caller falls back to the folder name, never throws.
export function parseSkillFrontmatter(text: string): SkillFrontmatter {
  const out: SkillFrontmatter = {}
  const lines = text.split('\n')
  if (lines.length === 0 || (lines[0] as string).trim() !== '---') return out
  let end = -1
  for (let i = 1; i < lines.length; i += 1) {
    if ((lines[i] as string).trim() === '---') {
      end = i
      break
    }
  }
  if (end === -1) return out
  const body = lines.slice(1, end)
  let i = 0
  while (i < body.length) {
    const line = body[i] as string
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (m === null) {
      i += 1
      continue
    }
    const key = m[1] as string
    const rest = (m[2] as string).trim()
    if (key !== 'name' && key !== 'description') {
      i += 1
      continue
    }
    if (rest === '|' || rest === '>' || rest === '|-' || rest === '>-' || rest === '|+' || rest === '>+') {
      const folded = rest[0] === '>'
      const parts: string[] = []
      i += 1
      while (i < body.length && /^[ \t]/.test(body[i] as string)) {
        parts.push((body[i] as string).trim())
        i += 1
      }
      const value = folded ? parts.join(' ') : parts.join('\n')
      if (value !== '') {
        if (key === 'name') out.name = value
        else out.description = value
      }
      continue
    }
    const value = stripQuotes(rest)
    if (value !== '') {
      if (key === 'name') out.name = value
      else out.description = value
    }
    i += 1
  }
  return out
}

const humanize = (folder: string): string =>
  folder
    .split(/[-_]+/)
    .filter((w) => w !== '')
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
    .join(' ') || folder

// Short plugin name from a package.json `name` field: strips an npm scope
// (@scope/pkg -> pkg). Returns null when the field is missing/not a string.
const shortPackageName = (pkgText: string | null): string | null => {
  if (pkgText === null) return null
  try {
    const parsed: unknown = JSON.parse(pkgText)
    if (typeof parsed !== 'object' || parsed === null) return null
    const name: unknown = (parsed as Record<string, unknown>)['name']
    if (typeof name !== 'string' || name.trim() === '') return null
    const short = name.trim().split('/').pop() as string
    return short === '' ? null : short
  } catch {
    return null
  }
}

// Shape-1 plugin detection (see header): <pkg>/skills is passed as a root
// and the package name is the plugin. Only the exact `skills` basename
// qualifies, so real skill roots (which are ALSO often named `skills`…)
// fall through unless their parent really holds a package.json with a name:
// ~/.claude's parent has none, so ~/.claude/skills stays standalone.
const packagePluginForRoot = (root: string, deps: FsDeps): string | null => {
  const clean = root.replace(/\/+$/, '')
  const base = clean.split('/').pop() ?? ''
  if (base !== 'skills') return null
  const parent = clean.split('/').slice(0, -1).join('/') || '/'
  return shortPackageName(deps.readFile(joinPath(parent, 'package.json')))
}

type FoundSkill = {
  folder: string
  frontmatter: SkillFrontmatter
  hasFile: boolean
}

const readSkillDir = (skillDir: string, deps: FsDeps): FoundSkill | null => {
  const text = deps.readFile(joinPath(skillDir, 'SKILL.md'))
  if (text === null) return null
  const folder = skillDir.replace(/\/+$/, '').split('/').pop() ?? skillDir
  return { folder, frontmatter: parseSkillFrontmatter(text), hasFile: true }
}

const toSummary = (
  found: FoundSkill,
  groupId: string,
  source: 'installed' | 'self-learnt'
): SkillSummary => {
  const id = found.frontmatter.name ?? found.folder
  const summary: SkillSummary = {
    id,
    name: humanize(found.frontmatter.name ?? found.folder),
    source,
    pluginId: groupId === STANDALONE_GROUP_ID ? null : groupId
  }
  if (found.frontmatter.description !== undefined) summary.description = found.frontmatter.description
  // icon is unset: no icon source was diagnosed anywhere (no icon field in
  // any SKILL.md frontmatter observed) — the scene lane owns vial glyphs.
  return summary
}

const byName = (a: SkillSummary, b: SkillSummary): number => {
  const an = a.name.toLowerCase()
  const bn = b.name.toLowerCase()
  if (an < bn) return -1
  if (an > bn) return 1
  if (a.id < b.id) return -1
  if (a.id > b.id) return 1
  return 0
}

export function discoverPlugins(dirs: string[], deps: FsDeps = NULL_DEPS): PluginGroup[] {
  const buckets = new Map<string, SkillSummary[]>()
  const seen = new Set<string>()
  const put = (groupId: string, s: SkillSummary): void => {
    const key = `${groupId}|${s.id}`
    if (seen.has(key)) return
    seen.add(key)
    const list = buckets.get(groupId)
    if (list === undefined) buckets.set(groupId, [s])
    else list.push(s)
  }

  for (const root of dirs) {
    const entries = deps.readdir(root)
    if (entries === null) continue // missing/unreadable root: fail soft
    const pkgPlugin = packagePluginForRoot(root, deps)
    const sorted = [...entries].sort()
    for (const entry of sorted) {
      if (entry === '.' || entry === '..') continue
      const full = joinPath(root, entry)
      if (!deps.isDirectory(full)) continue // stray files fail soft
      const own = readSkillDir(full, deps)
      if (own !== null) {
        // Depth-1 skill: standalone, unless the root is a plugin package's
        // skills/ dir (shape 1) — then the package is the plugin.
        const groupId = pkgPlugin ?? STANDALONE_GROUP_ID
        put(groupId, toSummary(own, groupId, 'installed'))
        continue
      }
      // Depth-2: container without its own SKILL.md whose children are
      // skills — the parent folder (entry) is the plugin.
      const children = deps.readdir(full)
      if (children === null) continue
      for (const child of [...children].sort()) {
        if (child === '.' || child === '..') continue
        const childFull = joinPath(full, child)
        if (!deps.isDirectory(childFull)) continue
        const nested = readSkillDir(childFull, deps)
        if (nested === null) continue
        put(entry, toSummary(nested, entry, 'installed'))
      }
    }
  }

  const groups: PluginGroup[] = []
  const ids = [...buckets.keys()].sort()
  for (const id of ids) {
    if (id === STANDALONE_GROUP_ID) continue
    groups.push({
      id,
      name: humanize(id),
      color: colorForPlugin(id),
      glyph: glyphForPlugin(id),
      skills: (buckets.get(id) as SkillSummary[]).sort(byName)
    })
  }
  const alone = buckets.get(STANDALONE_GROUP_ID)
  if (alone !== undefined) {
    groups.push({
      id: STANDALONE_GROUP_ID,
      name: STANDALONE_GROUP_NAME,
      color: colorForPlugin(STANDALONE_GROUP_ID),
      glyph: glyphForPlugin(STANDALONE_GROUP_ID),
      skills: alone.sort(byName)
    })
  }
  return groups
}

export function discoverSelfLearnt(deps?: SelfLearntDeps): SkillSummary[] {
  // No deps (renderer) or no roots: honest empty. There is no known
  // self-learnt store on this machine (verdict in the header) — returning
  // [] here reports that absence instead of fabricating skills.
  if (deps === undefined) return []
  const roots = deps.roots ?? []
  const out: SkillSummary[] = []
  const seen = new Set<string>()
  for (const root of roots) {
    const entries = deps.readdir(root)
    if (entries === null) continue
    for (const entry of [...entries].sort()) {
      if (entry === '.' || entry === '..') continue
      const full = joinPath(root, entry)
      if (!deps.isDirectory(full)) continue
      const found = readSkillDir(full, deps)
      if (found === null) continue
      const s = toSummary(found, STANDALONE_GROUP_ID, 'self-learnt')
      if (seen.has(s.id)) continue
      seen.add(s.id)
      out.push(s)
    }
  }
  return out.sort(byName)
}
