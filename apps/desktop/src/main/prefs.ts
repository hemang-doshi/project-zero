import * as fs from 'node:fs'
import * as path from 'node:path'
import { DEFAULT_SIZE, LAYOUT_VERSION, type Rect } from '../shared/desktop-windows'

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
