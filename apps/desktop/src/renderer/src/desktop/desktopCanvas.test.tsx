// @vitest-environment jsdom
import { act } from 'react'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DesktopCanvas, type DesktopCanvasProps } from './DesktopCanvas'
import { TASKBAR_H } from './Taskbar'
import { initialWindows, useWindows } from '../store/windows'
import { useDesktopPrefs } from '../store/prefs'

let container: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null

const mount = (props: DesktopCanvasProps): HTMLElement => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(createElement(DesktopCanvas, props))
  })
  return container
}

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  container = null
  root = null
})

const base = (): DesktopCanvasProps => ({
  open: ['desk'],
  zOrder: ['desk'],
  minimized: [],
  maximized: [],
  snapped: {},
  rects: { desk: { x: 8, y: 8, w: 400, h: 300 } },
  onSelect: vi.fn(),
  onClose: vi.fn(),
  onMinimize: vi.fn(),
  onMaximize: (route, bounds) => useWindows.getState().maximize(route, bounds),
  onCommit: vi.fn()
})

describe('DesktopCanvas maximize wiring', () => {
  beforeEach(() => {
    useWindows.setState(initialWindows())
  })

  it('the green light maximizes through the full canvas bounds, taskbar excluded', () => {
    const el = mount(base())
    const light = el.querySelector('button[aria-label="Maximize"]') as HTMLElement
    act(() => {
      light.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(useWindows.getState().rects.desk).toEqual({
      x: 0,
      y: 0,
      w: window.innerWidth,
      h: window.innerHeight - TASKBAR_H
    })
    expect(useWindows.getState().maximized).toEqual(['desk'])
  })

  it('viewport resize refits maximized windows', () => {
    mount(base())
    act(() => {
      useWindows.getState().maximize('desk', {
        w: window.innerWidth,
        h: window.innerHeight - TASKBAR_H
      })
      window.dispatchEvent(new Event('resize'))
    })
    expect(useWindows.getState().rects.desk).toEqual({
      x: 0,
      y: 0,
      w: window.innerWidth,
      h: window.innerHeight - TASKBAR_H
    })
  })

  it('renders the real taskbar with window buttons', () => {
    const el = mount(base())
    expect(el.querySelector('button[data-window="desk"]')).not.toBeNull()
  })
})

type FakeInvoke = (op: string, payload?: unknown) => Promise<unknown>

const stubZeroInJsdom = (invoke: FakeInvoke): void => {
  ;(window as unknown as { zero?: unknown }).zero = { invoke, subscribe: () => () => {} }
}

const click = (el: HTMLElement): void => {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('DesktopCanvas wallpaper pick flow', () => {
  let resolvePick: (value: string | null) => void = () => {}
  let setPatches: unknown[] = []
  let invoke: ReturnType<typeof vi.fn> | null = null

  const resetStores = (): void => {
    useWindows.setState(initialWindows())
    useDesktopPrefs.setState({
      wallpaper: { kind: 'dotted-green', mode: 'cover' },
      icons: {},
      windows: {},
      snaps: {},
      loaded: false
    })
  }

  const mountWithZero = async (
    initialWallpaper: Record<string, unknown> = { kind: 'dotted-green', mode: 'cover' }
  ): Promise<HTMLElement> => {
    resetStores()
    setPatches = []
    invoke = vi.fn((op: string, payload?: unknown) => {
      if (op === 'prefs.get') {
        return Promise.resolve({
          wallpaper: initialWallpaper,
          icons: {},
          windows: {}
        })
      }
      if (op === 'prefs.set') {
        setPatches.push(payload)
        return Promise.resolve({})
      }
      if (op === 'wallpaper.pick') {
        return new Promise((res) => {
          resolvePick = res as (value: string | null) => void
        })
      }
      return Promise.reject(new Error(`unexpected op ${op}`))
    })
    stubZeroInJsdom(invoke as unknown as FakeInvoke)
    const el = mount(base())
    await act(async () => {
      await Promise.resolve()
    })
    return el
  }

  afterEach(() => {
    delete (window as unknown as { zero?: unknown }).zero
    resetStores()
  })

  const openPickDialog = (el: HTMLElement): void => {
    click(el.querySelector('button[data-settings="true"]') as HTMLElement)
    const custom = [...(el.querySelectorAll('#settings button') ?? [])].find((b) =>
      (b.textContent ?? '').includes('Custom')
    )
    expect(custom).toBeDefined()
    click(custom as HTMLElement)
    const pick = [...(el.querySelectorAll('#settings button') ?? [])].find((b) =>
      (b.textContent ?? '').includes('CHOOSE IMAGE')
    )
    expect(pick).toBeDefined()
    click(pick as HTMLElement)
  }

  it('a picked path switches to custom and persists the full wallpaper patch', async () => {
    const el = await mountWithZero()
    openPickDialog(el)
    await act(async () => {
      resolvePick('/tmp/picked.png')
      await Promise.resolve()
    })
    expect(useDesktopPrefs.getState().wallpaper).toEqual({
      kind: 'custom',
      path: '/tmp/picked.png',
      mode: 'cover'
    })
    expect(invoke).toHaveBeenCalledWith('prefs.set', {
      wallpaper: { kind: 'custom', path: '/tmp/picked.png', mode: 'cover' }
    })
  })

  it('a cancelled pick keeps the fallback texture and persists no picked path', async () => {
    const el = await mountWithZero()
    openPickDialog(el)
    await act(async () => {
      resolvePick(null)
      await Promise.resolve()
    })
    expect(useDesktopPrefs.getState().wallpaper).toEqual({
      kind: 'custom',
      mode: 'cover'
    })
    for (const patch of setPatches) {
      expect((patch as { wallpaper?: { path?: string } }).wallpaper?.path).toBeUndefined()
    }
  })

  it('a fresh pick from a bundled kind defaults to cover even when a stale tile mode is stored', async () => {
    const el = await mountWithZero({ kind: 'dotted-green', mode: 'tile' })
    openPickDialog(el)
    await act(async () => {
      resolvePick('/tmp/picked.png')
      await Promise.resolve()
    })
    expect(useDesktopPrefs.getState().wallpaper).toEqual({
      kind: 'custom',
      path: '/tmp/picked.png',
      mode: 'cover'
    })
    expect(invoke).toHaveBeenCalledWith('prefs.set', {
      wallpaper: { kind: 'custom', path: '/tmp/picked.png', mode: 'cover' }
    })
  })

  it('leaving custom resets the mode so a stale tile never persists', async () => {
    const el = await mountWithZero({ kind: 'custom', path: '/w.png', mode: 'tile' })
    click(el.querySelector('button[data-settings="true"]') as HTMLElement)
    const dotted = [...(el.querySelectorAll('#settings button') ?? [])].find((b) =>
      (b.textContent ?? '').includes('Dotted Green')
    )
    expect(dotted).toBeDefined()
    click(dotted as HTMLElement)
    expect(useDesktopPrefs.getState().wallpaper).toEqual({ kind: 'dotted-green', mode: 'cover' })
    expect(invoke).toHaveBeenCalledWith('prefs.set', {
      wallpaper: { kind: 'dotted-green', mode: 'cover' }
    })
  })
})

describe('DesktopCanvas window snap', () => {
  let invoke: ReturnType<typeof vi.fn>

  const canvasBounds = (): { w: number; h: number } => ({
    w: window.innerWidth,
    h: window.innerHeight - TASKBAR_H
  })

  beforeEach(() => {
    useWindows.setState(initialWindows())
    useDesktopPrefs.setState({
      wallpaper: { kind: 'dotted-green', mode: 'cover' },
      icons: {},
      windows: {},
      snaps: {},
      loaded: false
    })
    invoke = vi.fn(() => Promise.resolve({}))
    ;(window as unknown as { zero?: unknown }).zero = {
      invoke,
      subscribe: () => () => {}
    }
  })

  afterEach(() => {
    delete (window as unknown as { zero?: unknown }).zero
  })

  const headerOf = (el: HTMLElement): HTMLElement => el.querySelector('.zw-header') as HTMLElement

  // Drives the real react-rnd drag path: mousedown on the header, mousemove
  // on the document, mouseup on the document.
  const dragHeaderBy = (el: HTMLElement, dx: number, dy: number): void => {
    act(() => {
      headerOf(el).dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 100, clientY: 100 })
      )
    })
    act(() => {
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          button: 0,
          clientX: 100 + dx,
          clientY: 100 + dy
        })
      )
    })
  }

  const dropHeader = (dx: number, dy: number): void => {
    // The release point IS the drop position (react-draggable reads it off
    // the mouseup), so it must carry the pointer coordinates.
    act(() => {
      document.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          button: 0,
          clientX: 100 + dx,
          clientY: 100 + dy
        })
      )
    })
  }

  const dragAndDrop = (el: HTMLElement, dx: number, dy: number): void => {
    dragHeaderBy(el, dx, dy)
    dropHeader(dx, dy)
  }

  const previewKind = (el: HTMLElement): string | null =>
    el.querySelector('[data-snap-preview]')?.getAttribute('data-snap-preview') ?? null

  it('dragging to the left edge shows the snap preview, release snaps the window', () => {
    const props = base()
    const el = mount(props)
    // The pointer starts at the mousedown (100,100): dx=-80 puts it at x=20.
    dragHeaderBy(el, -80, 100)
    expect(previewKind(el)).toBe('left')
    dropHeader(-80, 100)
    expect(previewKind(el)).toBeNull()
    const bounds = canvasBounds()
    expect(useWindows.getState().snapped).toEqual({ desk: 'left' })
    expect(useWindows.getState().rects.desk).toEqual({
      x: 0,
      y: 0,
      w: bounds.w / 2,
      h: bounds.h
    })
    expect(props.onCommit).not.toHaveBeenCalled()
  })

  it('a snap persists the snapped rect plus the kind and pre-snap rect', () => {
    const el = mount(base())
    dragAndDrop(el, -80, 100)
    const bounds = canvasBounds()
    expect(invoke).toHaveBeenCalledWith('prefs.set', {
      windows: { desk: { x: 0, y: 0, w: bounds.w / 2, h: bounds.h } }
    })
    expect(invoke).toHaveBeenCalledWith('prefs.set', {
      snaps: { desk: { kind: 'left', preSnap: { x: 0, y: 0, w: 560, h: 480 } } }
    })
    expect(useDesktopPrefs.getState().snaps.desk).toEqual({
      kind: 'left',
      preSnap: { x: 0, y: 0, w: 560, h: 480 }
    })
  })

  it('a mid-canvas drop commits plain with no snap', () => {
    const props = base()
    const el = mount(props)
    dragHeaderBy(el, 200, 100)
    expect(previewKind(el)).toBeNull()
    dropHeader(200, 100)
    expect(useWindows.getState().snapped).toEqual({})
    expect(props.onCommit).toHaveBeenCalledTimes(1)
    expect(props.onCommit).toHaveBeenCalledWith('desk', { x: 208, y: 108, w: 400, h: 300 })
  })

  it('dragging a snapped window far away un-snaps back to the pre-snap rect', () => {
    const el = mount(base())
    dragAndDrop(el, -80, 100)
    expect(useWindows.getState().snapped).toEqual({ desk: 'left' })
    // A full-height half can still un-snap: zones read the pointer, so a
    // mid-canvas release trips no zone and falls away from the anchor.
    dragAndDrop(el, 300, 100)
    expect(useWindows.getState().snapped).toEqual({})
    expect(useWindows.getState().rects.desk).toEqual({ x: 0, y: 0, w: 560, h: 480 })
    expect(invoke).toHaveBeenCalledWith('prefs.set', { snaps: { desk: null } })
  })

  it('dragging edge to edge moves the snap and keeps the original pre-snap', () => {
    const el = mount(base())
    dragAndDrop(el, -80, 100)
    expect(useWindows.getState().snapped).toEqual({ desk: 'left' })
    // Pointer to x=1000: the right edge at the jsdom 1024px viewport.
    dragAndDrop(el, 900, 100)
    const bounds = canvasBounds()
    expect(useWindows.getState().snapped).toEqual({ desk: 'right' })
    expect(useWindows.getState().rects.desk).toEqual({
      x: bounds.w / 2,
      y: 0,
      w: bounds.w / 2,
      h: bounds.h
    })
    expect(useDesktopPrefs.getState().snaps.desk).toEqual({
      kind: 'right',
      preSnap: { x: 0, y: 0, w: 560, h: 480 }
    })
  })

  it('a top-edge drop maximizes through the existing maximize path', () => {
    const el = mount(base())
    // Pointer to y=20: the top edge (dy=-80 from the 100 mousedown).
    dragAndDrop(el, 200, -80)
    expect(useWindows.getState().maximized).toEqual(['desk'])
    expect(useWindows.getState().snapped).toEqual({})
    const bounds = canvasBounds()
    expect(useWindows.getState().rects.desk).toEqual({ x: 0, y: 0, w: bounds.w, h: bounds.h })
  })

  it('viewport resize refits snapped windows against the new bounds', () => {
    mount(base())
    act(() => {
      useWindows.getState().snap('desk', 'left', canvasBounds())
      window.dispatchEvent(new Event('resize'))
    })
    expect(useWindows.getState().rects.desk).toEqual({
      x: 0,
      y: 0,
      w: window.innerWidth / 2,
      h: window.innerHeight - TASKBAR_H
    })
    expect(useWindows.getState().snapped).toEqual({ desk: 'left' })
  })
})
