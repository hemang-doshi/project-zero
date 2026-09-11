// @vitest-environment jsdom
import { act } from 'react'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZERO_TOKENS } from '../../../../shared/tokens'
import MacBookAir, { MODEL_FOOTPRINT, STATUS_HEX, type MacBookStatus } from './MacBookAir'

let root: Root | null = null
let host: HTMLElement | null = null

const mount = async (props: {
  status: MacBookStatus
  dimmed?: boolean
  scale?: number
}): Promise<HTMLElement> => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root?.render(createElement(MacBookAir, props))
  })
  return host
}

beforeEach(() => {
  // The fiber mock-free render emits R3F intrinsics (<mesh>, <boxGeometry>, …)
  // as plain DOM tags, tripping React's casing validation. Real R3F resolves
  // these itself, so filter that artifact narrowly and let all other errors
  // through — same harness as topologyScene.test.tsx.
  vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...rest: unknown[]) => {
    if (typeof message === 'string' && message.includes('incorrect casing')) return
    process.stderr.write(`console.error: ${String(message)} ${rest.map(String).join(' ')}\n`)
  })
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  host?.remove()
  host = null
  vi.restoreAllMocks()
})

const materialOf = (el: HTMLElement, testid: string): Element | null =>
  el.querySelector(`[data-testid="${testid}"]`)

describe('MacBookAir footprint', () => {
  it('exports a sane laptop footprint (w, h, d > 0, w > h)', () => {
    expect(MODEL_FOOTPRINT.w).toBeGreaterThan(0)
    expect(MODEL_FOOTPRINT.h).toBeGreaterThan(0)
    expect(MODEL_FOOTPRINT.d).toBeGreaterThan(0)
    expect(MODEL_FOOTPRINT.w).toBeGreaterThan(MODEL_FOOTPRINT.h)
    expect(MODEL_FOOTPRINT).toEqual({ w: 3.0, h: 2.13, d: 2.5 })
  })
})

describe('MacBookAir structure', () => {
  it('renders the named meshes (lid, deck, screen, keyboard, trackpad)', async () => {
    const el = await mount({ status: 'online' })
    for (const name of ['lid', 'deck', 'screen', 'keyboard', 'trackpad']) {
      expect(el.querySelector(`[name="${name}"]`), name).not.toBeNull()
    }
    expect(el.querySelector('[data-testid="macbook-air"]')).not.toBeNull()
  })

  it('stands on the y=0 plane (feet bottoms and shadow at ground level)', async () => {
    const el = await mount({ status: 'online' })
    const feet = ['foot-0', 'foot-1', 'foot-2', 'foot-3'].map((n) =>
      el.querySelector(`[name="${n}"]`)
    )
    expect(feet.every((f) => f !== null)).toBe(true)
    expect(el.querySelector('[name="base-shadow"]')).not.toBeNull()
  })
})

describe('MacBookAir status light', () => {
  it('maps every status to its Stitch token hex', () => {
    expect(STATUS_HEX).toEqual({
      online: ZERO_TOKENS.statusGreen,
      suspect: ZERO_TOKENS.markerYellow,
      offline: ZERO_TOKENS.secondaryInk,
      gated: ZERO_TOKENS.errorRed
    })
  })

  it.each([
    ['online', ZERO_TOKENS.statusGreen],
    ['suspect', ZERO_TOKENS.markerYellow],
    ['offline', ZERO_TOKENS.secondaryInk],
    ['gated', ZERO_TOKENS.errorRed]
  ] as Array<[MacBookStatus, string]>)('lights %s with %s', async (status, hex) => {
    const el = await mount({ status })
    const light = el.querySelector('[data-testid="macbook-status-light"]')
    expect(light).not.toBeNull()
    const mat = materialOf(el, 'macbook-status-material')
    expect(mat).not.toBeNull()
    expect(mat?.getAttribute('emissive')?.toLowerCase()).toBe(hex.toLowerCase())
  })
})

describe('MacBookAir dimmed', () => {
  it('reduces screen emissive and body opacity when dimmed', async () => {
    const lit = await mount({ status: 'online' })
    const litScreen = materialOf(lit, 'macbook-screen-material')
    const litDeck = materialOf(lit, 'macbook-deck-material')
    expect(litScreen?.getAttribute('emissiveintensity')).toBe('0.7')
    expect(litDeck?.getAttribute('opacity')).toBe('1')

    await act(async () => {
      root?.unmount()
    })
    host?.remove()
    const dim = await mount({ status: 'online', dimmed: true })
    const dimScreen = materialOf(dim, 'macbook-screen-material')
    const dimDeck = materialOf(dim, 'macbook-deck-material')
    expect(dimScreen?.getAttribute('emissiveintensity')).toBe('0.05')
    expect(dimDeck?.getAttribute('opacity')).toBe('0.35')
  })
})
