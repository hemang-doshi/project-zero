// Minimal electron mock for unit tests that exercise main-process icon
// logic (tray icon sourcing) without a real Electron runtime.
export type MockImage = {
  path: string
  reps: { scaleFactor: number; buffer: Buffer }[]
  template: boolean
  isEmpty(): boolean
  addRepresentation(rep: { scaleFactor: number; buffer: Buffer }): void
  setTemplateImage(template: boolean): void
}

const images: MockImage[] = []
let emptyHints: string[] = []

export const nativeImage = {
  createFromPath(path: string): MockImage {
    const empty = emptyHints.some((hint) => path.includes(hint))
    const img: MockImage = {
      path,
      reps: [],
      template: false,
      isEmpty: () => empty,
      addRepresentation(rep) {
        img.reps.push(rep)
      },
      setTemplateImage(template) {
        img.template = template
      }
    }
    images.push(img)
    return img
  }
}

export const __images = images
export const __setEmpty = (hint: string): void => {
  emptyHints.push(hint)
}
export const __resetImages = (): void => {
  images.length = 0
  emptyHints = []
}

// Records every setContextMenu call so tests can assert the tray rebuild
// gating (rebuild only when rendered labels actually change).
export class Tray {
  static readonly contextMenus: unknown[] = []
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function
  setToolTip(_tip: string): void {}
  setContextMenu(menu: unknown): void {
    Tray.contextMenus.push(menu)
  }
}

export const Menu = {
  templates: [] as unknown[],
  buildFromTemplate(template: unknown): unknown {
    Menu.templates.push(template)
    return { template }
  }
}
export const __resetTray = (): void => {
  Tray.contextMenus.length = 0
  Menu.templates.length = 0
}
