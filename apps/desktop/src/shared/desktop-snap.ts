import type { Point, Rect } from './desktop-windows'

// Dragging a window header within this distance of a canvas edge or corner
// arms a snap preview; releasing commits the snap.
export const SNAP_THRESHOLD = 24

export const SNAP_KINDS = [
  'left',
  'right',
  'bottom',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right'
] as const

export type SnapKind = (typeof SNAP_KINDS)[number]

// The top edge routes to maximize through the existing maximize path rather
// than a snap kind, so it is a drop target but never persisted snap state.
export type SnapTarget = SnapKind | 'maximize'

export type SnapBounds = { w: number; h: number }

// The persisted snap record: the kind to recompute against the CURRENT
// canvas on reload (never stored pixels) plus the pre-snap rect to restore
// on un-snap.
export type SnapEntry = { kind: SnapKind; preSnap: Rect }

export function isSnapKind(v: unknown): v is SnapKind {
  return typeof v === 'string' && (SNAP_KINDS as readonly unknown[]).includes(v)
}

const isRectLike = (v: unknown): v is Rect => {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r.x === 'number' &&
    typeof r.y === 'number' &&
    typeof r.w === 'number' &&
    typeof r.h === 'number'
  )
}

export function isSnapEntry(v: unknown): v is SnapEntry {
  if (typeof v !== 'object' || v === null) return false
  const e = v as Record<string, unknown>
  return isSnapKind(e.kind) && isRectLike(e.preSnap)
}

// Zone detection reads the dragged window rect: the header pointer may sit
// anywhere on the bar, but the window edges are what visibly meet the canvas
// edges. Corners win over edges; the lone top edge means maximize.
export function detectSnapZone(
  pos: Point,
  size: { w: number; h: number },
  bounds: SnapBounds,
  threshold: number = SNAP_THRESHOLD
): SnapTarget | null {
  const nearLeft = pos.x <= threshold
  const nearRight = pos.x + size.w >= bounds.w - threshold
  const nearTop = pos.y <= threshold
  const nearBottom = pos.y + size.h >= bounds.h - threshold
  if (nearTop && nearLeft) return 'top-left'
  if (nearTop && nearRight) return 'top-right'
  if (nearBottom && nearLeft) return 'bottom-left'
  if (nearBottom && nearRight) return 'bottom-right'
  if (nearTop) return 'maximize'
  if (nearLeft) return 'left'
  if (nearRight) return 'right'
  if (nearBottom) return 'bottom'
  return null
}

// Snapped rects are geometric like the maximized span: they bypass the
// per-window clampSize ceiling the same way maximize does.
export function snapRectFor(target: SnapTarget, bounds: SnapBounds): Rect {
  const hw = bounds.w / 2
  const hh = bounds.h / 2
  switch (target) {
    case 'left':
      return { x: 0, y: 0, w: hw, h: bounds.h }
    case 'right':
      return { x: hw, y: 0, w: hw, h: bounds.h }
    case 'bottom':
      return { x: 0, y: hh, w: bounds.w, h: hh }
    case 'top-left':
      return { x: 0, y: 0, w: hw, h: hh }
    case 'top-right':
      return { x: hw, y: 0, w: hw, h: hh }
    case 'bottom-left':
      return { x: 0, y: hh, w: hw, h: hh }
    case 'bottom-right':
      return { x: hw, y: hh, w: hw, h: hh }
    case 'maximize':
      return { x: 0, y: 0, w: bounds.w, h: bounds.h }
  }
}

// Dragging a snapped window away from its zone anchor by more than the
// threshold un-snaps it back to the pre-snap rect.
export function isAwayFromSnap(
  kind: SnapKind,
  pos: Point,
  bounds: SnapBounds,
  threshold: number = SNAP_THRESHOLD
): boolean {
  const anchor = snapRectFor(kind, bounds)
  return Math.abs(pos.x - anchor.x) > threshold || Math.abs(pos.y - anchor.y) > threshold
}

export type DropResolution =
  { type: 'snap'; kind: SnapTarget } | { type: 'unsnap' } | { type: 'stay' } | { type: 'plain' }

// Single decision point for a drag release. Snapped windows dropped back in
// their own zone stay put; a maximized window dropped at the top stays
// maximized (no toggle); a dragged maximized window anywhere else keeps the
// Task 19 plain-commit behavior via 'plain'.
export function resolveDrop(args: {
  currentSnap: SnapKind | null
  maximized: boolean
  pos: Point
  size: { w: number; h: number }
  bounds: SnapBounds
  threshold?: number
}): DropResolution {
  const threshold = args.threshold ?? SNAP_THRESHOLD
  const zone = detectSnapZone(args.pos, args.size, args.bounds, threshold)
  if (zone !== null) {
    if (zone === 'maximize') {
      return args.maximized ? { type: 'stay' } : { type: 'snap', kind: zone }
    }
    return args.currentSnap === zone ? { type: 'stay' } : { type: 'snap', kind: zone }
  }
  if (args.currentSnap !== null) {
    return isAwayFromSnap(args.currentSnap, args.pos, args.bounds, threshold)
      ? { type: 'unsnap' }
      : { type: 'stay' }
  }
  return { type: 'plain' }
}
