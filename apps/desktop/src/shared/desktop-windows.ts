export type Point = { x: number; y: number }
export type Rect = { x: number; y: number; w: number; h: number }

export const clampSize = (w: number, h: number): { w: number; h: number } => ({
  w: Math.min(Math.max(w, 320), 1100),
  h: Math.min(Math.max(h, 240), 900)
})

export const cascadeOffset = (index: number): Point => {
  const slot = ((index % 8) + 8) % 8
  return { x: slot * 28, y: slot * 28 }
}

export const initialOrigin = (openCount: number, stored?: Point | null): Point =>
  stored ?? cascadeOffset(openCount)

export const launchOrigins = (count: number): Point[] =>
  Array.from({ length: count }, (_, i) => cascadeOffset(i))

export const fallbackSelection = (
  closed: string,
  zOrder: string[],
  minimized: string[] = []
): string => zOrder.filter((r) => r !== closed && !minimized.includes(r)).at(-1) ?? 'desk'

export const DEFAULT_SIZE: Rect = { x: 0, y: 0, w: 560, h: 480 }
export const LAYOUT_VERSION = 2

export const CANONICAL_ROUTE_ORDER = [
  'desk',
  'runtime',
  'network',
  'flightRecorder',
  'airlock',
  'zeroBot',
  'skillLab'
] as const

export type CanonicalRouteId = (typeof CANONICAL_ROUTE_ORDER)[number]

export function canonicalOrderPositions<T>(
  positions: Record<string, T>,
  canonical: readonly string[]
): Record<string, T> {
  const out: Record<string, T> = {}
  for (const key of canonical) if (key in positions) out[key] = positions[key]
  for (const [key, value] of Object.entries(positions)) {
    if (!canonical.includes(key)) out[key] = value
  }
  return out
}

export function migrateStackedOrigins(
  positions: Record<string, Point>,
  layoutVersion: number
): { positions: Record<string, Point>; layoutVersion: number } {
  if (layoutVersion >= LAYOUT_VERSION) return { positions, layoutVersion: LAYOUT_VERSION }
  const tolerance = 40
  const spacing = 48
  const inset = 32
  const collides = (a: Point, b: Point): boolean =>
    Math.abs(a.x - b.x) < tolerance && Math.abs(a.y - b.y) < tolerance
  const out: Record<string, Point> = {}
  const occupied: Point[] = []
  let nextSlot = 0
  for (const [route, stored] of Object.entries(positions)) {
    if (occupied.some((o) => collides(o, stored))) {
      let candidate: Point = { x: inset + nextSlot * spacing, y: inset + nextSlot * spacing }
      while (occupied.some((o) => collides(o, candidate))) {
        nextSlot++
        candidate = { x: inset + nextSlot * spacing, y: inset + nextSlot * spacing }
      }
      out[route] = candidate
      occupied.push(candidate)
      nextSlot++
    } else {
      out[route] = stored
      occupied.push(stored)
    }
  }
  return { positions: out, layoutVersion: LAYOUT_VERSION }
}
