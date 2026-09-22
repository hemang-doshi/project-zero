// @vitest-environment jsdom
import { act } from 'react'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Taskbar, TASKBAR_H, type TaskbarProps } from './Taskbar'
import { viewerTitle } from './items'

let container: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null

const mount = (props: TaskbarProps): HTMLElement => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(createElement(Taskbar, props))
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

const base = (over: Partial<TaskbarProps> = {}): TaskbarProps => ({
  open: ['desk', 'runtime', 'file:readme'],
  minimized: ['desk'],
  front: 'runtime',
  onSelect: vi.fn(),
  onMinimize: vi.fn(),
  onOpenSettings: vi.fn(),
  ...over
})

describe('taskbar', () => {
  it('has a compact fixed height', () => {
    expect(TASKBAR_H).toBe(32)
  })

  it('renders one button per open window with glyph and title', () => {
    const el = mount(base())
    const buttons = el.querySelectorAll('button[data-window]')
    expect(buttons).toHaveLength(3)
    const text = el.textContent ?? ''
    expect(text).toContain('Desk')
    expect(text).toContain('Runtime')
    expect(text).toContain(
      viewerTitle({ id: 'readme', name: 'README.txt', ext: 'txt', content: '' })
    )
    expect(el.querySelectorAll('button[data-window] svg[data-glyph]')).toHaveLength(3)
  })

  it('highlights the front window button and dims minimized ones', () => {
    const el = mount(base())
    expect(el.querySelector('button[data-window="runtime"]')?.getAttribute('data-active')).toBe(
      'true'
    )
    expect(el.querySelector('button[data-window="desk"]')?.getAttribute('data-active')).not.toBe(
      'true'
    )
    expect(el.querySelector('button[data-window="desk"]')?.getAttribute('data-minimized')).toBe(
      'true'
    )
    expect(
      el.querySelector('button[data-window="runtime"]')?.getAttribute('data-minimized')
    ).not.toBe('true')
  })

  it('clicking the front window button minimizes it', () => {
    const props = base()
    const el = mount(props)
    const btn = el.querySelector('button[data-window="runtime"]') as HTMLButtonElement
    act(() => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(props.onMinimize).toHaveBeenCalledWith('runtime')
    expect(props.onSelect).not.toHaveBeenCalled()
  })

  it('clicking a background or minimized button focuses and restores it', () => {
    const props = base()
    const el = mount(props)
    act(() => {
      ;(el.querySelector('button[data-window="desk"]') as HTMLButtonElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
    })
    act(() => {
      ;(el.querySelector('button[data-window="file:readme"]') as HTMLButtonElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
    })
    expect(props.onSelect).toHaveBeenCalledWith('desk')
    expect(props.onSelect).toHaveBeenCalledWith('file:readme')
    expect(props.onMinimize).not.toHaveBeenCalled()
  })

  it('carries only the settings control besides window buttons — no start menu, no clock', () => {
    const props = base()
    const el = mount(props)
    expect(el.querySelectorAll('button')).toHaveLength(4)
    expect(el.querySelector('button[data-settings]')).not.toBeNull()
    act(() => {
      ;(el.querySelector('button[data-settings]') as HTMLButtonElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
    })
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1)
    expect(el.textContent ?? '').not.toMatch(/\d{1,2}:\d{2}/)
  })
})
