import { useRef, useState } from 'react'
import { ICON_H, ICON_W, fileById, iconGridPos, snapIconToGrid, type DesktopIcon } from './items'
import { FileGlyph, RouteGlyph } from './icons'
import { ZERO_TOKENS } from '../../../shared/tokens'

export type IconLayerProps = {
  icons: DesktopIcon[]
  positions: Record<string, { x: number; y: number }>
  openRoutes: string[]
  onOpen: (icon: DesktopIcon) => void
  onCommitPos: (id: string, x: number, y: number) => void
}

type DragState = {
  id: string
  px: number
  py: number
  ox: number
  oy: number
  x: number
  y: number
  moved: boolean
}

const layerStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none'
}

const tileStyle: React.CSSProperties = {
  width: ICON_W,
  height: ICON_H,
  pointerEvents: 'auto',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 6,
  cursor: 'grab',
  touchAction: 'none',
  userSelect: 'none'
}

// Inner shade derived from the ink token — never a hardcoded rgb.
const hexToRgba = (hex: string, alpha: number): string => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

const inkShade = hexToRgba(ZERO_TOKENS.ink, 0.05)

const faceStyle: React.CSSProperties = {
  position: 'relative',
  width: 52,
  height: 52,
  borderRadius: 13,
  border: '1px solid var(--z-line)',
  background: 'linear-gradient(180deg, var(--z-card-cream) 0%, var(--z-canvas-tan) 100%)',
  boxShadow: `inset 0 1px 0 var(--z-card-white), inset 0 -6px 10px ${inkShade}, 0 3px 9px rgba(0,0,0,.14)`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--z-ink)'
}

const dotStyle: React.CSSProperties = {
  position: 'absolute',
  top: 5,
  right: 5,
  width: 9,
  height: 9,
  borderRadius: 5,
  background: 'var(--z-status-green)'
}

// Files are documents, not applications: the folded-corner paper glyph draws
// its own shape, so the face stays transparent — never the sculpted app tile.
const fileFaceStyle: React.CSSProperties = {
  position: 'relative',
  width: 52,
  height: 52,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  filter: 'drop-shadow(0 3px 4px rgba(0,0,0,.18))'
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  lineHeight: 1.2,
  color: 'var(--z-ink)',
  textAlign: 'center',
  maxWidth: ICON_W,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  // Subtle cream glow keeps labels readable over wallpaper without a box.
  textShadow: '0 1px 2px var(--z-card-cream), 0 0 8px var(--z-card-cream)'
}

export function IconLayer({
  icons,
  positions,
  openRoutes,
  onOpen,
  onCommitPos
}: IconLayerProps): React.JSX.Element {
  const [live, setLive] = useState<Record<string, { x: number; y: number }>>({})
  const drag = useRef<DragState | null>(null)
  const lastDragAt = useRef(0)

  const posOf = (icon: DesktopIcon): { x: number; y: number } =>
    live[icon.id] ?? positions[icon.id] ?? iconGridPos(icons.indexOf(icon))

  return (
    <div className="zw-icons" style={layerStyle}>
      {icons.map((icon) => {
        const pos = posOf(icon)
        const running = icon.kind === 'route' && openRoutes.includes(icon.route ?? '')
        const isFile = icon.kind === 'file'
        return (
          <div
            key={icon.id}
            className="zw-icon"
            data-kind={icon.kind}
            data-route={icon.route}
            data-file={icon.file}
            data-running={running ? 'true' : undefined}
            style={{ position: 'absolute', left: pos.x, top: pos.y, width: ICON_W, height: ICON_H }}
            onPointerDown={(e) => {
              if (drag.current) return
              const p = posOf(icon)
              drag.current = {
                id: icon.id,
                px: e.clientX,
                py: e.clientY,
                ox: p.x,
                oy: p.y,
                x: p.x,
                y: p.y,
                moved: false
              }
              e.currentTarget.setPointerCapture?.(e.pointerId)
            }}
            onPointerMove={(e) => {
              const d = drag.current
              if (!d || d.id !== icon.id) return
              const dx = e.clientX - d.px
              const dy = e.clientY - d.py
              if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true
              if (d.moved) {
                // The live preview already shows the snapped slot; the drop
                // commits exactly what the user sees.
                const slot = snapIconToGrid({ x: d.ox + dx, y: d.oy + dy })
                d.x = slot.x
                d.y = slot.y
                setLive((prev) => ({ ...prev, [icon.id]: { x: d.x, y: d.y } }))
              }
            }}
            onPointerUp={() => {
              const d = drag.current
              if (!d || d.id !== icon.id) return
              drag.current = null
              if (d.moved) {
                lastDragAt.current = Date.now()
                // Commit-on-drop only: nothing persists mid-drag.
                const slot = snapIconToGrid({ x: d.x, y: d.y })
                onCommitPos(icon.id, slot.x, slot.y)
              }
              setLive((prev) => {
                const next = { ...prev }
                delete next[icon.id]
                return next
              })
            }}
            onDoubleClick={() => {
              if (Date.now() - lastDragAt.current < 400) return
              onOpen(icon)
            }}
          >
            <div style={tileStyle}>
              {isFile ? (
                <div style={fileFaceStyle}>
                  <FileGlyph ext={fileById(icon.file ?? '')?.ext ?? 'txt'} size={46} />
                </div>
              ) : (
                <div style={faceStyle}>
                  <RouteGlyph route={icon.route ?? ''} size={30} />
                  {running ? <span data-dot="true" style={dotStyle} /> : null}
                </div>
              )}
              <span style={labelStyle}>{icon.label}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
