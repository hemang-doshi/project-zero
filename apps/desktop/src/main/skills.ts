import { readdirSync, readFileSync, statSync } from 'node:fs'
import {
  candidateSelfLearntRoots,
  defaultSkillRoots,
  discoverPlugins,
  discoverSelfLearnt,
  pluginPackageSkillRoots,
  type FsDeps
} from '../renderer/src/routes/skillPlugins'
import type { SkillsDiscoverResult } from '../shared/ipc'

// Main-process skill discovery uses injectable filesystem dependencies. It
// scans the default user roots and OpenCode package cache. Learned roots remain
// empty until a durable source is defined. Results are cached per app launch,
// with an explicit refresh path; unreadable roots yield ok:false.
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
  homeDir?: string
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
      const selfLearnt = discoverSelfLearnt({ ...fs, roots: candidateSelfLearntRoots(home) })
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
