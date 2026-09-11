import type { FC } from 'react'
import { ROUTE_TITLES, type RouteId } from './canvas'
import { type Rect } from '../../../shared/desktop-windows'
import { DesktopWindow } from './DesktopWindow'
import { Taskbar } from './Taskbar'

export type DesktopCanvasProps = {
  open: string[]
  zOrder: string[]
  minimized: string[]
  rects: Record<string, Rect>
  onSelect: (route: string) => void
  onClose: (route: string) => void
  onMinimize: (route: string) => void
  onMaximize: (route: string) => void
  onCommit: (route: string, rect: Rect) => void
}

const placeholder = (id: RouteId): FC => {
  const Route = (): React.JSX.Element => <div className="zw-route">{ROUTE_TITLES[id]}</div>
  return Route
}

const ROUTES: Record<RouteId, FC> = {
  desk: placeholder('desk'),
  runtime: placeholder('runtime'),
  network: placeholder('network'),
  flightRecorder: placeholder('flightRecorder'),
  airlock: placeholder('airlock'),
  zeroBot: placeholder('zeroBot'),
  skillLab: placeholder('skillLab')
}

export function DesktopCanvas({
  open,
  zOrder,
  minimized,
  rects,
  onSelect,
  onClose,
  onMinimize,
  onMaximize,
  onCommit
}: DesktopCanvasProps): React.JSX.Element {
  const visible = zOrder.filter((r) => open.includes(r) && !minimized.includes(r))
  const front = visible.at(-1) ?? null
  return (
    <div
      className="zw-desktop"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--z-window-canvas)',
        overflow: 'hidden'
      }}
    >
      <div className="zw-icons" aria-hidden="true" />
      {visible.map((route) => {
        const Route = ROUTES[route as RouteId]
        return (
          <DesktopWindow
            key={route}
            route={route}
            rect={rects[route]}
            front={route === front}
            onSelect={() => onSelect(route)}
            onClose={() => onClose(route)}
            onMinimize={() => onMinimize(route)}
            onMaximize={() => onMaximize(route)}
            onCommit={(r) => onCommit(route, r)}
          >
            <Route />
          </DesktopWindow>
        )
      })}
      <Taskbar open={open} minimized={minimized} front={front} onSelect={onSelect} />
    </div>
  )
}
