import { useEffect, useState } from 'react'
import type { RouteId } from './canvas'
import type { Rect } from '../../../shared/desktop-windows'
import {
  detectSnapZone,
  isSnapEntry,
  resolveDrop,
  snapRectFor,
  type SnapKind,
  type SnapTarget
} from '../../../shared/desktop-snap'
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
  setWindowSnap,
  useDesktopPrefs
} from '../store/prefs'
import { getSnapEntry, useWindows } from '../store/windows'

export type DesktopCanvasProps = {
  open: string[]
  zOrder: string[]
  minimized: string[]
  maximized: string[]
  snapped: Record<string, SnapKind>
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
  const windows = useWindows.getState()
  const bounds = canvasBounds()
  if (icon.kind === 'route' && icon.route) {
    windows.openRoute(icon.route, prefs.windows[icon.route])
    // A reopened window re-snaps against the current canvas, like reload.
    const entry = prefs.snaps[icon.route]
    if (isSnapEntry(entry)) windows.hydrateSnaps({ [icon.route]: entry }, bounds)
  } else if (icon.kind === 'file' && icon.file) {
    const id = `file:${icon.file}`
    windows.openFile(icon.file, prefs.windows[id])
    const entry = prefs.snaps[id]
    if (isSnapEntry(entry)) windows.hydrateSnaps({ [id]: entry }, bounds)
  }
}

type DragPreview = { route: string; kind: SnapTarget; rect: Rect }

export function DesktopCanvas({
  open,
  zOrder,
  minimized,
  maximized,
  snapped,
  rects,
  onSelect,
  onClose,
  onMinimize,
  onMaximize,
  onCommit
}: DesktopCanvasProps): React.JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null)
  const wallpaper = useDesktopPrefs((s) => s.wallpaper)
  const iconPositions = useDesktopPrefs((s) => s.icons)
  const focus = useWindows((s) => s.focus)
  useEffect(() => {
    void hydrateDesktopPrefs(canvasBounds())
  }, [])
  useEffect(() => {
    // Maximized and snapped windows keep spanning the canvas when the app
    // window itself is resized (the store refits both from their kinds).
    const refitTiled = (): void => useWindows.getState().refit(canvasBounds())
    window.addEventListener('resize', refitTiled)
    return () => window.removeEventListener('resize', refitTiled)
  }, [])

  const handleDragMove = (id: string, pointer: { x: number; y: number }): void => {
    const bounds = canvasBounds()
    // Pointer semantics: a zero-size probe means the cursor itself must meet
    // the edge, matching the mandate's "header within threshold" wording.
    const zone = detectSnapZone(pointer, { w: 0, h: 0 }, bounds)
    setDragPreview((cur) => {
      if (!zone) return cur?.route === id ? null : cur
      if (cur?.route === id && cur.kind === zone) return cur
      return { route: id, kind: zone, rect: snapRectFor(zone, bounds) }
    })
  }

  const handleDrop = (id: string, element: Rect, pointer: { x: number; y: number }): void => {
    setDragPreview(null)
    const st = useWindows.getState()
    const bounds = canvasBounds()
    const decision = resolveDrop({
      currentSnap: st.snapped[id] ?? null,
      maximized: st.maximized.includes(id),
      pos: pointer,
      size: { w: 0, h: 0 },
      bounds
    })
    if (decision.type === 'snap') {
      // The top edge routes to maximize through the existing path; every
      // other zone snaps. Snapping a maximized window replaces maximize
      // (and vice versa) inside the store.
      if (decision.kind === 'maximize') st.maximize(id, bounds)
      else st.snap(id, decision.kind, bounds)
      const rect = useWindows.getState().rects[id]
      setWindowRect(id, rect)
      setWindowSnap(id, getSnapEntry(id))
      return
    }
    if (decision.type === 'unsnap') {
      st.unsnap(id)
      const rect = useWindows.getState().rects[id]
      setWindowRect(id, rect)
      setWindowSnap(id, null)
      return
    }
    if (decision.type === 'stay') return
    // A plain drop commits the dragged element position (Task 19 path).
    if (id.startsWith('file:')) {
      useWindows.getState().commit(id, element)
    } else {
      onCommit(id, element)
    }
    setWindowRect(id, element)
  }

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
            snapped={snapped[id] !== undefined}
            onSelect={() => (fileWindow ? focus(id) : onSelect(id))}
            onClose={() => onClose(id)}
            onMinimize={() => onMinimize(id)}
            onMaximize={() => onMaximize(id, canvasBounds())}
            onCommit={(r) => {
              // Resize path only: drag releases ride onDragEnd below, so a
              // resize handle parked at a canvas edge can never trip a zone.
              // A resize on a snapped window clears the snap in the store;
              // mirror that erasure into prefs here.
              const wasSnapped = useWindows.getState().snapped[id] !== undefined
              if (id.startsWith('file:')) {
                useWindows.getState().commit(id, r)
              } else {
                onCommit(id, r)
              }
              setWindowRect(id, r)
              if (wasSnapped) setWindowSnap(id, getSnapEntry(id))
            }}
            onDragMove={(pointer) => handleDragMove(id, pointer)}
            onDragEnd={(element, pointer) => handleDrop(id, element, pointer)}
          >
            {content ??
              (() => {
                const Route = ROUTES[id as RouteId]
                return <Route />
              })()}
          </DesktopWindow>
        )
      })}
      {dragPreview ? (
        <div
          data-snap-preview={dragPreview.kind}
          style={{
            position: 'absolute',
            left: dragPreview.rect.x,
            top: dragPreview.rect.y,
            width: dragPreview.rect.w,
            height: dragPreview.rect.h,
            background: 'color-mix(in srgb, var(--z-highlight-blue) 18%, transparent)',
            border: '1px solid var(--z-highlight-blue)',
            borderRadius: dragPreview.kind === 'maximize' ? 0 : 12,
            pointerEvents: 'none',
            zIndex: 15
          }}
        />
      ) : null}
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
