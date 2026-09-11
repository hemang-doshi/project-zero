import { DesktopCanvas } from './desktop/DesktopCanvas'
import { StatusBadge } from './components/StatusBadge'
import { bindCockpit } from './store/cockpit'
import { useWindows } from './store/windows'

// The renderer must never white-screen on a missing preload bridge: bind the
// cockpit store only when `window.zero` exists, and render a visible error
// slate instead of the desktop when it does not.
const hasBridge: boolean = typeof window !== 'undefined' && window.zero !== undefined

if (hasBridge) bindCockpit()

const SLATE_STYLE: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--z-wallpaper)',
  color: 'var(--z-ink)',
  fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
  fontSize: 14
}

function App(): React.JSX.Element {
  const open = useWindows((s) => s.open)
  const zOrder = useWindows((s) => s.zOrder)
  const minimized = useWindows((s) => s.minimized)
  const maximized = useWindows((s) => s.maximized)
  const snapped = useWindows((s) => s.snapped)
  const rects = useWindows((s) => s.rects)
  const focus = useWindows((s) => s.focus)
  const close = useWindows((s) => s.close)
  const minimize = useWindows((s) => s.minimize)
  const maximize = useWindows((s) => s.maximize)
  const commit = useWindows((s) => s.commit)
  if (!hasBridge) {
    return (
      <div style={SLATE_STYLE}>
        Desktop bridge unavailable — renderer could not connect to the main process
      </div>
    )
  }
  return (
    <>
      <DesktopCanvas
        open={open}
        zOrder={zOrder}
        minimized={minimized}
        maximized={maximized}
        snapped={snapped}
        rects={rects}
        onSelect={focus}
        onClose={close}
        onMinimize={minimize}
        onMaximize={maximize}
        onCommit={commit}
      />
      <StatusBadge />
    </>
  )
}

export default App
