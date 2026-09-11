import { DesktopCanvas } from './desktop/DesktopCanvas'
import { StatusBadge } from './components/StatusBadge'
import { bindCockpit } from './store/cockpit'
import { useWindows } from './store/windows'

bindCockpit()

function App(): React.JSX.Element {
  const open = useWindows((s) => s.open)
  const zOrder = useWindows((s) => s.zOrder)
  const minimized = useWindows((s) => s.minimized)
  const rects = useWindows((s) => s.rects)
  const focus = useWindows((s) => s.focus)
  const close = useWindows((s) => s.close)
  const minimize = useWindows((s) => s.minimize)
  const maximize = useWindows((s) => s.maximize)
  const commit = useWindows((s) => s.commit)
  return (
    <>
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
      <StatusBadge />
    </>
  )
}

export default App
