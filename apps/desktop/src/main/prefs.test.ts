import { it, expect, describe } from 'vitest'
import { PrefsStore, applyPrefsPatch, defaultPrefs, startupMigrate, type Prefs } from './prefs'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

it('quarantines corrupt prefs and reseeds defaults', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-prefs-'))
  fs.writeFileSync(path.join(dir, 'prefs.json'), '{not json')
  const store = new PrefsStore(dir)
  const p = store.load()
  expect(p).toEqual(defaultPrefs())
  expect(fs.readdirSync(dir).some((f) => f.startsWith('prefs.json.corrupt-'))).toBe(true)
  expect(store.load().version).toBe(1)
})

describe('prefs round-trip', () => {
  it('returns defaults when no file exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-prefs-'))
    expect(new PrefsStore(dir).load()).toEqual(defaultPrefs())
  })
  it('survives save and load across store instances', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-prefs-'))
    const p = defaultPrefs()
    p.icons['icon-desk'] = { x: 10, y: 20 }
    p.wallpaper = { kind: 'cream', mode: 'cover' }
    p.windows.network = { x: 1, y: 2, w: 560, h: 480 }
    new PrefsStore(dir).save(p)
    expect(new PrefsStore(dir).load()).toEqual(p)
  })
})

describe('applyPrefsPatch', () => {
  it('rejects a wholly malformed patch', () => {
    for (const bad of [null, 'x', 5, [], true]) {
      expect(() => applyPrefsPatch(defaultPrefs(), bad)).toThrow('Malformed prefs payload')
    }
  })
  it('replaces the wallpaper only with a valid full object', () => {
    const next = applyPrefsPatch(defaultPrefs(), {
      wallpaper: { kind: 'custom', path: '/a/b.png', mode: 'tile' }
    })
    expect(next.wallpaper).toEqual({ kind: 'custom', path: '/a/b.png', mode: 'tile' })
  })
  it('drops malformed wallpaper, icons and windows fields (fail-soft)', () => {
    const base = defaultPrefs()
    const next = applyPrefsPatch(base, {
      wallpaper: { kind: 'nope' },
      icons: { good: { x: 1, y: 2 }, bad: { x: 'z' }, worse: 5 },
      windows: { good: { x: 0, y: 0, w: 560, h: 480 }, bad: { x: 1 } },
      unknown: 'ignored'
    })
    expect(next.wallpaper).toEqual(base.wallpaper)
    expect(next.icons).toEqual({ good: { x: 1, y: 2 } })
    expect(next.windows.good).toEqual({ x: 0, y: 0, w: 560, h: 480 })
    expect(Object.hasOwn(next, 'unknown')).toBe(false)
  })
  it('merges icon and window entries without losing untouched ones', () => {
    const base = defaultPrefs()
    base.icons['icon-desk'] = { x: 4, y: 4 }
    const next = applyPrefsPatch(base, { icons: { 'icon-runtime': { x: 9, y: 9 } } })
    expect(next.icons).toEqual({ 'icon-desk': { x: 4, y: 4 }, 'icon-runtime': { x: 9, y: 9 } })
    expect(next.windows.desk).toEqual(base.windows.desk)
  })
})

describe('startupMigrate', () => {
  it('migrates stacked origins and stamps the layout version before persisting', () => {
    const p = defaultPrefs()
    p.layoutVersion = 1
    const out = startupMigrate(p)
    expect(out.layoutVersion).toBe(2)
    expect(out.windows.runtime).toEqual({ x: 80, y: 80, w: 560, h: 480 })
  })
  it('seeds migration in canonical route order regardless of stored key order', () => {
    const scrambled: Prefs = {
      ...defaultPrefs(),
      windows: {
        skillLab: { x: 28, y: 28, w: 560, h: 480 },
        network: { x: 28, y: 28, w: 560, h: 480 },
        desk: { x: 28, y: 28, w: 560, h: 480 },
        runtime: { x: 28, y: 28, w: 560, h: 480 }
      },
      layoutVersion: 1
    }
    const canonical: Prefs = {
      ...defaultPrefs(),
      windows: {
        desk: { x: 28, y: 28, w: 560, h: 480 },
        runtime: { x: 28, y: 28, w: 560, h: 480 },
        network: { x: 28, y: 28, w: 560, h: 480 },
        skillLab: { x: 28, y: 28, w: 560, h: 480 }
      },
      layoutVersion: 1
    }
    expect(startupMigrate(scrambled)).toEqual(startupMigrate(canonical))
  })
})
