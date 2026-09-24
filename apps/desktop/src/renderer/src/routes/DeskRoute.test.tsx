// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeskRoute } from './DeskRoute'
import { useCockpit } from '../store/cockpit'
import fixtureJson from './fixtures/cockpit.json'

const fixture = (): unknown => fixtureJson as unknown

let root: Root | null = null
let host: HTMLElement | null = null

const fakeZero = (invokeImpl: (op: string, payload?: unknown) => Promise<unknown>): void => {
  ;(window as unknown as { zero: unknown }).zero = {
    invoke: vi.fn(invokeImpl),
    subscribe: vi.fn(() => () => {})
  }
}

const mount = async (): Promise<HTMLElement> => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root?.render(createElement(DeskRoute))
  })
  await act(async () => {})
  return host
}

beforeEach(() => {
  useCockpit.setState({ state: 'connecting', snapshot: null, lastError: null, refreshAt: null })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  host = null
  root = null
  delete (window as unknown as { zero?: unknown }).zero
})

describe('DeskRoute Spotify view', () => {
  it('renders the current song and observed session history', async () => {
    fakeZero(() => Promise.resolve({ dataUrl: null }))
    useCockpit.setState({ state: 'live', snapshot: fixture(), refreshAt: Date.now() })
    const el = await mount()
    const text = el.textContent ?? ''
    expect(text).toContain('Parking Lot')
    expect(text).toContain('Mustard')
    expect(text).toContain('PAUSED')
    expect(text).toContain('LIVE')
    expect(text).toContain('LISTENING SESSION')
    expect(text).toContain('NOT OBSERVED')
  })

  it('renders fetched artwork and a neutral placeholder when unavailable', async () => {
    const url = 'data:image/png;base64,iVBORw0KGgo='
    fakeZero(() => Promise.resolve({ dataUrl: url }))
    useCockpit.setState({ state: 'live', snapshot: fixture(), refreshAt: Date.now() })
    const el = await mount()
    const img = el.querySelector('img')
    expect(img?.getAttribute('src')).toBe(url)
    expect(img?.getAttribute('alt')).toBe('Album artwork')
  })

  it('shows observed track history and the active session clock without unrelated panels', async () => {
    const value = fixture() as Record<string, unknown>
    const listening = {
      id: '20260923T120000Z',
      source: 'local-spotify-observer',
      started_at: '2026-09-23T12:00:00Z',
      last_observed_at: '2026-09-23T12:00:30Z',
      playback_state: 'playing',
      active_duration_ms: 30000,
      active_from: '2026-09-23T12:00:00Z',
      tracks: [
        { track: 'Observed Track', artist: 'Observed Artist', observed_at: '2026-09-23T12:00:00Z' }
      ]
    }
    fakeZero(() => Promise.resolve({ dataUrl: null }))
    useCockpit.setState({
      state: 'live',
      snapshot: { ...value, listening_session: listening },
      refreshAt: Date.now()
    })
    const el = await mount()
    const text = el.textContent ?? ''
    expect(text).toContain('Observed Track')
    expect(text).toContain('0:00:30')
    expect(text).toContain('Only songs observed since this session began appear here.')
    expect(text).toContain('MAKE PLAYLIST')
    expect(text).toContain('Spotify account connection is required')
    expect(el.querySelector('button[disabled]')?.textContent).toContain('MAKE PLAYLIST')
    expect(text).not.toContain('PROJECT ZERO — DESK')
    expect(text).not.toContain('AGENT RUNS')
    expect(text).not.toContain('BASS')
    expect(text).not.toContain('git ·')
    expect(text).not.toContain('DESK DISPLAY')
    expect(el.querySelector('[aria-label="Virtual desk display preview"]')).toBeNull()
  })

  it('keeps retained media neutral and explains when local session observation is absent', async () => {
    fakeZero(() => Promise.resolve({ dataUrl: null }))
    useCockpit.setState({ state: 'offline', snapshot: fixture(), refreshAt: Date.now() })
    const el = await mount()
    expect(el.textContent ?? '').toContain('RETAINED')
    expect(el.textContent ?? '').toContain(
      'Session history starts when local Spotify observation is connected'
    )
  })
})
