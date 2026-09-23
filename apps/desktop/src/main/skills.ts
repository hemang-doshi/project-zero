import { readdirSync, readFileSync, statSync } from 'node:fs'
import {
  defaultSkillRoots,
  discoverPlugins,
  discoverSelfLearnt,
  pluginPackageSkillRoots,
  type FsDeps
} from '../renderer/src/routes/skillPlugins'
import type { SkillsDiscoverResult } from '../shared/ipc'

// Main-process skill discovery (Task 37D) over lane B's pure layer. The
// discovery module is renderer-safe AND main-safe (imports nothing), so the
// main process builds the injectable FsDeps in ~3 lines and scans the real
// roots: defaultSkillRoots(HOME) PLUS pluginPackageSkillRoots() over the
// opencode packages cache (lane B's fix report names this composition as
// REQUIRED for the `superpowers` family to appear). Approved learned skills
// are read only from the app-profile directory passed by main; no global
// candidate folder is scanned. Cached per app launch; rescans on explicit
// refresh. Fail-soft: never throws — unreadable roots yield ok:false.
export const nodeSkillFs = (): FsDeps => ({
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

export type SkillDiscoverer = {
  discover: (refresh?: boolean) => SkillsDiscoverResult
}

export function createSkillDiscoverer(
  fs: FsDeps = nodeSkillFs(),
  homeDir?: string,
  learnedRoot?: string
): SkillDiscoverer {
  let cached: SkillsDiscoverResult | null = null
  const discover = (refresh = false): SkillsDiscoverResult => {
    if (!refresh && cached !== null) return cached
    try {
      const home = (homeDir ?? process.env.HOME ?? '').replace(/\/+$/, '')
      const roots = [
        ...defaultSkillRoots(home),
        ...pluginPackageSkillRoots(`${home}/.cache/opencode/packages`, fs)
      ]
      const groups = discoverPlugins(roots, fs)
      const selfLearnt = discoverSelfLearnt({
        ...fs,
        roots: learnedRoot ? [learnedRoot] : []
      })
      const readable = roots.some((root) => fs.readdir(root) !== null)
      cached = readable
        ? { ok: true, groups, selfLearnt, note: null }
        : {
            ok: false,
            groups: [],
            selfLearnt: [],
            note: `No readable skill roots under ${home === '' ? '(unknown home)' : home} — the vial grid is honestly empty.`
          }
    } catch {
      cached = {
        ok: false,
        groups: [],
        selfLearnt: [],
        note: 'Skill discovery failed; the vial grid is honestly empty.'
      }
    }
    return cached
  }
  return { discover }
}
