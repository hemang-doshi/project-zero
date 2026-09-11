import { useState } from 'react'
import { Rnd } from 'react-rnd'
import { clampSize, type Rect } from '../../../shared/desktop-windows'
import { ROUTE_TITLES, previewTransform, type RouteId } from './canvas'

const ALL_EIGHT = {
  top: true,
  right: true,
  bottom: true,
  left: true,
  topRight: true,
  bottomRight: true,
  bottomLeft: true,
  topLeft: true
}

const HEADER_HEIGHT = 34

const headerStyle: React.CSSProperties = {
  height: HEADER_HEIGHT,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 10px',
  cursor: 'move',
  flexShrink: 0
}

const lightStyle = (color: string): React.CSSProperties => ({
  width: 18,
  height: 18,
  borderRadius: 9,
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  flexShrink: 0,
  background: color
})

const lightMouseDown = (e: React.MouseEvent<HTMLButtonElement>): void => e.stopPropagation()

const lightClick =
  (action: () => void) =>
  (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation()
    action()
  }

export type DesktopWindowProps = {
  route: string
  rect: Rect
  front: boolean
  onSelect: () => void
  onClose: () => void
  onMinimize: () => void
  onMaximize: () => void
  onCommit: (rect: Rect) => void
  children: React.ReactNode
}

export function DesktopWindow({
  route,
  rect,
  front,
  onSelect,
  onClose,
  onMinimize,
  onMaximize,
  onCommit,
  children
}: DesktopWindowProps): React.JSX.Element {
  const [previewDir, setPreviewDir] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ w: number; h: number } | null>(null)
  const title = ROUTE_TITLES[route as RouteId] ?? route
  const t = previewTransform(previewDir ?? '', rect, preview)
  return (
    <Rnd
      size={{ width: rect.w, height: rect.h }}
      position={{ x: rect.x, y: rect.y }}
      dragHandleClassName="zw-header"
      enableResizing={ALL_EIGHT}
      minWidth={320}
      minHeight={240}
      maxWidth={1100}
      maxHeight={900}
      onResizeStart={(_e, dir) => setPreviewDir(dir)}
      onResize={(_e, _dir, _ref, delta) =>
        setPreview({ w: rect.w + delta.width, h: rect.h + delta.height })
      }
      onResizeStop={(_e, _dir, _ref, _delta, position) => {
        const clamped = clampSize(
          Math.round(preview?.w ?? rect.w),
          Math.round(preview?.h ?? rect.h)
        )
        setPreviewDir(null)
        setPreview(null)
        onCommit({ x: position.x, y: position.y, w: clamped.w, h: clamped.h })
      }}
      onDragStop={(_e, d) => onCommit({ x: d.x, y: d.y, w: rect.w, h: rect.h })}
      style={{
        zIndex: front ? 10 : 1,
        background: 'var(--z-card-cream)',
        borderRadius: 14,
        overflow: 'hidden',
        boxShadow: front ? '0 12px 32px rgba(0,0,0,.18)' : '0 6px 16px rgba(0,0,0,.10)'
      }}
    >
      <div className="zw-header" style={headerStyle} onClick={() => onSelect()}>
        <button
          type="button"
          className="zw-light"
          style={lightStyle('var(--z-error-red)')}
          onMouseDown={lightMouseDown}
          onClick={lightClick(onClose)}
          aria-label="Close"
        />
        <button
          type="button"
          className="zw-light"
          style={lightStyle('var(--z-marker-yellow)')}
          onMouseDown={lightMouseDown}
          onClick={lightClick(onMinimize)}
          aria-label="Minimize"
        />
        <button
          type="button"
          className="zw-light"
          style={lightStyle('var(--z-status-green)')}
          onMouseDown={lightMouseDown}
          onClick={lightClick(onMaximize)}
          aria-label="Maximize"
        />
        <span style={{ pointerEvents: 'none', fontSize: 13, color: 'var(--z-ink)' }}>{title}</span>
      </div>
      <div
        style={{
          transform: t ? `scale(${t.scale.x}, ${t.scale.y})` : undefined,
          transformOrigin: t?.origin,
          width: '100%',
          height: `calc(100% - ${HEADER_HEIGHT}px)`
        }}
      >
        {children}
      </div>
    </Rnd>
  )
}
