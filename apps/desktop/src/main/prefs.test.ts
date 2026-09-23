import { it, expect, describe } from 'vitest'
import {
  PrefsStore,
  applyPrefsPatch,
  defaultPrefs,
  snapIconToGrid as snapMain,
  startupMigrate,
  type Prefs
} from './prefs'
import { snapIconToGrid as snapRenderer } from '../renderer/src/desktop/items'
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
  it('persists only supported appearance themes', () => {
    expect(applyPrefsPatch(defaultPrefs(), { theme: 'dark' }).theme).toBe('dark')
    expect(applyPrefsPatch({ ...defaultPrefs(), theme: 'dark' }, { theme: 'sepia' }).theme).toBe(
      'dark'
    )
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
  it('drops array-valued icons and windows fields (fail-soft)', () => {
    const next = applyPrefsPatch(defaultPrefs(), { icons: [1, 2], windows: [] })
    expect(next.icons).toEqual({})
    expect(next.windows).toEqual(defaultPrefs().windows)
  })
  it('merges icon and window entries without losing untouched ones', () => {
    const base = defaultPrefs()
    base.icons['icon-desk'] = { x: 4, y: 4 }
    const next = applyPrefsPatch(base, { icons: { 'icon-runtime': { x: 9, y: 9 } } })
    expect(next.icons).toEqual({ 'icon-desk': { x: 4, y: 4 }, 'icon-runtime': { x: 9, y: 9 } })
    expect(next.windows.desk).toEqual(base.windows.desk)
  })
  it('stores valid snap records (kind + pre-snap rect, never pixels)', () => {
    const next = applyPrefsPatch(defaultPrefs(), {
      snaps: { desk: { kind: 'left', preSnap: { x: 40, y: 50, w: 600, h: 500 } } }
    })
    expect(next.snaps.desk).toEqual({
      kind: 'left',
      preSnap: { x: 40, y: 50, w: 600, h: 500 }
    })
  })
  it('drops malformed snap records fail-soft and keeps the good ones', () => {
    const next = applyPrefsPatch(defaultPrefs(), {
      snaps: {
        good: { kind: 'right', preSnap: { x: 1, y: 2, w: 560, h: 480 } },
        badKind: { kind: 'diagonal', preSnap: { x: 1, y: 2, w: 560, h: 480 } },
        badRect: { kind: 'left', preSnap: { x: 1 } },
        badShape: 5
      }
    })
    expect(next.snaps).toEqual({
      good: { kind: 'right', preSnap: { x: 1, y: 2, w: 560, h: 480 } }
    })
  })
  it('a null snap entry deletes the key so un-snap erases with a merge patch', () => {
    const base = defaultPrefs()
    base.snaps = { desk: { kind: 'left', preSnap: { x: 1, y: 2, w: 560, h: 480 } } }
    const next = applyPrefsPatch(base, { snaps: { desk: null } })
    expect(next.snaps).toEqual({})
  })
  it('ignores a non-object snaps field', () => {
    const next = applyPrefsPatch(defaultPrefs(), { snaps: [] })
    expect(next.snaps).toEqual({})
  })
})

it('migrates legacy preferences to the light theme', () => {
  const legacy = { ...defaultPrefs(), theme: undefined } as unknown as Prefs
  expect(startupMigrate(legacy).theme).toBe('light')
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
  it('rounds free-placed icon positions to their grid slot on load (one-way)', () => {
    const p = defaultPrefs()
    p.icons = { 'icon-desk': { x: 200, y: 90 }, 'icon-runtime': { x: 112, y: 28 } }
    const out = startupMigrate(p)
    expect(out.icons).toEqual({
      'icon-desk': { x: 200, y: 124 },
      'icon-runtime': { x: 112, y: 28 }
    })
  })
  it('uses the same slot math as the renderer seed grid (no second grid)', () => {
    const samples = [
      { x: 0, y: 0 },
      { x: 24, y: 28 },
      { x: 200, y: 90 },
      { x: 150, y: 200 },
      { x: 40, y: 44 },
      { x: 500, y: 600 }
    ]
    for (const s of samples) {
      expect(snapMain(s)).toEqual(snapRenderer(s))
    }
  })
  it('passes snap records through untouched and stamps the field when missing', () => {
    const p = defaultPrefs()
    p.snaps = { desk: { kind: 'left', preSnap: { x: 1, y: 2, w: 560, h: 480 } } }
    expect(startupMigrate(p).snaps).toEqual(p.snaps)
    const legacy = { ...defaultPrefs(), snaps: undefined as unknown as Prefs['snaps'] }
    expect(startupMigrate(legacy).snaps).toEqual({})
  })
})
