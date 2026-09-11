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
