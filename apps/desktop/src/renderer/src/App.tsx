import { useRef, useState } from 'react'
import { DesktopCanvas } from './desktop/DesktopCanvas'
import { DEFAULT_SIZE, clampSize, launchOrigins, type Rect } from '../../shared/desktop-windows'

const MAX_W = 1100
const MAX_H = 900

const SEED_ROUTES = ['desk', 'runtime'] as const

const seedRects = (): Record<string, Rect> => {
  const origins = launchOrigins(SEED_ROUTES.length)
  return Object.fromEntries(SEED_ROUTES.map((r, i) => [r, { ...DEFAULT_SIZE, ...origins[i] }]))
}

function App(): React.JSX.Element {
  const [open, setOpen] = useState<string[]>([...SEED_ROUTES])
  const [zOrder, setZOrder] = useState<string[]>([...SEED_ROUTES])
  const [minimized, setMinimized] = useState<string[]>([])
  const [rects, setRects] = useState<Record<string, Rect>>(seedRects)
  const resting = useRef<Record<string, Rect>>({})

  const focus = (route: string): void => {
    setMinimized((prev) => prev.filter((r) => r !== route))
    setZOrder((prev) =>
      prev.at(-1) === route ? prev : [...prev.filter((r) => r !== route), route]
    )
  }

  const close = (route: string): void => {
    setOpen((prev) => prev.filter((r) => r !== route))
    setMinimized((prev) => prev.filter((r) => r !== route))
    setZOrder((prev) => prev.filter((r) => r !== route))
  }

  const minimize = (route: string): void => {
    setMinimized((prev) => (prev.includes(route) ? prev : [...prev, route]))
  }

  const maximize = (route: string): void => {
    setRects((prev) => {
      const cur = prev[route]
      if (cur.w === MAX_W && cur.h === MAX_H && cur.x === 0 && cur.y === 0) {
        const rest = resting.current[route]
        return rest ? { ...prev, [route]: rest } : prev
      }
      resting.current[route] = cur
      return { ...prev, [route]: { x: 0, y: 0, w: MAX_W, h: MAX_H } }
    })
  }

  const commit = (route: string, rect: Rect): void => {
    const clamped = clampSize(rect.w, rect.h)
    setRects((prev) => ({ ...prev, [route]: { ...rect, w: clamped.w, h: clamped.h } }))
  }

  return (
    <DesktopCanvas
      open={open}
      zOrder={zOrder}
      minimized={minimized}
      rects={rects}
      onSelect={focus}
      onClose={close}
      onMinimize={minimize}
      onMaximize={maximize}
      onCommit={commit}
    />
  )
}

export default App
