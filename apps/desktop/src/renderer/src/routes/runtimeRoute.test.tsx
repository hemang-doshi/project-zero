// @vitest-environment jsdom
import { act } from 'react'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { RuntimeRoute } from './RuntimeRoute'
import { useCockpit } from '../store/cockpit'

const SAMPLE = {
  cpu: 4.25,
  ram: { used: 12_000_000_000, total: 16_000_000_000, percent: 75 },
  ssd: { used: 100_000_000_000, total: 245_000_000_000, percent: 40.8 },
  gpu: null
}

let container: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null

const fakeZero = (impl: () => Promise<unknown>): { invoke: ReturnType<typeof vi.fn> } => {
  const invoke = vi.fn(impl)
  ;(window as unknown as { zero: unknown }).zero = {
    invoke,
    subscribe: vi.fn(() => () => {})
  }
  return { invoke }
}

const flush = async (): Promise<void> => {
  await act(async () => {})
}

const mountRoute = async (): Promise<HTMLElement> => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(RuntimeRoute))
  })
  await flush()
  return container
}

const setVisibility = (state: string): void => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
}

beforeEach(() => {
  useCockpit.setState({ state: 'connecting', snapshot: null, lastError: null, refreshAt: null })
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  container?.remove()
  container = null
  root = null
  delete (window as unknown as { zero?: unknown }).zero
  setVisibility('visible')
  vi.useRealTimers()
})

describe('RuntimeRoute telemetry tiles', () => {
  it('renders real values from the sampler payload', async () => {
    const { invoke } = fakeZero(() => Promise.resolve(SAMPLE))
    const el = await mountRoute()
    const text = el.textContent ?? ''
    expect(text).toContain('4.3%')
    expect(text).toContain('processor load')
    expect(text).toContain('75%')
    expect(text).toContain('12.0 GB of 16.0 GB used')
    expect(text).toContain('41%')
    expect(text).toContain('100.0 GB of 245.0 GB used')
    expect(text).toContain('GPU')
    expect(text).toContain('Unavailable')
    expect(text).toContain('main-process sampler')
    expect(text).toContain('GPU unavailable')
    expect(invoke).toHaveBeenCalledWith('telemetry.sample')
  })

  it('shows honest placeholders when the op errors before any sample', async () => {
    fakeZero(() => Promise.reject(new Error('nope')))
    const el = await mountRoute()
    const text = el.textContent ?? ''
    expect(text).toContain('—')
    expect(text).not.toContain('%')
    expect(text).toContain('Unavailable')
    expect(text).toContain('main-process sampler')
  })

  it('keeps the last good sample when a later pull errors (cached semantics)', async () => {
    let calls = 0
    fakeZero(() => (calls++ === 0 ? Promise.resolve(SAMPLE) : Promise.reject(new Error('x'))))
    const el = await mountRoute()
    expect(el.textContent ?? '').toContain('4.3%')
    window.dispatchEvent(new Event('focus'))
    await flush()
    expect(el.textContent ?? '').toContain('4.3%')
    expect(el.textContent ?? '').toContain('12.0 GB of 16.0 GB used')
    expect(calls).toBe(2)
  })

  it('samples on focus and refreshes on a 2 s interval while visible', async () => {
    vi.useFakeTimers()
    const { invoke } = fakeZero(() => Promise.resolve(SAMPLE))
    await mountRoute()
    expect(invoke).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('focus'))
    await flush()
    expect(invoke).toHaveBeenCalledTimes(2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(invoke).toHaveBeenCalledTimes(3)
  })

  it('gates sampling on document visibility', async () => {
    vi.useFakeTimers()
    const { invoke } = fakeZero(() => Promise.resolve(SAMPLE))
    setVisibility('hidden')
    await mountRoute()
    expect(invoke).not.toHaveBeenCalled()
    setVisibility('visible')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('keeps sampling regardless of the runtime connection state', async () => {
    useCockpit.setState({ state: 'offline' })
    const { invoke } = fakeZero(() => Promise.resolve(SAMPLE))
    await mountRoute()
    expect(invoke).toHaveBeenCalledTimes(1)
  })
})
