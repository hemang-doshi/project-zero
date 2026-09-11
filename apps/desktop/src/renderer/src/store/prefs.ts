import { create } from 'zustand'
import type { Rect } from '../../../shared/desktop-windows'
import { isSnapEntry, type SnapEntry } from '../../../shared/desktop-snap'
import type { WallpaperState } from '../desktop/wallpaper'
import type { CanvasBounds } from './windows'
import { migrateIconsToGrid, snapIconToGrid } from '../desktop/items'
import { useWindows } from './windows'

type DesktopPrefsData = {
  wallpaper: WallpaperState
  icons: Record<string, { x: number; y: number }>
  windows: Record<string, Rect>
  snaps: Record<string, SnapEntry>
  loaded: boolean
}

const DEFAULT_WALLPAPER: WallpaperState = { kind: 'dotted-green', mode: 'cover' }

export const useDesktopPrefs = create<DesktopPrefsData>(() => ({
  wallpaper: { ...DEFAULT_WALLPAPER },
  icons: {},
  windows: {},
  snaps: {},
  loaded: false
}))

type PrefsPayload = {
  wallpaper?: Partial<WallpaperState>
  icons?: Record<string, { x: number; y: number }>
  windows?: Record<string, Rect>
  snaps?: Record<string, SnapEntry>
}

export async function hydrateDesktopPrefs(bounds?: CanvasBounds): Promise<void> {
  let p: PrefsPayload | null = null
  try {
    p = (await window.zero.invoke('prefs.get')) as PrefsPayload | null
  } catch {
    return
  }
  const wallpaper = p?.wallpaper ?? {}
  // One-way migration: free-placed positions from before grid snap round to
  // their nearest slot on load.
  const icons = migrateIconsToGrid(p?.icons ?? {})
  const windows = p?.windows ?? {}
  // Snap reload recomputes from the kind against the CURRENT canvas, never
  // from stored pixels — the persisted windows rects for snapped routes are
  // stale the moment the viewport size changes.
  const snaps: Record<string, SnapEntry> = {}
  for (const [route, entry] of Object.entries(p?.snaps ?? {})) {
    if (isSnapEntry(entry)) snaps[route] = { kind: entry.kind, preSnap: { ...entry.preSnap } }
  }
  useDesktopPrefs.setState({
    wallpaper: {
      kind: wallpaper.kind ?? DEFAULT_WALLPAPER.kind,
      path: wallpaper.path,
      mode: wallpaper.mode ?? DEFAULT_WALLPAPER.mode
    },
    icons,
    windows,
    snaps,
    loaded: true
  })
  useWindows.setState((prev) => ({ rects: { ...prev.rects, ...windows } }))
  if (bounds !== undefined && Object.keys(snaps).length > 0) {
    useWindows.getState().hydrateSnaps(snaps, bounds)
  }
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
  // Persisted positions are always grid slots — snap at the store boundary so
  // even a free-placed caller can never write a free position.
  const slot = snapIconToGrid({ x, y })
  useDesktopPrefs.setState((prev) => ({ icons: { ...prev.icons, [id]: slot } }))
  void window.zero.invoke('prefs.set', { icons: { [id]: slot } }).catch(() => {})
}

export function setWindowRect(route: string, rect: Rect): void {
  useDesktopPrefs.setState((prev) => ({ windows: { ...prev.windows, [route]: rect } }))
  void window.zero.invoke('prefs.set', { windows: { [route]: rect } }).catch(() => {})
}

export function setWindowSnap(route: string, entry: SnapEntry | null): void {
  useDesktopPrefs.setState((prev) => {
    const snaps = { ...prev.snaps }
    if (entry) snaps[route] = { kind: entry.kind, preSnap: { ...entry.preSnap } }
    else delete snaps[route]
    return { snaps }
  })
  // A null entry deletes the key on the main side (merge-only patch).
  void window.zero.invoke('prefs.set', { snaps: { [route]: entry } }).catch(() => {})
}
