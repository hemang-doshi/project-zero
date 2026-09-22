// Pins the App-entry bridge guard (Task 16 fix round 2): a missing preload
// bridge must never white-screen the renderer — App renders a visible error
// slate instead of calling window.zero.subscribe on undefined, and binds the
// cockpit store only when the bridge exists.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import type { ComponentType } from 'react'
import { renderToString } from 'react-dom/server'

type ZeroStub = {
  invoke: (op: string, payload?: unknown) => Promise<unknown>
  subscribe: (channel: string, cb: (u: unknown) => void) => () => void
}

const setWindow = (zero: ZeroStub | undefined): void => {
  if (zero === undefined) {
    delete (globalThis as { window?: unknown }).window
  } else {
    ;(globalThis as { window?: unknown }).window = { zero }
  }
}

const loadApp = async (): Promise<{ default: ComponentType }> => {
  vi.resetModules()
  return (await import('./App')) as { default: ComponentType }
}

const subscribeStub = (): { stub: ZeroStub; calls: () => number } => {
  let calls = 0
  const stub: ZeroStub = {
    invoke: () => Promise.resolve(null),
    subscribe: () => {
      calls += 1
      return () => {}
    }
  }
  return { stub, calls: () => calls }
}

describe('App bridge guard', () => {
  afterEach(() => {
    setWindow(undefined)
    vi.restoreAllMocks()
  })

  it('renders the bridge-unavailable slate when window.zero is missing', async () => {
    setWindow(undefined)
    const { default: App } = await loadApp()
    const html = renderToString(createElement(App))
    expect(html).toContain('Desktop bridge unavailable')
    expect(html).not.toContain('Zero Desktop')
  })

  it('binds the cockpit store and renders the canvas when the bridge exists', async () => {
    const { stub, calls } = subscribeStub()
    setWindow(stub)
    const { default: App } = await loadApp()
    const html = renderToString(createElement(App))
    expect(html).not.toContain('Desktop bridge unavailable')
    expect(calls()).toBe(1)
  })
})
