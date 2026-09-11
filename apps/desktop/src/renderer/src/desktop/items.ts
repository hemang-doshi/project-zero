import items from '../../../main/desktop-items.json'

export type DesktopFile = {
  id: string
  name: string
  ext: 'txt' | 'png' | 'pdf' | 'notes'
  content: string
}

export type DesktopIcon = {
  id: string
  label: string
  kind: 'route' | 'file'
  route?: string
  file?: string
}

export type DesktopItems = { icons: DesktopIcon[]; files: DesktopFile[] }

export const DESKTOP_ITEMS: DesktopItems = items as DesktopItems

export const FILES_BY_ID: ReadonlyMap<string, DesktopFile> = new Map(
  DESKTOP_ITEMS.files.map((f) => [f.id, f])
)

export const fileById = (id: string): DesktopFile | undefined => FILES_BY_ID.get(id)

export const DUMMY_NOTICE = 'DUMMY FILE — READ ONLY'

export function viewerTitle(file: DesktopFile): string {
  return `${file.name} · dummy`
}

export const ICON_W = 68
export const ICON_H = 84
export const GRID_ORIGIN = { x: 24, y: 28 }

// The seed grid must fit the default main window (900x670, see main/index.ts)
// with the bottom taskbar strip left free: two columns of at most 6 rows,
// vertical step 96 keeps the tallest column at y=28..508 (bottom 592, which
// leaves 78px clear of the 670px viewport). Persisted positions always win
// over these seeds.
export const SEED_VIEWPORT = { width: 900, height: 670 }
export const SEED_BOTTOM_RESERVE = 72
export const SEED_PER_COLUMN = 6
export const GRID_STEP_Y = 96
export const GRID_COLUMN_GAP = 20

export const iconGridPos = (index: number): { x: number; y: number } => ({
  x: GRID_ORIGIN.x + Math.floor(index / SEED_PER_COLUMN) * (ICON_W + GRID_COLUMN_GAP),
  y: GRID_ORIGIN.y + (index % SEED_PER_COLUMN) * GRID_STEP_Y
})

export const monogram = (label: string): string => {
  const words = label.split(/\s+/).filter((w) => w.length > 0)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return label.slice(0, 2).toUpperCase()
}
