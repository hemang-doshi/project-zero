import { create } from 'zustand'
import type { Rect } from '../../../shared/desktop-windows'
import type { WallpaperState } from '../desktop/wallpaper'
import { useWindows } from './windows'

type DesktopPrefsData = {
  wallpaper: WallpaperState
  icons: Record<string, { x: number; y: number }>
  windows: Record<string, Rect>
  loaded: boolean
}

const DEFAULT_WALLPAPER: WallpaperState = { kind: 'dotted-green', mode: 'cover' }

export const useDesktopPrefs = create<DesktopPrefsData>(() => ({
  wallpaper: { ...DEFAULT_WALLPAPER },
  icons: {},
  windows: {},
  loaded: false
}))

type PrefsPayload = {
  wallpaper?: Partial<WallpaperState>
  icons?: Record<string, { x: number; y: number }>
  windows?: Record<string, Rect>
}

export async function hydrateDesktopPrefs(): Promise<void> {
  let p: PrefsPayload | null = null
  try {
    p = (await window.zero.invoke('prefs.get')) as PrefsPayload | null
  } catch {
    return
  }
  const wallpaper = p?.wallpaper ?? {}
  const icons = p?.icons ?? {}
  const windows = p?.windows ?? {}
  useDesktopPrefs.setState({
    wallpaper: {
      kind: wallpaper.kind ?? DEFAULT_WALLPAPER.kind,
      path: wallpaper.path,
      mode: wallpaper.mode ?? DEFAULT_WALLPAPER.mode
    },
    icons,
    windows,
    loaded: true
  })
  useWindows.setState((prev) => ({ rects: { ...prev.rects, ...windows } }))
}

export function setWallpaper(next: WallpaperState): void {
  const wallpaper: WallpaperState =
    next.kind === 'custom'
      ? { kind: next.kind, path: next.path, mode: next.mode }
      : { kind: next.kind, mode: next.mode }
  useDesktopPrefs.setState({ wallpaper })
  void window.zero.invoke('prefs.set', { wallpaper }).catch(() => {})
}

export function setIconPosition(id: string, x: number, y: number): void {
  useDesktopPrefs.setState((prev) => ({ icons: { ...prev.icons, [id]: { x, y } } }))
  void window.zero.invoke('prefs.set', { icons: { [id]: { x, y } } }).catch(() => {})
}

export function setWindowRect(route: string, rect: Rect): void {
  useDesktopPrefs.setState((prev) => ({ windows: { ...prev.windows, [route]: rect } }))
  void window.zero.invoke('prefs.set', { windows: { [route]: rect } }).catch(() => {})
}
