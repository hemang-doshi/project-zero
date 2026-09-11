import { create } from 'zustand'
import {
  DEFAULT_SIZE,
  clampSize,
  fallbackSelection,
  launchOrigins,
  type Rect
} from '../../../shared/desktop-windows'

const MAX_W = 1100
const MAX_H = 900

const SEED_ROUTES = ['desk', 'runtime'] as const

const seedRects = (): Record<string, Rect> => {
  const origins = launchOrigins(SEED_ROUTES.length)
  return Object.fromEntries(SEED_ROUTES.map((r, i) => [r, { ...DEFAULT_SIZE, ...origins[i] }]))
}

export type WindowsData = {
  open: string[]
  zOrder: string[]
  minimized: string[]
  selected: string
  rects: Record<string, Rect>
}

export type WindowsState = WindowsData & {
  focus: (route: string) => void
  close: (route: string) => void
  minimize: (route: string) => void
  maximize: (route: string) => void
  commit: (route: string, rect: Rect) => void
}

export function initialWindows(): WindowsData {
  return {
    open: [...SEED_ROUTES],
    zOrder: [...SEED_ROUTES],
    minimized: [],
    selected: SEED_ROUTES[SEED_ROUTES.length - 1],
    rects: seedRects()
  }
}

const resting: Record<string, Rect> = {}

export const useWindows = create<WindowsState>((set, get) => ({
  ...initialWindows(),
  focus: (route) =>
    set((prev) => ({
      zOrder:
        prev.zOrder.at(-1) === route
          ? prev.zOrder
          : [...prev.zOrder.filter((r) => r !== route), route],
      minimized: prev.minimized.includes(route)
        ? prev.minimized.filter((r) => r !== route)
        : prev.minimized,
      selected: route
    })),
  close: (route) =>
    set((prev) => {
      const open = prev.open.filter((r) => r !== route)
      const zOrder = prev.zOrder.filter((r) => r !== route)
      const minimized = prev.minimized.filter((r) => r !== route)
      return {
        open,
        zOrder,
        minimized,
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
  maximize: (route) => {
    const cur = get().rects[route]
    if (cur.w === MAX_W && cur.h === MAX_H && cur.x === 0 && cur.y === 0) {
      const rest = resting[route]
      if (rest) set((prev) => ({ rects: { ...prev.rects, [route]: rest } }))
      return
    }
    resting[route] = cur
    set((prev) => ({ rects: { ...prev.rects, [route]: { x: 0, y: 0, w: MAX_W, h: MAX_H } } }))
  },
  commit: (route, rect) => {
    const clamped = clampSize(rect.w, rect.h)
    set((prev) => ({
      rects: { ...prev.rects, [route]: { ...rect, w: clamped.w, h: clamped.h } }
    }))
  }
}))
