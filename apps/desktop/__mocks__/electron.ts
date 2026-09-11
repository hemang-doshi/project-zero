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
export const Tray = class Tray {}
export const Menu = { buildFromTemplate: (): unknown[] => [] }
