import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  hydrateDesktopPrefs,
  setIconPosition,
  setWallpaper,
  setWindowRect,
  useDesktopPrefs
} from './prefs'
import { initialWindows, useWindows } from './windows'

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
    wallpaper: { kind: 'dotted-green', mode: 'cover' },
    icons: {},
    windows: {},
    loaded: false
  })
})

describe('hydrateDesktopPrefs', () => {
  it('loads wallpaper, icon slots and window rects via prefs.get', async () => {
    const zero = stubZero(
      vi.fn(() =>
        Promise.resolve({
          wallpaper: { kind: 'canvas-tan', mode: 'cover' },
          icons: { 'icon-desk': { x: 112, y: 28 } },
          windows: { desk: { x: 5, y: 6, w: 560, h: 480 } }
        })
      )
    )
    await hydrateDesktopPrefs()
    expect(zero.invoke).toHaveBeenCalledWith('prefs.get')
    expect(useDesktopPrefs.getState().wallpaper).toEqual({ kind: 'canvas-tan', mode: 'cover' })
    expect(useDesktopPrefs.getState().icons['icon-desk']).toEqual({ x: 112, y: 28 })
    expect(useDesktopPrefs.getState().loaded).toBe(true)
    expect(useWindows.getState().rects.desk).toEqual({ x: 5, y: 6, w: 560, h: 480 })
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
})
