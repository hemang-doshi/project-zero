import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  CANONICAL_ROUTE_ORDER,
  canonicalOrderPositions,
  DEFAULT_SIZE,
  LAYOUT_VERSION,
  migrateStackedOrigins,
  type Rect
} from '../shared/desktop-windows'

export type Prefs = {
  version: 1
  windows: Record<string, Rect>
  icons: Record<string, { x: number; y: number }>
  wallpaper: {
    kind: 'dotted-green' | 'cream' | 'canvas-tan' | 'custom'
    path?: string
    mode: 'cover' | 'tile'
  }
  open: string[]
  zOrder: string[]
  minimized: string[]
  layoutVersion: number
}

export function defaultPrefs(): Prefs {
  return {
    version: 1,
    windows: {
      desk: { ...DEFAULT_SIZE, x: 28, y: 28 },
      runtime: { ...DEFAULT_SIZE, x: 56, y: 56 }
    },
    icons: {},
    wallpaper: { kind: 'dotted-green', mode: 'cover' },
    open: ['desk', 'runtime'],
    zOrder: ['desk', 'runtime'],
    minimized: [],
    layoutVersion: LAYOUT_VERSION
  }
}

export class PrefsStore {
  constructor(private dir: string) {}
  private get file(): string {
    return path.join(this.dir, 'prefs.json')
  }
  load(): Prefs {
    let raw: string
    try {
      raw = fs.readFileSync(this.file, 'utf8')
    } catch {
      return defaultPrefs()
    }
    try {
      return JSON.parse(raw) as Prefs
    } catch {
      fs.renameSync(this.file, `${this.file}.corrupt-${Date.now()}`)
      return defaultPrefs()
    }
  }
  save(p: Prefs): void {
    fs.mkdirSync(this.dir, { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify(p, null, 2))
  }
}

const WALLPAPER_KINDS = ['dotted-green', 'cream', 'canvas-tan', 'custom'] as const
const WALLPAPER_MODES = ['cover', 'tile'] as const
type Wallpaper = Prefs['wallpaper']

type Point = { x: number; y: number }

const isPoint = (v: unknown): v is Point =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as Point).x === 'number' &&
  typeof (v as Point).y === 'number'

const isRect = (v: unknown): v is Rect =>
  isPoint(v) && typeof (v as Rect).w === 'number' && typeof (v as Rect).h === 'number'

const isWallpaper = (v: unknown): v is Wallpaper =>
  typeof v === 'object' &&
  v !== null &&
  (WALLPAPER_KINDS as readonly unknown[]).includes((v as Wallpaper).kind) &&
  (WALLPAPER_MODES as readonly unknown[]).includes((v as Wallpaper).mode) &&
  ((v as Wallpaper).path === undefined || typeof (v as Wallpaper).path === 'string')

export function applyPrefsPatch(prefs: Prefs, patch: unknown): Prefs {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    throw new Error('Malformed prefs payload')
  }
  const p = patch as Record<string, unknown>
  const next: Prefs = { ...prefs }
  if (isWallpaper(p.wallpaper)) next.wallpaper = { ...p.wallpaper }
  if (typeof p.icons === 'object' && p.icons !== null && !Array.isArray(p.icons)) {
    const icons: Prefs['icons'] = { ...next.icons }
    for (const [id, pos] of Object.entries(p.icons))
      if (isPoint(pos)) icons[id] = { x: pos.x, y: pos.y }
    next.icons = icons
  }
  if (typeof p.windows === 'object' && p.windows !== null && !Array.isArray(p.windows)) {
    const windows: Prefs['windows'] = { ...next.windows }
    for (const [route, rect] of Object.entries(p.windows)) {
      if (isRect(rect)) windows[route] = { x: rect.x, y: rect.y, w: rect.w, h: rect.h }
    }
    next.windows = windows
  }
  return next
}

export function startupMigrate(prefs: Prefs): Prefs {
  const origins: Record<string, Point> = {}
  for (const [route, rect] of Object.entries(prefs.windows)) {
    origins[route] = { x: rect.x, y: rect.y }
  }
  const migrated = migrateStackedOrigins(
    canonicalOrderPositions(origins, CANONICAL_ROUTE_ORDER),
    prefs.layoutVersion
  )
  const windows: Prefs['windows'] = {}
  for (const [route, rect] of Object.entries(prefs.windows)) {
    const origin = migrated.positions[route]
    windows[route] = origin ? { ...rect, x: origin.x, y: origin.y } : rect
  }
  // One-way icon migration: free-placed positions from before grid snap round
  // to their nearest slot on load. Geometry must match the renderer seed grid
  // in renderer/src/desktop/items.ts (origin 24,28; pitch 88x96) — pinned by
  // the grid-parity test in prefs.test.ts, so this never becomes a second grid.
  const icons: Prefs['icons'] = {}
  for (const [id, pos] of Object.entries(prefs.icons ?? {})) {
    icons[id] = snapIconToGrid(pos)
  }
  return { ...prefs, windows, icons, layoutVersion: migrated.layoutVersion }
}

// Canonical desktop icon slot math (renderer items.ts is the source of truth;
// this mirror exists because the main process must migrate before any window
// loads — the grid-parity test pins them identical).
export const ICON_GRID_ORIGIN = { x: 24, y: 28 }
export const ICON_GRID_STEP = { x: 88, y: 96 }

export function snapIconToGrid(p: Point): Point {
  return {
    x:
      ICON_GRID_ORIGIN.x +
      Math.round((p.x - ICON_GRID_ORIGIN.x) / ICON_GRID_STEP.x) * ICON_GRID_STEP.x,
    y:
      ICON_GRID_ORIGIN.y +
      Math.round((p.y - ICON_GRID_ORIGIN.y) / ICON_GRID_STEP.y) * ICON_GRID_STEP.y
  }
}
