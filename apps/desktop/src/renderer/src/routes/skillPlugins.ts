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
// PLUGIN-GROUPING RULE, fix round 1 (binding for discoverPlugins). The
// round-0 "parent folder only" rule yielded a single plugin group (.system)
// because the real shapes hide families in three more places — verified
// against the actual dirs on 2026-09-11 (see counts in the header):
//   - superpowers (14 skills) lives ONLY in the opencode plugin cache
//     <cache>/…/node_modules/superpowers/skills/<skill>/SKILL.md, with
//     package.json `name: superpowers` next door. Fix: the main process
//     composes roots as
//       [...defaultSkillRoots(home),
//        ...pluginPackageSkillRoots(home + '/.cache/opencode/packages', deps)]
//     and the pre-existing package-manifest rule attributes that root to
//     `superpowers`. pluginPackageSkillRoots is a bounded recursive search
//     for exactly that shape (a `skills/` dir whose parent package.json
//     names it) — no hardcoded package names, no hardcoded cache layout.
//   - gstack appears twice: (a) 53 vendored `gstack-*` folders in
//     ~/.codex/skills whose frontmatter names are BARE (`name: browse`),
//     so the family key MUST be the folder name, never the frontmatter id;
//     (b) the `gstack` repo-symlink container holds 54 skill children whose
//     folders match the flat installs (`browse`, `autoplan`, …). Fix:
//     `<container>-*` folder prefixes join the container's family, and a
//     flat skill whose id or folder matches a container's child roster
//     migrates into that container's family. Prefixes only fire for
//     containers actually seen in the scanned roots (data-driven, not a
//     `gstack` special-case); longest container id wins ties.
//   - playwright is a singleton with NO discoverable family shape (verified
//     byte-for-byte comparable to `watch`: rich flat dir in
//     ~/.codex/skills + symlink in skills-codex). The owner explicitly
//     expects the vial, so SINGLETON_FAMILIES curates it — one entry, pinned
//     by test, documented here instead of hidden in code.
// Precedence (first match wins): package-manifest binding > container-nested
// children > singleton curation > `<container>-` prefix > container roster >
// standalone. Same-(group, id) duplicates collapse first-sight-wins; when a
// skill is both nested and flat, the nested copy wins (plugin identity is
// the stronger signal; the flat is usually the manager's mirror).
// Deliberately NOT grouped: `hyperframes-*`, `gsap-*`, `supabase-*`,
// `plan-*`, `design-*` and friends share name stems but have no container,
// no manifest, and no roster anywhere — bare SKILL.md installs with related
// names stay `standalone` per the acceptance criteria (a stem-guessing rule
// would fabricate families like `run` for run-jobs-*/run-weekly-*).
// Deterministic throughout: roots in order, entries sorted, groups A–Z with
// `standalone` last, skills by (lowercased name, id).
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

// Owner-directed singleton families: flat skills that form a vial of their
// own despite having no discoverable family shape. `playwright` is the only
// entry: verified structurally identical to `watch` (rich flat dir in
// ~/.codex/skills plus a skills-codex symlink), so no structural rule can
// separate them — curation is the honest mechanism. Extend only on explicit
// owner direction; everything else stays `standalone`.
export const SINGLETON_FAMILIES: readonly string[] = ['playwright']

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

// Bounded recursive search for plugin-package skills dirs under an opencode
// packages cache: any `skills/` directory whose parent package.json names it
// (the superpowers shape diagnosed above). Returns sorted absolute paths for
// the caller to append to defaultSkillRoots — discoverPlugins then applies
// its package-manifest rule with no further special cases. Collected `skills`
// dirs are not descended into; anything else recurses to maxDepth.
export function pluginPackageSkillRoots(
  packagesDir: string,
  deps: FsDeps = NULL_DEPS,
  maxDepth = 6
): string[] {
  const out: string[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return
    const entries = deps.readdir(dir)
    if (entries === null) return
    for (const entry of [...entries].sort()) {
      if (entry === '.' || entry === '..') continue
      const full = joinPath(dir, entry)
      if (!deps.isDirectory(full)) continue
      if (entry === 'skills' && packagePluginForRoot(full, deps) !== null) {
        out.push(full)
        continue
      }
      walk(full, depth + 1)
    }
  }
  walk(packagesDir, 0)
  return out
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
  // Phase 1 — collect. One readdir per directory (cached): family decisions
  // in phase 2 need every container known before any flat skill is assigned.
  const listed = new Map<string, string[] | null>()
  const list = (dir: string): string[] | null => {
    const hit = listed.get(dir)
    if (hit !== undefined) return hit
    const entries = deps.readdir(dir)
    listed.set(dir, entries)
    return entries
  }
  type Flat = { folder: string; found: FoundSkill; pkgPlugin: string | null }
  type Container = { id: string; children: FoundSkill[]; roster: Set<string> }
  const flats: Flat[] = []
  const containers: Container[] = []
  for (const root of dirs) {
    const entries = list(root)
    if (entries === null) continue // missing/unreadable root: fail soft
    const pkgPlugin = packagePluginForRoot(root, deps)
    for (const entry of [...entries].sort()) {
      if (entry === '.' || entry === '..') continue
      const full = joinPath(root, entry)
      if (!deps.isDirectory(full)) continue // stray files fail soft
      const own = readSkillDir(full, deps)
      if (pkgPlugin !== null) {
        // Shape-1 package layout: depth-1 skills only, never descended.
        if (own !== null) flats.push({ folder: entry, found: own, pkgPlugin })
        continue
      }
      // Container children are collected even when the container carries its
      // own SKILL.md (the `gstack` symlink shape): the roster is what lets
      // the flat installs of the same family migrate home. The container's
      // own skill still counts as a flat candidate, decided in phase 2.
      const kids = list(full) ?? []
      const childSkills: FoundSkill[] = []
      for (const child of [...kids].sort()) {
        if (child === '.' || child === '..') continue
        const childFull = joinPath(full, child)
        if (!deps.isDirectory(childFull)) continue
        const nested = readSkillDir(childFull, deps)
        if (nested !== null) childSkills.push(nested)
      }
      if (childSkills.length > 0) {
        containers.push({
          id: entry,
          children: childSkills,
          roster: new Set(childSkills.map((c) => c.folder))
        })
      }
      if (own !== null) flats.push({ folder: entry, found: own, pkgPlugin: null })
    }
  }

  // Phase 2 — assign by precedence: package binding (already on the flat) >
  // container-nested children > singleton curation > `<container>-` folder
  // prefix > container roster > standalone.
  const containerIds = [...new Set(containers.map((c) => c.id))].sort()
  const roster = new Map<string, string>() // child folder -> container id
  for (const c of containers) {
    for (const folder of [...c.roster].sort()) {
      if (!roster.has(folder)) roster.set(folder, c.id)
    }
  }
  // Prefix families key on the FOLDER name (vendored `gstack-*` folders carry
  // bare frontmatter ids — the folder is the only family signal). Only fires
  // for containers actually seen; longest container id wins ties.
  const prefixFamily = (folder: string): string | null => {
    let best: string | null = null
    for (const id of containerIds) {
      if (folder.length > id.length + 1 && folder.startsWith(`${id}-`)) {
        if (best === null || id.length > best.length) best = id
      }
    }
    return best
  }

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

  // Nested copies win dedupe over flat mirrors of the same (group, id).
  for (const c of containers) {
    for (const child of c.children) put(c.id, toSummary(child, c.id, 'installed'))
  }
  for (const f of flats) {
    if (f.pkgPlugin !== null) {
      put(f.pkgPlugin, toSummary(f.found, f.pkgPlugin, 'installed'))
      continue
    }
    const id = f.found.frontmatter.name ?? f.folder
    if ((SINGLETON_FAMILIES as readonly string[]).includes(id)) {
      put(id, toSummary(f.found, id, 'installed'))
      continue
    }
    const prefix = prefixFamily(f.folder)
    if (prefix !== null) {
      put(prefix, toSummary(f.found, prefix, 'installed'))
      continue
    }
    const rosterHit = roster.get(id) ?? roster.get(f.folder) ?? null
    if (rosterHit !== null) {
      put(rosterHit, toSummary(f.found, rosterHit, 'installed'))
      continue
    }
    put(STANDALONE_GROUP_ID, toSummary(f.found, STANDALONE_GROUP_ID, 'installed'))
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
