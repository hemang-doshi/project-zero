import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  hydrateDesktopPrefs,
  setIconPosition,
  setTheme,
  setWallpaper,
  setWindowRect,
  setWindowSnap,
  useDesktopPrefs
} from './prefs'
import { getSnapEntry, initialWindows, useWindows } from './windows'

type FakeZero = { invoke: ReturnType<typeof vi.fn> }

const stubZero = (invoke: FakeZero['invoke']): FakeZero => {
  const zero = { invoke }
  ;(globalThis as unknown as { window?: { zero?: FakeZero } }).window = { zero }
  return zero
}

const resetWindow = (): void => {
  delete (globalThis as unknown as { window?: unknown }).window
}

afterEach(() => {
  resetWindow()
  useWindows.setState(initialWindows())
  useDesktopPrefs.setState({
    theme: 'light',
    wallpaper: { kind: 'dotted-green', mode: 'cover' },
    icons: {},
    windows: {},
    snaps: {},
    loaded: false
  })
})

describe('hydrateDesktopPrefs', () => {
  it('loads wallpaper, icon slots and window rects via prefs.get', async () => {
    const zero = stubZero(
      vi.fn(() =>
        Promise.resolve({
          wallpaper: { kind: 'canvas-tan', mode: 'cover' },
          theme: 'dark',
          icons: { 'icon-desk': { x: 112, y: 28 } },
          windows: { desk: { x: 5, y: 6, w: 560, h: 480 } }
        })
      )
    )
    await hydrateDesktopPrefs()
    expect(zero.invoke).toHaveBeenCalledWith('prefs.get')
    expect(useDesktopPrefs.getState().wallpaper).toEqual({ kind: 'canvas-tan', mode: 'cover' })
    expect(useDesktopPrefs.getState().theme).toBe('dark')
    expect(useDesktopPrefs.getState().icons['icon-desk']).toEqual({ x: 112, y: 28 })
    expect(useDesktopPrefs.getState().loaded).toBe(true)
    expect(useWindows.getState().rects.desk).toEqual({ x: 5, y: 6, w: 560, h: 480 })
  })

  it('writes theme changes through prefs.set', () => {
    const zero = stubZero(vi.fn(() => Promise.resolve({})))
    setTheme('dark')
    expect(useDesktopPrefs.getState().theme).toBe('dark')
    expect(zero.invoke).toHaveBeenCalledWith('prefs.set', { theme: 'dark' })
  })

  it('rounds free-placed icon positions to their grid slot on load (one-way)', async () => {
    stubZero(
      vi.fn(() =>
        Promise.resolve({
          wallpaper: { kind: 'dotted-green', mode: 'cover' },
          icons: { 'icon-desk': { x: 200, y: 90 } },
          windows: {}
        })
      )
    )
    await hydrateDesktopPrefs()
    expect(useDesktopPrefs.getState().icons['icon-desk']).toEqual({ x: 200, y: 124 })
  })

  it('keeps the seeded defaults when prefs.get resolves an empty shell', async () => {
    stubZero(vi.fn(() => Promise.resolve({})))
    await hydrateDesktopPrefs()
    expect(useDesktopPrefs.getState().wallpaper).toEqual({ kind: 'dotted-green', mode: 'cover' })
  })

  it('a stored custom wallpaper with no explicit mode hydrates to cover', async () => {
    const zero = stubZero(
      vi.fn(() =>
        Promise.resolve({
          wallpaper: { kind: 'custom', path: '/w.png' },
          icons: {},
          windows: {}
        })
      )
    )
    await hydrateDesktopPrefs()
    expect(zero.invoke).toHaveBeenCalledWith('prefs.get')
    expect(useDesktopPrefs.getState().wallpaper).toEqual({
      kind: 'custom',
      path: '/w.png',
      mode: 'cover'
    })
  })

  it('stays on the seeded defaults when the invoke rejects (fail-soft)', async () => {
    stubZero(vi.fn(() => Promise.reject(new Error('handler error'))))
    await expect(hydrateDesktopPrefs()).resolves.toBeUndefined()
    expect(useDesktopPrefs.getState().loaded).toBe(false)
    expect(useDesktopPrefs.getState().wallpaper.kind).toBe('dotted-green')
  })
})

describe('persisting actions', () => {
  it('setWallpaper updates state and persists the full wallpaper patch', () => {
    const zero = stubZero(vi.fn(() => Promise.resolve({})))
    setWallpaper({ kind: 'custom', path: '/w.png', mode: 'tile' })
    expect(useDesktopPrefs.getState().wallpaper).toEqual({
      kind: 'custom',
      path: '/w.png',
      mode: 'tile'
    })
    expect(zero.invoke).toHaveBeenCalledWith('prefs.set', {
      wallpaper: { kind: 'custom', path: '/w.png', mode: 'tile' }
    })
  })
  it('setWallpaper drops the path for bundled kinds', () => {
    const zero = stubZero(vi.fn(() => Promise.resolve({})))
    setWallpaper({ kind: 'cream', mode: 'cover' })
    expect(zero.invoke).toHaveBeenCalledWith('prefs.set', {
      wallpaper: { kind: 'cream', mode: 'cover' }
    })
  })
  it('setIconPosition snaps to the slot and persists just that entry', () => {
    const zero = stubZero(vi.fn(() => Promise.resolve({})))
    setIconPosition('icon-desk', 40, 80)
    expect(useDesktopPrefs.getState().icons['icon-desk']).toEqual({ x: 24, y: 124 })
    expect(zero.invoke).toHaveBeenCalledWith('prefs.set', {
      icons: { 'icon-desk': { x: 24, y: 124 } }
    })
  })
  it('setWindowRect remembers the rect and persists it per commit', () => {
    const zero = stubZero(vi.fn(() => Promise.resolve({})))
    setWindowRect('desk', { x: 1, y: 2, w: 560, h: 480 })
    expect(useDesktopPrefs.getState().windows.desk).toEqual({ x: 1, y: 2, w: 560, h: 480 })
    expect(zero.invoke).toHaveBeenCalledWith('prefs.set', {
      windows: { desk: { x: 1, y: 2, w: 560, h: 480 } }
    })
  })
  it('setWindowSnap remembers the entry and persists it per snap', () => {
    const zero = stubZero(vi.fn(() => Promise.resolve({})))
    setWindowSnap('desk', { kind: 'left', preSnap: { x: 1, y: 2, w: 560, h: 480 } })
    expect(useDesktopPrefs.getState().snaps.desk).toEqual({
      kind: 'left',
      preSnap: { x: 1, y: 2, w: 560, h: 480 }
    })
    expect(zero.invoke).toHaveBeenCalledWith('prefs.set', {
      snaps: { desk: { kind: 'left', preSnap: { x: 1, y: 2, w: 560, h: 480 } } }
    })
  })
  it('setWindowSnap with null clears the entry and persists the deletion', () => {
    const zero = stubZero(vi.fn(() => Promise.resolve({})))
    setWindowSnap('desk', { kind: 'left', preSnap: { x: 1, y: 2, w: 560, h: 480 } })
    setWindowSnap('desk', null)
    expect(useDesktopPrefs.getState().snaps).toEqual({})
    expect(zero.invoke).toHaveBeenCalledWith('prefs.set', { snaps: { desk: null } })
  })
})

describe('snap persistence round-trip', () => {
  it('re-snaps against the current canvas, not the stored pixels', async () => {
    stubZero(
      vi.fn(() =>
        Promise.resolve({
          wallpaper: { kind: 'dotted-green', mode: 'cover' },
          icons: {},
          // Stale pixels from a 900-wide canvas; the canvas is now 1000 wide.
          windows: { desk: { x: 0, y: 0, w: 450, h: 638 } },
          snaps: { desk: { kind: 'left', preSnap: { x: 40, y: 50, w: 600, h: 500 } } }
        })
      )
    )
    await hydrateDesktopPrefs({ w: 1000, h: 700 })
    expect(useWindows.getState().rects.desk).toEqual({ x: 0, y: 0, w: 500, h: 700 })
    expect(useWindows.getState().snapped).toEqual({ desk: 'left' })
    expect(getSnapEntry('desk')).toEqual({
      kind: 'left',
      preSnap: { x: 40, y: 50, w: 600, h: 500 }
    })
    expect(useDesktopPrefs.getState().snaps.desk).toEqual({
      kind: 'left',
      preSnap: { x: 40, y: 50, w: 600, h: 500 }
    })
  })

  it('records snaps without recomputing when no bounds are given', async () => {
    stubZero(
      vi.fn(() =>
        Promise.resolve({
          wallpaper: { kind: 'dotted-green', mode: 'cover' },
          icons: {},
          windows: { desk: { x: 0, y: 0, w: 450, h: 638 } },
          snaps: { desk: { kind: 'left', preSnap: { x: 40, y: 50, w: 600, h: 500 } } }
        })
      )
    )
    await hydrateDesktopPrefs()
    expect(useDesktopPrefs.getState().snaps.desk?.kind).toBe('left')
    expect(useWindows.getState().snapped).toEqual({})
    expect(useWindows.getState().rects.desk).toEqual({ x: 0, y: 0, w: 450, h: 638 })
  })

  it('drops malformed snap entries fail-soft on load', async () => {
    stubZero(
      vi.fn(() =>
        Promise.resolve({
          wallpaper: { kind: 'dotted-green', mode: 'cover' },
          icons: {},
          windows: {},
          snaps: {
            good: { kind: 'right', preSnap: { x: 1, y: 2, w: 560, h: 480 } },
            bad: { kind: 'diagonal', preSnap: { x: 1, y: 2, w: 3, h: 4 } }
          }
        })
      )
    )
    await hydrateDesktopPrefs({ w: 900, h: 638 })
    expect(useWindows.getState().snapped).toEqual({ good: 'right' })
    expect(useDesktopPrefs.getState().snaps).toEqual({
      good: { kind: 'right', preSnap: { x: 1, y: 2, w: 560, h: 480 } }
    })
  })
})
