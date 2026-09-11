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
  background: color,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
})

const glyphStyle: React.CSSProperties = {
  color: 'rgba(0,0,0,.55)'
}

const TrafficGlyph = ({ d }: { d: string }): React.JSX.Element => (
  <svg
    className="zw-glyph"
    width={10}
    height={10}
    viewBox="0 0 10 10"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.2}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={glyphStyle}
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
)

const GLYPHS = {
  close: 'M2.2,2.2 L7.8,7.8 M7.8,2.2 L2.2,7.8',
  minimize: 'M2.5,5 L7.5,5',
  maximize:
    'M4.3,5.7 L7.6,2.4 M7.6,2.4 L5.4,2.4 M7.6,2.4 L7.6,4.6 M5.7,4.3 L2.4,7.6 M2.4,7.6 L4.6,7.6 M2.4,7.6 L2.4,5.4'
}

export type DesktopWindowProps = {
  route: string
  title?: string
  rect: Rect
  front: boolean
  maximized: boolean
  onSelect: () => void
  onClose: () => void
  onMinimize: () => void
  onMaximize: () => void
  onCommit: (rect: Rect) => void
  children: React.ReactNode
}

export function DesktopWindow({
  route,
  title: titleOverride,
  rect,
  front,
  maximized,
  onSelect,
  onClose,
  onMinimize,
  onMaximize,
  onCommit,
  children
}: DesktopWindowProps): React.JSX.Element {
  const [previewDir, setPreviewDir] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ w: number; h: number } | null>(null)
  const title = titleOverride ?? ROUTE_TITLES[route as RouteId] ?? route
  const t = previewTransform(previewDir ?? '', rect, preview)
  return (
    <Rnd
      size={{ width: rect.w, height: rect.h }}
      position={{ x: rect.x, y: rect.y }}
      dragHandleClassName="zw-header"
      cancel=".zw-light"
      onMouseDown={() => onSelect()}
      enableResizing={ALL_EIGHT}
      minWidth={320}
      minHeight={240}
      // The 1100×900 ceiling is a USER-resize bound; a maximized window must
      // render its full geometric span without being width/height-clamped.
      maxWidth={maximized ? undefined : 1100}
      maxHeight={maximized ? undefined : 900}
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
        borderRadius: maximized ? 0 : 14,
        overflow: 'hidden',
        boxShadow: front ? '0 12px 32px rgba(0,0,0,.18)' : '0 6px 16px rgba(0,0,0,.10)'
      }}
    >
      <div className="zw-header" style={headerStyle}>
        <button
          type="button"
          className="zw-light"
          style={lightStyle('var(--z-error-red)')}
          onClick={onClose}
          aria-label="Close"
        >
          <TrafficGlyph d={GLYPHS.close} />
        </button>
        <button
          type="button"
          className="zw-light"
          style={lightStyle('var(--z-marker-yellow)')}
          onClick={onMinimize}
          aria-label="Minimize"
        >
          <TrafficGlyph d={GLYPHS.minimize} />
        </button>
        <button
          type="button"
          className="zw-light"
          style={lightStyle('var(--z-status-green)')}
          onClick={onMaximize}
          aria-label="Maximize"
        >
          <TrafficGlyph d={GLYPHS.maximize} />
        </button>
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
