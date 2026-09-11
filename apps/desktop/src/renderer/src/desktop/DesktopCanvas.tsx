import { useEffect, useState } from 'react'
import type { RouteId } from './canvas'
import type { Rect } from '../../../shared/desktop-windows'
import type { CanvasBounds } from '../store/windows'
import { DesktopWindow } from './DesktopWindow'
import { Taskbar, TASKBAR_H } from './Taskbar'
import { ROUTES } from '../routes/registry'
import { IconLayer } from './IconLayer'
import { WallpaperLayer } from './WallpaperLayer'
import { SettingsSheet } from './SettingsSheet'
import { DummyFileViewer } from './DummyFileViewer'
import { DESKTOP_ITEMS, fileById, viewerTitle, type DesktopIcon } from './items'
import {
  hydrateDesktopPrefs,
  setIconPosition,
  setWallpaper,
  setWindowRect,
  useDesktopPrefs
} from '../store/prefs'
import { useWindows } from '../store/windows'

export type DesktopCanvasProps = {
  open: string[]
  zOrder: string[]
  minimized: string[]
  maximized: string[]
  rects: Record<string, Rect>
  onSelect: (route: string) => void
  onClose: (route: string) => void
  onMinimize: (route: string) => void
  onMaximize: (route: string, bounds: CanvasBounds) => void
  onCommit: (route: string, rect: Rect) => void
}

// Maximize spans the entire canvas edge to edge; the taskbar stays visible
// below it, so canvas height is the viewport minus the bar.
const canvasBounds = (): CanvasBounds => ({
  w: window.innerWidth,
  h: window.innerHeight - TASKBAR_H
})

const openIcon = (icon: DesktopIcon): void => {
  const prefs = useDesktopPrefs.getState()
  if (icon.kind === 'route' && icon.route) {
    useWindows.getState().openRoute(icon.route, prefs.windows[icon.route])
  } else if (icon.kind === 'file' && icon.file) {
    useWindows.getState().openFile(icon.file, prefs.windows[`file:${icon.file}`])
  }
}

export function DesktopCanvas({
  open,
  zOrder,
  minimized,
  maximized,
  rects,
  onSelect,
  onClose,
  onMinimize,
  onMaximize,
  onCommit
}: DesktopCanvasProps): React.JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const wallpaper = useDesktopPrefs((s) => s.wallpaper)
  const iconPositions = useDesktopPrefs((s) => s.icons)
  const focus = useWindows((s) => s.focus)
  useEffect(() => {
    void hydrateDesktopPrefs()
  }, [])
  useEffect(() => {
    // A maximized window must keep spanning the canvas when the app window
    // itself is resized.
    const refitMaximized = (): void => useWindows.getState().refit(canvasBounds())
    window.addEventListener('resize', refitMaximized)
    return () => window.removeEventListener('resize', refitMaximized)
  }, [])
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
      <WallpaperLayer wallpaper={wallpaper} />
      <IconLayer
        icons={DESKTOP_ITEMS.icons}
        positions={iconPositions}
        openRoutes={open}
        onOpen={openIcon}
        onCommitPos={(id, x, y) => setIconPosition(id, x, y)}
      />
      {visible.map((id) => {
        const fileWindow = id.startsWith('file:') ? fileById(id.slice(5)) : undefined
        const content = fileWindow ? <DummyFileViewer file={fileWindow} /> : null
        return (
          <DesktopWindow
            key={id}
            route={id}
            title={fileWindow ? viewerTitle(fileWindow) : undefined}
            rect={rects[id]}
            front={id === front}
            maximized={maximized.includes(id)}
            onSelect={() => (fileWindow ? focus(id) : onSelect(id))}
            onClose={() => onClose(id)}
            onMinimize={() => onMinimize(id)}
            onMaximize={() => onMaximize(id, canvasBounds())}
            onCommit={(r) => {
              if (fileWindow) {
                useWindows.getState().commit(id, r)
              } else {
                onCommit(id, r)
              }
              setWindowRect(id, r)
            }}
          >
            {content ??
              (() => {
                const Route = ROUTES[id as RouteId]
                return <Route />
              })()}
          </DesktopWindow>
        )
      })}
      <Taskbar
        open={open}
        minimized={minimized}
        front={front}
        onSelect={onSelect}
        onMinimize={onMinimize}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {settingsOpen ? (
        <SettingsSheet
          wallpaper={wallpaper}
          onKind={(kind) =>
            setWallpaper(
              kind === 'custom' && wallpaper.kind === 'custom'
                ? { kind, path: wallpaper.path, mode: wallpaper.mode }
                : { kind, mode: 'cover' }
            )
          }
          onMode={(mode) => setWallpaper({ ...wallpaper, mode })}
          onPick={() => {
            void window.zero.invoke('wallpaper.pick').then((picked) => {
              const path = typeof picked === 'string' ? picked : null
              if (path) setWallpaper({ kind: 'custom', path, mode: wallpaper.mode })
            })
          }}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  )
}
