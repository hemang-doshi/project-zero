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
export const GRID_STEP = 108

export const iconGridPos = (index: number): { x: number; y: number } => ({
  x: GRID_ORIGIN.x,
  y: GRID_ORIGIN.y + index * GRID_STEP
})

export const monogram = (label: string): string => {
  const words = label.split(/\s+/).filter((w) => w.length > 0)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return label.slice(0, 2).toUpperCase()
}
