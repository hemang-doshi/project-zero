// @vitest-environment jsdom
import { act } from 'react'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { IconLayer } from './IconLayer'
import type { DesktopIcon } from './items'

let container: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  container = null
  root = null
})

const icons: DesktopIcon[] = [{ id: 'i-desk', label: 'Desk', kind: 'route', route: 'desk' }]

const pointer = (type: string, x: number, y: number): MouseEvent =>
  new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })

describe('IconLayer grid snap', () => {
  it('previews the snapped slot live and commits it only on drop', () => {
    const onCommitPos = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root?.render(
        createElement(IconLayer, {
          icons,
          positions: {},
          openRoutes: [],
          onOpen: () => {},
          onCommitPos
        })
      )
    })
    const node = container.querySelector('.zw-icon') as HTMLElement
    // Seed slot for index 0 is (24, 28).
    expect(node.style.left).toBe('24px')
    expect(node.style.top).toBe('28px')
    act(() => {
      node.dispatchEvent(pointer('pointerdown', 100, 100))
    })
    // Raw drag target (100, 90) is free; the live preview shows slot (112, 124).
    act(() => {
      node.dispatchEvent(pointer('pointermove', 176, 162))
    })
    expect(node.style.left).toBe('112px')
    expect(node.style.top).toBe('124px')
    // Commit-on-drop only: nothing persists mid-drag.
    expect(onCommitPos).not.toHaveBeenCalled()
    act(() => {
      node.dispatchEvent(pointer('pointerup', 176, 162))
    })
    expect(onCommitPos).toHaveBeenCalledTimes(1)
    expect(onCommitPos).toHaveBeenCalledWith('i-desk', 112, 124)
  })

  it('does not commit when the pointer never moves past the threshold', () => {
    const onCommitPos = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root?.render(
        createElement(IconLayer, {
          icons,
          positions: {},
          openRoutes: [],
          onOpen: () => {},
          onCommitPos
        })
      )
    })
    const node = container.querySelector('.zw-icon') as HTMLElement
    act(() => {
      node.dispatchEvent(pointer('pointerdown', 100, 100))
    })
    act(() => {
      node.dispatchEvent(pointer('pointerup', 101, 101))
    })
    expect(onCommitPos).not.toHaveBeenCalled()
  })
})
