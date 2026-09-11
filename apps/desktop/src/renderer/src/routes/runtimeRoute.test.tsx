// @vitest-environment jsdom
import { act } from 'react'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { RuntimeRoute } from './RuntimeRoute'
import { useCockpit } from '../store/cockpit'

const GIB = 1024 ** 3
const MIB = 1024 ** 2

const SAMPLE = {
  cpu: { system: 4.25, user: 30, idle: 65.75, threads: 3185, processes: 780 },
  memory: {
    total: 16 * GIB,
    used: 12.5 * GIB,
    percent: 78.125,
    pressure: 78.125,
    level: 'medium',
    app: 5 * GIB,
    wired: 3 * GIB,
    compressed: 4.5 * GIB,
    cachedFiles: 2.5 * GIB,
    swapUsed: 0
  },
  io: {
    reads: 8_348_407,
    writes: 2_515_963,
    readsPerSec: 12.5,
    writesPerSec: 3.5,
    dataRead: 156_378_263_552,
    dataWritten: 47_597_654_016,
    dataReadPerSec: 6 * MIB,
    dataWrittenPerSec: 1.5 * MIB
  },
  net: {
    packetsIn: 883_011,
    packetsOut: 883_011,
    packetsInPerSec: 25.5,
    packetsOutPerSec: 21.5,
    dataReceived: 951_953_745,
    dataSent: 951_953_745,
    dataReceivedPerSec: 40_960,
    dataSentPerSec: 20_480
  },
  gpu: 29
}

const SAMPLE_B = {
  ...SAMPLE,
  cpu: { system: 8.5, user: 60, idle: 31.5, threads: 3200, processes: 781 }
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

describe('RuntimeRoute activity monitor panels', () => {
  it('renders the four panel titles', async () => {
    fakeZero(() => Promise.resolve(SAMPLE))
    const el = await mountRoute()
    const text = el.textContent ?? ''
    expect(text).toContain('CPU LOAD')
    expect(text).toContain('MEMORY PRESSURE')
    expect(text).toContain('DISK I/O')
    expect(text).toContain('NETWORK')
  })

  it('renders real color-coded cpu rows and counts', async () => {
    fakeZero(() => Promise.resolve(SAMPLE))
    const el = await mountRoute()
    const text = el.textContent ?? ''
    expect(text).toContain('SYSTEM')
    expect(text).toContain('4.3%')
    expect(text).toContain('USER')
    expect(text).toContain('30.0%')
    expect(text).toContain('IDLE')
    expect(text).toContain('65.8%')
    expect(text).toContain('THREADS')
    expect(text).toContain('3,185')
    expect(text).toContain('PROCESSES')
    expect(text).toContain('780')
    expect(text).toContain('29.0%')
  })

  it('renders memory breakdown rows in binary GB (units fix)', async () => {
    fakeZero(() => Promise.resolve(SAMPLE))
    const el = await mountRoute()
    const text = el.textContent ?? ''
    expect(text).toContain('PHYSICAL MEMORY')
    expect(text).toContain('16.00 GB')
    expect(text).toContain('12.50 GB')
    expect(text).toContain('CACHED FILES')
    expect(text).toContain('2.50 GB')
    expect(text).toContain('SWAP USED')
    expect(text).toContain('0.00 GB')
    expect(text).toContain('APP MEMORY')
    expect(text).toContain('5.00 GB')
    expect(text).toContain('WIRED MEMORY')
    expect(text).toContain('3.00 GB')
    expect(text).toContain('COMPRESSED')
    expect(text).toContain('4.50 GB')
  })

  it('renders disk and network rows with grouped counts and scaled bytes', async () => {
    fakeZero(() => Promise.resolve(SAMPLE))
    const el = await mountRoute()
    const text = el.textContent ?? ''
    expect(text).toContain('READS IN')
    expect(text).toContain('8,348,407')
    expect(text).toContain('WRITES OUT')
    expect(text).toContain('2,515,963')
    expect(text).toContain('DATA READ')
    expect(text).toContain('145.64 GB')
    expect(text).toContain('DATA WRITTEN')
    expect(text).toContain('44.33 GB')
    expect(text).toContain('DATA READ/SEC')
    expect(text).toContain('6.0 MB')
    expect(text).toContain('DATA WRITTEN/SEC')
    expect(text).toContain('1.5 MB')
    expect(text).toContain('PACKETS IN')
    expect(text).toContain('883,011')
    expect(text).toContain('DATA RECEIVED')
    expect(text).toContain('907.9 MB')
    expect(text).toContain('DATA SENT/SEC')
    expect(text).toContain('20.0 KB')
  })

  it('shows honest placeholders when the op errors before any sample', async () => {
    fakeZero(() => Promise.reject(new Error('nope')))
    const el = await mountRoute()
    const text = el.textContent ?? ''
    expect(text).toContain('—')
    expect(text).not.toContain('%')
    expect(text).toContain('CPU LOAD')
    expect(text).toContain('MEMORY PRESSURE')
  })

  it('keeps the last good sample when a later pull errors (cached semantics)', async () => {
    let calls = 0
    fakeZero(() => (calls++ === 0 ? Promise.resolve(SAMPLE) : Promise.reject(new Error('x'))))
    const el = await mountRoute()
    expect(el.textContent ?? '').toContain('4.3%')
    window.dispatchEvent(new Event('focus'))
    await flush()
    expect(el.textContent ?? '').toContain('4.3%')
    expect(el.textContent ?? '').toContain('16.00 GB')
    expect(calls).toBe(2)
  })

  it('draws graph lines only from the second sample onward', async () => {
    let calls = 0
    fakeZero(() => Promise.resolve(calls++ === 0 ? SAMPLE : SAMPLE_B))
    const el = await mountRoute()
    expect(el.querySelectorAll('polyline')).toHaveLength(0)
    window.dispatchEvent(new Event('focus'))
    await flush()
    const polylines = el.querySelectorAll('polyline')
    expect(polylines.length).toBeGreaterThanOrEqual(6)
    // The cpu history reflects BOTH samples: the system series spans 4.25 → 8.5
    // (y = 54 − v·0.52 in the fixed 240×56 box).
    expect(polylines[0].getAttribute('points')).toBe('2,51.8 238,49.6')
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
