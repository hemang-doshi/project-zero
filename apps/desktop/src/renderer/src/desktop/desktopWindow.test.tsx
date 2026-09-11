// @vitest-environment jsdom
import { act } from 'react'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DesktopWindow, type DesktopWindowProps } from './DesktopWindow'

let container: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null

const mount = (props: DesktopWindowProps): HTMLElement => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(createElement(DesktopWindow, props))
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

const base = (over: Partial<DesktopWindowProps> = {}): DesktopWindowProps => ({
  route: 'desk',
  rect: { x: 20, y: 20, w: 560, h: 480 },
  front: true,
  maximized: false,
  onSelect: vi.fn(),
  onClose: vi.fn(),
  onMinimize: vi.fn(),
  onMaximize: vi.fn(),
  onCommit: vi.fn(),
  children: createElement('div', { 'data-body': 'true' }, 'body content'),
  ...over
})

const mouseDown = (el: Element): void => {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
}

describe('DesktopWindow click-to-front', () => {
  it('mousedown on the body brings the window to front', () => {
    const props = base()
    const el = mount(props)
    const body = el.querySelector('[data-body]') as HTMLElement
    act(() => {
      mouseDown(body)
    })
    expect(props.onSelect).toHaveBeenCalledTimes(1)
  })

  it('mousedown on the header brings the window to front', () => {
    const props = base()
    const el = mount(props)
    const header = el.querySelector('.zw-header') as HTMLElement
    act(() => {
      mouseDown(header)
    })
    expect(props.onSelect).toHaveBeenCalledTimes(1)
  })

  it('mousedown on a traffic light brings the window to front without breaking the light action', () => {
    const props = base()
    const el = mount(props)
    const light = el.querySelector('button[aria-label="Close"]') as HTMLElement
    act(() => {
      mouseDown(light)
    })
    expect(props.onSelect).toHaveBeenCalledTimes(1)
    act(() => {
      light.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('mousedown lands on the window root exactly once — no double focus from the header click', () => {
    const props = base()
    const el = mount(props)
    const header = el.querySelector('.zw-header') as HTMLElement
    act(() => {
      mouseDown(header)
    })
    expect(props.onSelect).toHaveBeenCalledTimes(1)
  })
})
