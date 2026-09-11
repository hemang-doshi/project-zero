import { create } from 'zustand'
import {
  DEFAULT_SIZE,
  cascadeOffset,
  clampSize,
  fallbackSelection,
  launchOrigins,
  type Rect
} from '../../../shared/desktop-windows'
import {
  isSnapEntry,
  snapRectFor,
  type SnapEntry,
  type SnapKind
} from '../../../shared/desktop-snap'

export type CanvasBounds = { w: number; h: number }

const SEED_ROUTES = ['desk', 'runtime'] as const

const seedRects = (): Record<string, Rect> => {
  const origins = launchOrigins(SEED_ROUTES.length)
  return Object.fromEntries(SEED_ROUTES.map((r, i) => [r, { ...DEFAULT_SIZE, ...origins[i] }]))
}

export type WindowsData = {
  open: string[]
  zOrder: string[]
  minimized: string[]
  maximized: string[]
  snapped: Record<string, SnapKind>
  selected: string
  rects: Record<string, Rect>
}

export type WindowsState = WindowsData & {
  focus: (route: string) => void
  openRoute: (route: string, rect?: Rect) => void
  openFile: (id: string, rect?: Rect) => void
  close: (route: string) => void
  minimize: (route: string) => void
  maximize: (route: string, bounds: CanvasBounds) => void
  snap: (route: string, kind: SnapKind, bounds: CanvasBounds) => void
  unsnap: (route: string) => void
  hydrateSnaps: (entries: Record<string, SnapEntry>, bounds: CanvasBounds) => void
  refit: (bounds: CanvasBounds) => void
  commit: (route: string, rect: Rect) => void
}

export function initialWindows(): WindowsData {
  return {
    open: [...SEED_ROUTES],
    zOrder: [...SEED_ROUTES],
    minimized: [],
    maximized: [],
    snapped: {},
    selected: SEED_ROUTES[SEED_ROUTES.length - 1],
    rects: seedRects()
  }
}

// Pre-maximize rects, one per route, module-level like the store itself:
// maximized state is deliberately not persisted (Task 8 ruling).
const resting: Record<string, Rect> = {}

// Pre-snap rects, same discipline: the live snap kind lives in the store
// (and in prefs for reload), the resting rect lives here beside it.
const snapResting: Record<string, Rect> = {}

export function getSnapEntry(route: string): SnapEntry | null {
  const kind = useWindows.getState().snapped[route]
  const preSnap = snapResting[route]
  if (kind === undefined || preSnap === undefined) return null
  return { kind, preSnap: { ...preSnap } }
}

export function getAllSnapEntries(): Record<string, SnapEntry> {
  const out: Record<string, SnapEntry> = {}
  for (const [route, kind] of Object.entries(useWindows.getState().snapped)) {
    const preSnap = snapResting[route]
    if (preSnap !== undefined) out[route] = { kind, preSnap: { ...preSnap } }
  }
  return out
}

const openWindowId = (
  id: string,
  rect: Rect | undefined,
  get: () => WindowsState,
  set: (partial: Partial<WindowsState>) => void
): void => {
  const prev = get()
  if (prev.open.includes(id)) {
    get().focus(id)
    return
  }
  // +1: slot 0/1 are the desk/runtime seed slots, so a fresh window never
  // lands on a still-open seed position after a close.
  const r = rect ?? { ...DEFAULT_SIZE, ...cascadeOffset(prev.open.length + 1) }
  set({
    open: [...prev.open, id],
    zOrder: [...prev.zOrder, id],
    rects: { ...prev.rects, [id]: r },
    selected: id
  })
}

// Maximize spans the canvas geometrically. The 1100×900 clampSize ceiling is
// a per-window USER-resize bound — it never applies to the maximized span.
const maximizedRect = (bounds: CanvasBounds): Rect => ({
  x: 0,
  y: 0,
  w: bounds.w,
  h: bounds.h
})

export const useWindows = create<WindowsState>((set, get) => ({
  ...initialWindows(),
  focus: (route) => {
    const prev = get()
    // Clicking an already-front window must be a state no-op (Task 8 rule):
    // no set() call, so no store notification and no re-render churn.
    if (
      prev.zOrder.at(-1) === route &&
      prev.selected === route &&
      !prev.minimized.includes(route)
    ) {
      return
    }
    set({
      zOrder:
        prev.zOrder.at(-1) === route
          ? prev.zOrder
          : [...prev.zOrder.filter((r) => r !== route), route],
      minimized: prev.minimized.includes(route)
        ? prev.minimized.filter((r) => r !== route)
        : prev.minimized,
      selected: route
    })
  },
  openRoute: (route, rect) => openWindowId(route, rect, get, set),
  openFile: (id, rect) => openWindowId(`file:${id}`, rect, get, set),
  close: (route) =>
    set((prev) => {
      const open = prev.open.filter((r) => r !== route)
      const zOrder = prev.zOrder.filter((r) => r !== route)
      const minimized = prev.minimized.filter((r) => r !== route)
      const snapped = { ...prev.snapped }
      delete snapped[route]
      delete resting[route]
      delete snapResting[route]
      return {
        open,
        zOrder,
        minimized,
        maximized: prev.maximized.filter((r) => r !== route),
        snapped,
        selected:
          prev.selected === route ? fallbackSelection(route, zOrder, minimized) : prev.selected
      }
    }),
  minimize: (route) => {
    const prev = get()
    if (prev.minimized.includes(route)) return
    const minimized = [...prev.minimized, route]
    set({
      minimized,
      selected:
        prev.selected === route ? fallbackSelection(route, prev.zOrder, minimized) : prev.selected
    })
  },
  maximize: (route, bounds) => {
    const prev = get()
    const rects = { ...prev.rects }
    if (prev.maximized.includes(route)) {
      const rest = resting[route]
      if (rest) rects[route] = rest
      set({ rects, maximized: prev.maximized.filter((r) => r !== route) })
      return
    }
    // Maximizing a snapped window replaces the snap: the pre-snap rect
    // becomes the pre-max rect, so un-maximize restores it exactly.
    if (prev.snapped[route] !== undefined) {
      const preSnap = snapResting[route]
      if (preSnap) resting[route] = preSnap
      delete snapResting[route]
      const snapped = { ...prev.snapped }
      delete snapped[route]
      rects[route] = maximizedRect(bounds)
      set({ rects, snapped, maximized: [...prev.maximized, route] })
      return
    }
    resting[route] = rects[route]
    rects[route] = maximizedRect(bounds)
    set({ rects, maximized: [...prev.maximized, route] })
  },
  snap: (route, kind, bounds) => {
    const prev = get()
    const rects = { ...prev.rects }
    const maximized = prev.maximized.filter((r) => r !== route)
    // Snapping a maximized window replaces maximize: the pre-max rect
    // becomes the pre-snap rect, so un-snap restores it exactly.
    if (prev.maximized.includes(route)) {
      const rest = resting[route]
      snapResting[route] = rest ?? rects[route] ?? { ...DEFAULT_SIZE }
      delete resting[route]
    } else if (prev.snapped[route] === undefined) {
      // Re-snapping keeps the ORIGINAL pre-snap rect, not the snap span.
      snapResting[route] = rects[route] ?? { ...DEFAULT_SIZE }
    }
    rects[route] = snapRectFor(kind, bounds)
    set({ rects, maximized, snapped: { ...prev.snapped, [route]: kind } })
  },
  unsnap: (route) => {
    const prev = get()
    if (prev.snapped[route] === undefined) return
    const rects = { ...prev.rects }
    const rest = snapResting[route]
    if (rest) rects[route] = rest
    delete snapResting[route]
    const snapped = { ...prev.snapped }
    delete snapped[route]
    set({ rects, snapped })
  },
  hydrateSnaps: (entries, bounds) => {
    const prev = get()
    const rects = { ...prev.rects }
    const snapped = { ...prev.snapped }
    for (const [route, entry] of Object.entries(entries)) {
      if (!isSnapEntry(entry)) continue
      snapResting[route] = { ...entry.preSnap }
      snapped[route] = entry.kind
      rects[route] = snapRectFor(entry.kind, bounds)
    }
    set({ rects, snapped })
  },
  refit: (bounds) => {
    const prev = get()
    if (prev.maximized.length === 0 && Object.keys(prev.snapped).length === 0) return
    const rects = { ...prev.rects }
    // Snapped windows re-span from their kind, like maximized windows
    // re-span geometrically — never from stored pixels.
    for (const route of prev.maximized) rects[route] = maximizedRect(bounds)
    for (const [route, kind] of Object.entries(prev.snapped)) {
      if (!prev.maximized.includes(route)) rects[route] = snapRectFor(kind, bounds)
    }
    set({ rects })
  },
  commit: (route, rect) => {
    const clamped = clampSize(rect.w, rect.h)
    const committed = { ...rect, w: clamped.w, h: clamped.h }
    const prev = get()
    if (prev.maximized.includes(route)) {
      // Resizing a maximized window commits the resize as the new normal
      // rect: the window leaves maximized state and un-maximize from here
      // restores exactly what the user resized to.
      resting[route] = committed
      set({
        rects: { ...prev.rects, [route]: committed },
        maximized: prev.maximized.filter((r) => r !== route)
      })
      return
    }
    if (prev.snapped[route] !== undefined) {
      // Resizing a snapped window is an explicit new normal: the snap and
      // its resting rect go away, the clamped resize stays.
      delete snapResting[route]
      const snapped = { ...prev.snapped }
      delete snapped[route]
      set((cur) => ({ rects: { ...cur.rects, [route]: committed }, snapped }))
      return
    }
    set((cur) => ({ rects: { ...cur.rects, [route]: committed } }))
  }
}))
