import { ROUTE_TITLES, type RouteId } from './canvas'
import { fileById, viewerTitle } from './items'
import { DesktopGlyph } from './icons'

export const TASKBAR_H = 32

export type TaskbarProps = {
  open: string[]
  minimized: string[]
  front: string | null
  onSelect: (route: string) => void
  onMinimize: (route: string) => void
  onOpenSettings: () => void
}

const titleFor = (id: string): string => {
  if (id.startsWith('file:')) {
    const f = fileById(id.slice(5))
    if (f) return viewerTitle(f)
  }
  return ROUTE_TITLES[id as RouteId] ?? id
}

const barStyle: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  height: TASKBAR_H,
  zIndex: 20,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '0 8px',
  background: 'color-mix(in srgb, var(--z-nav-cream) 85%, transparent)',
  borderTop: '1px solid var(--z-line)'
}

const buttonStyle = (active: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 24,
  padding: '0 10px',
  borderRadius: 8,
  border: `1px solid ${active ? 'var(--z-nav-border)' : 'transparent'}`,
  background: active ? 'var(--z-card-cream)' : 'transparent',
  color: 'var(--z-ink)',
  fontFamily: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
  minWidth: 0,
  flexShrink: 1
})

const labelStyle: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: 140
}

const settingsStyle: React.CSSProperties = {
  marginLeft: 'auto',
  height: 24,
  padding: '0 10px',
  borderRadius: 8,
  border: '1px solid var(--z-nav-border)',
  background: 'transparent',
  color: 'var(--z-ink)',
  fontFamily: 'inherit',
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '0.1em',
  cursor: 'pointer',
  flexShrink: 0
}

// A real taskbar: one button per open window, active highlighted, minimized
// dimmed. Clicking a button focuses/restores; clicking the front window's
// button minimizes it. No start menu, no clock.
export function Taskbar({
  open,
  minimized,
  front,
  onSelect,
  onMinimize,
  onOpenSettings
}: TaskbarProps): React.JSX.Element {
  return (
    <div className="zw-taskbar" style={barStyle}>
      {open.map((id) => {
        const isMinimized = minimized.includes(id)
        const active = id === front && !isMinimized
        const file = id.startsWith('file:') ? id.slice(5) : undefined
        return (
          <button
            key={id}
            type="button"
            data-window={id}
            data-active={active ? 'true' : undefined}
            data-minimized={isMinimized ? 'true' : undefined}
            onClick={() => (active ? onMinimize(id) : onSelect(id))}
            style={{ ...buttonStyle(active), opacity: isMinimized ? 0.55 : 1 }}
          >
            <DesktopGlyph route={file ? undefined : (id as RouteId)} file={file} size={16} />
            <span style={labelStyle}>{titleFor(id)}</span>
          </button>
        )
      })}
      <button
        type="button"
        data-settings="true"
        onClick={onOpenSettings}
        style={settingsStyle}
        aria-label="Settings"
      >
        SETTINGS
      </button>
    </div>
  )
}
