import { useEffect, useState } from 'react'
import type { RouteId } from './canvas'
import type { Rect } from '../../../shared/desktop-windows'
import { DesktopWindow } from './DesktopWindow'
import { Taskbar } from './Taskbar'
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
  rects: Record<string, Rect>
  onSelect: (route: string) => void
  onClose: (route: string) => void
  onMinimize: (route: string) => void
  onMaximize: (route: string) => void
  onCommit: (route: string, rect: Rect) => void
}

const triggerStyle: React.CSSProperties = {
  border: '1px solid var(--z-nav-border)',
  borderRadius: 8,
  background: 'transparent',
  color: 'var(--z-ink)',
  fontFamily: 'inherit',
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '0.1em',
  padding: '3px 10px',
  cursor: 'pointer'
}

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
            onSelect={() => (fileWindow ? focus(id) : onSelect(id))}
            onClose={() => onClose(id)}
            onMinimize={() => onMinimize(id)}
            onMaximize={() => onMaximize(id)}
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
      <Taskbar open={open} minimized={minimized} front={front} onSelect={onSelect} />
      <div style={{ position: 'absolute', right: 10, bottom: 5, zIndex: 21 }}>
        <button type="button" style={triggerStyle} onClick={() => setSettingsOpen(true)}>
          SETTINGS
        </button>
      </div>
      {settingsOpen ? (
        <SettingsSheet
          wallpaper={wallpaper}
          onKind={(kind) =>
            setWallpaper({
              kind,
              path: wallpaper.kind === 'custom' ? wallpaper.path : undefined,
              mode: wallpaper.mode
            })
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
