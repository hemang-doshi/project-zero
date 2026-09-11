import { create } from 'zustand'
import {
  DEFAULT_SIZE,
  cascadeOffset,
  clampSize,
  fallbackSelection,
  launchOrigins,
  type Rect
} from '../../../shared/desktop-windows'

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
  refit: (bounds: CanvasBounds) => void
  commit: (route: string, rect: Rect) => void
}

export function initialWindows(): WindowsData {
  return {
    open: [...SEED_ROUTES],
    zOrder: [...SEED_ROUTES],
    minimized: [],
    maximized: [],
    selected: SEED_ROUTES[SEED_ROUTES.length - 1],
    rects: seedRects()
  }
}

// Pre-maximize rects, one per route, module-level like the store itself:
// maximized state is deliberately not persisted (Task 8 ruling).
const resting: Record<string, Rect> = {}

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

const maximizedRect = (bounds: CanvasBounds): Rect => {
  const clamped = clampSize(bounds.w, bounds.h)
  return { x: 0, y: 0, w: clamped.w, h: clamped.h }
}

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
      return {
        open,
        zOrder,
        minimized,
        maximized: prev.maximized.filter((r) => r !== route),
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
    resting[route] = rects[route]
    rects[route] = maximizedRect(bounds)
    set({ rects, maximized: [...prev.maximized, route] })
  },
  refit: (bounds) => {
    const prev = get()
    if (prev.maximized.length === 0) return
    const rect = maximizedRect(bounds)
    const rects = { ...prev.rects }
    for (const route of prev.maximized) rects[route] = rect
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
    set((cur) => ({ rects: { ...cur.rects, [route]: committed } }))
  }
}))
