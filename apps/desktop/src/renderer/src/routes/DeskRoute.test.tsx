// @vitest-environment jsdom
import { act } from 'react'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeskRoute } from './DeskRoute'
import { useCockpit } from '../store/cockpit'
import fixtureJson from './fixtures/cockpit.json'

const fixture = (): unknown => fixtureJson as unknown

let root: Root | null = null
let host: HTMLElement | null = null

type BridgeSubscriber = (u: unknown) => void

const fakeZero = (
  invokeImpl: (op: string, payload?: unknown) => Promise<unknown>
): {
  invoke: ReturnType<typeof vi.fn>
  bridgeSubscribers: BridgeSubscriber[]
} => {
  const invoke = vi.fn(invokeImpl)
  const bridgeSubscribers: BridgeSubscriber[] = []
  ;(window as unknown as { zero: unknown }).zero = {
    invoke,
    subscribe: vi.fn((_channel: string, cb: BridgeSubscriber) => {
      bridgeSubscribers.push(cb)
      return () => {}
    })
  }
  return { invoke, bridgeSubscribers }
}

const push = (subs: BridgeSubscriber[], payload: unknown): void => {
  for (const cb of subs) cb(payload)
}

const flush = async (): Promise<void> => {
  await act(async () => {})
}

const mount = async (): Promise<HTMLElement> => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root?.render(createElement(DeskRoute))
  })
  await flush()
  return host
}

beforeEach(() => {
  useCockpit.setState({ state: 'connecting', snapshot: null, lastError: null, refreshAt: null })
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  host?.remove()
  host = null
  root = null
  delete (window as unknown as { zero?: unknown }).zero
})

describe('DeskRoute spotify media card', () => {
  it('renders track, artist and the play-state chip from the snapshot', async () => {
    fakeZero(() => Promise.resolve({ dataUrl: null }))
    useCockpit.setState({ state: 'live', snapshot: fixture(), refreshAt: Date.now() })
    const el = await mount()
    const text = el.textContent ?? ''
    expect(text).toContain('Parking Lot')
    expect(text).toContain('Mustard')
    expect(text).toContain('PAUSED')
    expect(text).toContain('LIVE MEDIA')
  })

  it('gates media tones neutral while the runtime is not live', async () => {
    fakeZero(() => Promise.resolve({ dataUrl: null }))
    useCockpit.setState({ state: 'offline', snapshot: fixture(), refreshAt: Date.now() })
    const el = await mount()
    expect(el.textContent ?? '').toContain('RETAINED MEDIA')
    const playingChip = [...el.querySelectorAll('span')].find((s) => s.textContent === 'PAUSED')
    expect(playingChip).toBeTruthy()
  })

  it('renders the fetched artwork cover as an img', async () => {
    const url = 'data:image/png;base64,iVBORw0KGgo='
    fakeZero(() => Promise.resolve({ dataUrl: url }))
    useCockpit.setState({ state: 'live', snapshot: fixture(), refreshAt: Date.now() })
    const el = await mount()
    const img = el.querySelector('img')
    expect(img?.getAttribute('src')).toBe(url)
    expect(img?.getAttribute('alt')).toBe('Album artwork')
  })

  it('shows the honest no-artwork placeholder when the asset is unavailable', async () => {
    fakeZero(() => Promise.resolve({ dataUrl: null }))
    useCockpit.setState({ state: 'live', snapshot: fixture(), refreshAt: Date.now() })
    const el = await mount()
    expect(el.querySelector('img')).toBeNull()
    expect(el.textContent ?? '').toContain('NO ARTWORK')
  })
})

describe('DeskRoute bass waveform', () => {
  it('draws a rising trace from live audio levels', async () => {
    const value = fixture() as Record<string, unknown>
    const playing = {
      ...value,
      integrations: (value.integrations as Record<string, unknown>[]).map((i) =>
        i.id === 'spotify'
          ? { ...i, data: { ...(i.data as Record<string, unknown>), state: 'playing' } }
          : i
      )
    }
    fakeZero(() => Promise.resolve({ dataUrl: null }))
    useCockpit.setState({ state: 'live', snapshot: playing, refreshAt: Date.now() })
    const el = await mount()
    const polyline = el.querySelector('svg polyline')
    expect(polyline).toBeTruthy()
    const traces = el.querySelectorAll('svg polyline')
    const live = traces[traces.length - 1]
    const last = (live?.getAttribute('points') ?? '').split(' ').at(-1) ?? ''
    expect(Number(last.split(',')[1])).toBeLessThan(40)
  })

  it('flattens the trace when the daemon reports paused capture', async () => {
    const value = fixture() as Record<string, unknown>
    const paused = { ...value, audio: { level: 0, bass: 200, sequence: 9, status: 'PAUSED' } }
    fakeZero(() => Promise.resolve({ dataUrl: null }))
    useCockpit.setState({ state: 'live', snapshot: paused, refreshAt: Date.now() })
    const el = await mount()
    const traces = el.querySelectorAll('svg polyline')
    const live = traces[traces.length - 1]
    const points = (live?.getAttribute('points') ?? '')
      .split(' ')
      .map((p) => Number(p.split(',')[1]))
    expect(points).toHaveLength(48)
    expect(points.every((y) => y === 40)).toBe(true)
  })
})

describe('DeskRoute display status card', () => {
  it('renders the desk-display-01 status with the daemon-derived lease state', async () => {
    fakeZero(() => Promise.resolve({ dataUrl: null }))
    useCockpit.setState({ state: 'live', snapshot: fixture(), refreshAt: Date.now() })
    const el = await mount()
    const text = el.textContent ?? ''
    expect(text).toContain('DESK DISPLAY')
    expect(text).toContain('desk-display-01')
    expect(text).toContain('ONLINE')
    expect(text).toContain('last seen 05:59:49')
  })

  it('shows the honest empty state when no display node exists', async () => {
    const value = fixture() as Record<string, unknown>
    fakeZero(() => Promise.resolve({ dataUrl: null }))
    useCockpit.setState({ state: 'live', snapshot: { ...value, nodes: [] }, refreshAt: Date.now() })
    const el = await mount()
    expect(el.textContent ?? '').toContain('No display node registered')
  })
})

describe('DeskRoute agent runs card', () => {
  it('renders an active codex run pushed through the bridge event channel', async () => {
    const zero = fakeZero((op) => {
      if (op === 'codex.state') return Promise.resolve({ state: 'live', lastDiagnostic: null })
      if (op === 'ocp.state')
        return Promise.resolve({ state: 'disconnected', lastDiagnostic: null })
      return Promise.resolve({ dataUrl: null })
    })
    useCockpit.setState({ state: 'live', snapshot: fixture(), refreshAt: Date.now() })
    const el = await mount()
    expect(el.textContent ?? '').toContain('NO ACTIVE AGENT RUNS')
    push(zero.bridgeSubscribers, {
      harness: 'codex',
      event: { method: 'turn/started', params: { threadId: 't1' } }
    })
    await flush()
    expect(el.textContent ?? '').toContain('CODEX')
    expect(el.textContent ?? '').toContain('t1')
    expect(el.textContent ?? '').toContain('ACTIVE')
  })

  it('drops the run once the turn completes', async () => {
    const zero = fakeZero((op) => {
      if (op === 'codex.state') return Promise.resolve({ state: 'live', lastDiagnostic: null })
      if (op === 'ocp.state')
        return Promise.resolve({ state: 'disconnected', lastDiagnostic: null })
      return Promise.resolve({ dataUrl: null })
    })
    useCockpit.setState({ state: 'live', snapshot: fixture(), refreshAt: Date.now() })
    const el = await mount()
    push(zero.bridgeSubscribers, {
      harness: 'codex',
      event: { method: 'turn/started', params: { threadId: 't1' } }
    })
    await flush()
    expect(el.textContent ?? '').toContain('t1')
    push(zero.bridgeSubscribers, {
      harness: 'codex',
      event: { method: 'turn/completed', params: { threadId: 't1' } }
    })
    await flush()
    expect(el.textContent ?? '').toContain('NO ACTIVE AGENT RUNS')
    expect(el.textContent ?? '').not.toContain('t1')
  })

  it('never renders retained bridge evidence while the bridge is disconnected', async () => {
    const zero = fakeZero((op) => {
      if (op === 'codex.state')
        return Promise.resolve({ state: 'disconnected', lastDiagnostic: null })
      if (op === 'ocp.state')
        return Promise.resolve({ state: 'disconnected', lastDiagnostic: null })
      return Promise.resolve({ dataUrl: null })
    })
    useCockpit.setState({ state: 'live', snapshot: fixture(), refreshAt: Date.now() })
    const el = await mount()
    push(zero.bridgeSubscribers, {
      harness: 'codex',
      event: { method: 'turn/started', params: { threadId: 't1' } }
    })
    await flush()
    expect(el.textContent ?? '').toContain('NO ACTIVE AGENT RUNS')
  })
})
