import { ROUTE_TITLES, type RouteId } from './canvas'

export type TaskbarProps = {
  open: string[]
  minimized: string[]
  front: string | null
  onSelect: (route: string) => void
}

export function Taskbar({ open, minimized, front, onSelect }: TaskbarProps): React.JSX.Element {
  return (
    <div
      className="zw-taskbar"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        background: 'var(--z-nav-cream)',
        borderTop: '1px solid var(--z-nav-border)'
      }}
    >
      {open.map((route) => (
        <button
          key={route}
          type="button"
          onClick={() => onSelect(route)}
          style={{
            border: '1px solid var(--z-nav-border)',
            borderRadius: 8,
            background: route === front ? 'var(--z-card-cream)' : 'transparent',
            color: 'var(--z-ink)',
            padding: '3px 10px',
            fontSize: 12,
            cursor: 'pointer',
            opacity: minimized.includes(route) ? 0.6 : 1
          }}
        >
          {ROUTE_TITLES[route as RouteId] ?? route}
        </button>
      ))}
    </div>
  )
}
