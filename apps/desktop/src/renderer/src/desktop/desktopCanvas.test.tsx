// @vitest-environment jsdom
import { act } from 'react'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DesktopCanvas, type DesktopCanvasProps } from './DesktopCanvas'
import { TASKBAR_H } from './Taskbar'
import { initialWindows, useWindows } from '../store/windows'

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
