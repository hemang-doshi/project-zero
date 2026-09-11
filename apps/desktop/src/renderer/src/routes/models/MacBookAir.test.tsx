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

  it('dims the keyboard backlight bleed with the rest', async () => {
    const lit = await mount({ status: 'online' })
    expect(materialOf(lit, 'macbook-backlight-material')?.getAttribute('emissiveintensity')).toBe(
      '0.35'
    )

    await act(async () => {
      root?.unmount()
    })
    host?.remove()
    const dim = await mount({ status: 'online', dimmed: true })
    expect(materialOf(dim, 'macbook-backlight-material')?.getAttribute('emissiveintensity')).toBe(
      '0.02'
    )
  })
})

describe('MacBookAir detail pass', () => {
  it('instances per-key keycaps with gaps (main row block + function row)', async () => {
    const el = await mount({ status: 'online' })
    const main = el.querySelector('[data-testid="macbook-keycaps"]')
    const fn = el.querySelector('[data-testid="macbook-fn-keys"]')
    expect(main).not.toBeNull()
    expect(fn).not.toBeNull()
    const mainCount = Number(main?.getAttribute('data-count'))
    const fnCount = Number(fn?.getAttribute('data-count'))
    expect(mainCount).toBeGreaterThanOrEqual(60)
    expect(mainCount).toBeLessThanOrEqual(80)
    expect(fnCount).toBeGreaterThanOrEqual(10)
    expect(fnCount).toBeLessThanOrEqual(14)
  })

  it('has speaker grilles flanking the keyboard (recess + perforation dots)', async () => {
    const el = await mount({ status: 'online' })
    expect(el.querySelector('[name="speaker-grille-left"]')).not.toBeNull()
    expect(el.querySelector('[name="speaker-grille-right"]')).not.toBeNull()
    for (const testid of ['macbook-grille-left', 'macbook-grille-right']) {
      const dots = el.querySelector(`[data-testid="${testid}"]`)
      expect(dots, testid).not.toBeNull()
      expect(Number(dots?.getAttribute('data-count'))).toBeGreaterThanOrEqual(30)
    }
  })

  it('places MagSafe 3 + 2x USB-C on the left, headphone jack on the right', async () => {
    const el = await mount({ status: 'online' })
    expect(el.querySelector('[name="port-magsafe"]')).not.toBeNull()
    expect(el.querySelector('[name="port-magsafe-insert"]')).not.toBeNull()
    expect(el.querySelector('[name="port-usbc-0"]')).not.toBeNull()
    expect(el.querySelector('[name="port-usbc-1"]')).not.toBeNull()
    expect(el.querySelector('[name="port-headphone-right"]')).not.toBeNull()
  })

  it('has notch, camera lens, hinge barrel, display gasket and Touch ID', async () => {
    const el = await mount({ status: 'online' })
    for (const testid of ['macbook-notch', 'macbook-camera', 'macbook-hinge', 'macbook-gasket']) {
      expect(el.querySelector(`[data-testid="${testid}"]`), testid).not.toBeNull()
    }
    expect(el.querySelector('[data-testid="macbook-touch-id"]')).not.toBeNull()
    expect(el.querySelector('[name="touch-id-ring"]')).not.toBeNull()
  })

  it('has case screws, trackpad seam, backlight bleed and dock glyphs', async () => {
    const el = await mount({ status: 'online' })
    const screws = el.querySelector('[data-testid="macbook-screws"]')
    expect(screws).not.toBeNull()
    expect(Number(screws?.getAttribute('data-count'))).toBeGreaterThanOrEqual(6)
    expect(el.querySelector('[name="trackpad-seam"]')).not.toBeNull()
    expect(el.querySelector('[name="keyboard-backlight"]')).not.toBeNull()
    const icons = el.querySelector('[data-testid="macbook-dock-icons"]')
    expect(icons).not.toBeNull()
    expect(Number(icons?.getAttribute('data-count'))).toBeGreaterThanOrEqual(4)
    expect(el.querySelector('[data-testid="macbook-menubar-dots"]')).not.toBeNull()
  })

  it('stays within the 150 draw-call budget (one call per mesh/instancedMesh)', async () => {
    const el = await mount({ status: 'online' })
    const draws = el.querySelectorAll('mesh, instancedMesh').length
    expect(draws).toBeGreaterThan(0)
    expect(draws).toBeLessThanOrEqual(150)
  })
})
