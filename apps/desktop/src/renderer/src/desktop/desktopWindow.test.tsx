// @vitest-environment jsdom
import { act } from 'react'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DesktopWindow, type DesktopWindowProps } from './DesktopWindow'

const indexCss = (): string =>
  readFileSync(join(process.cwd(), 'src/renderer/src/index.css'), 'utf8')

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

  it('a maximized window is not clamped by the user-resize ceiling', () => {
    const el = mount(
      base({
        maximized: true,
        rect: { x: 0, y: 0, w: 1400, h: 932 }
      })
    )
    const root = el.firstElementChild as HTMLElement
    expect(root.style.width).toBe('1400px')
    expect(root.style.maxWidth).not.toBe('1100px')
  })

  it('a normal window keeps the user-resize ceiling', () => {
    const el = mount(base())
    const root = el.firstElementChild as HTMLElement
    expect(root.style.maxWidth).toBe('1100px')
  })
})

describe('DesktopWindow traffic light hover glyphs', () => {
  const lightFor = (el: HTMLElement, label: string): HTMLElement =>
    el.querySelector(`button[aria-label="${label}"]`) as HTMLElement

  it('each traffic light keeps its 18px hit target and carries a glyph', () => {
    const el = mount(base())
    for (const label of ['Close', 'Minimize', 'Maximize']) {
      const light = lightFor(el, label)
      expect(light.className).toContain('zw-light')
      expect(light.style.width).toBe('18px')
      expect(light.style.height).toBe('18px')
      expect(light.querySelector('svg.zw-glyph')).not.toBeNull()
    }
  })

  it('the three glyphs are distinct shapes matching their semantics', () => {
    const el = mount(base())
    const d = Object.fromEntries(
      ['Close', 'Minimize', 'Maximize'].map((label) => {
        const svg = lightFor(el, label).querySelector('svg.zw-glyph') as SVGElement
        const parts = [...svg.querySelectorAll('path')].map((p) => p.getAttribute('d') ?? '')
        return [label, parts.join(' ')]
      })
    )
    expect(new Set(Object.values(d)).size).toBe(3)
    const subpaths = (s: string): number => s.split('M').length - 1
    expect(subpaths(d['Close'])).toBe(2)
    expect(subpaths(d['Minimize'])).toBe(1)
    expect(subpaths(d['Maximize'])).toBe(6)
    expect(d['Minimize']).toMatch(/^M[\d.]+,5 L[\d.]+,5$/)
  })

  it('the header hover reveals the glyphs per the header CSS', () => {
    const cssText = indexCss()
    const baseRule = cssText.match(/\.zw-header \.zw-glyph\s*\{([^}]*)\}/)
    expect(baseRule).not.toBeNull()
    expect(baseRule?.[1]).toContain('opacity: 0')
    expect(baseRule?.[1]).toContain('transition')
    const hoverRule = cssText.match(/\.zw-header:hover \.zw-glyph\s*\{([^}]*)\}/)
    expect(hoverRule).not.toBeNull()
    expect(hoverRule?.[1]).toContain('opacity: 1')
  })
})
