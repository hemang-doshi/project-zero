// @vitest-environment jsdom
import { act } from 'react'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZERO_TOKENS } from '../../../../shared/tokens'
import MousePad, {
  MODEL_FOOTPRINT,
  MOUSE_BASE_Y,
  PAD_TOP,
  STATUS_HEX,
  type MousePadStatus
} from './MousePad'

let root: Root | null = null
let host: HTMLElement | null = null

const mount = async (props: {
  status: MousePadStatus
  dimmed?: boolean
  scale?: number
}): Promise<HTMLElement> => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root?.render(createElement(MousePad, props))
  })
  return host
}

beforeEach(() => {
  // The fiber mock-free render emits R3F intrinsics (<mesh>, <boxGeometry>, …)
  // as plain DOM tags, tripping React's casing validation. Real R3F resolves
  // these itself, so filter that artifact narrowly and let all other errors
  // through — same harness as Keyboard.test.tsx.
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

describe('MousePad footprint', () => {
  it('exports a sane XXL-mat footprint (w 2.4-3.0, d 1.2-1.5, low h, w >> h)', () => {
    expect(MODEL_FOOTPRINT.w).toBeGreaterThan(0)
    expect(MODEL_FOOTPRINT.h).toBeGreaterThan(0)
    expect(MODEL_FOOTPRINT.d).toBeGreaterThan(0)
    expect(MODEL_FOOTPRINT.w).toBeGreaterThanOrEqual(2.4)
    expect(MODEL_FOOTPRINT.w).toBeLessThanOrEqual(3.0)
    expect(MODEL_FOOTPRINT.d).toBeGreaterThanOrEqual(1.2)
    expect(MODEL_FOOTPRINT.d).toBeLessThanOrEqual(1.5)
    // Pad-dominated slab: much wider than tall, low profile.
    expect(MODEL_FOOTPRINT.w / MODEL_FOOTPRINT.h).toBeGreaterThanOrEqual(4)
    expect(MODEL_FOOTPRINT.h).toBeLessThan(0.6)
    expect(MODEL_FOOTPRINT).toEqual({ w: 2.6, h: 0.5, d: 1.35 })
  })

  it('rests the mouse base on the pad surface (pad top at y≈0.02)', () => {
    // Pad top is a thin-mat height above the y=0 desk plane.
    expect(PAD_TOP).toBeGreaterThan(0)
    expect(PAD_TOP).toBeLessThanOrEqual(0.05)
    // Mouse base center sits within half its thickness above the pad top.
    expect(MOUSE_BASE_Y - PAD_TOP).toBeGreaterThanOrEqual(0)
    expect(MOUSE_BASE_Y - PAD_TOP).toBeLessThan(0.05)
  })
})

describe('MousePad structure', () => {
  it('renders the named meshes (pad, edge, body, buttons, wheel, side buttons, accents, cable stub, LED)', async () => {
    const el = await mount({ status: 'online' })
    for (const name of [
      'pad',
      'pad-edge',
      'mouse-base',
      'mouse-body',
      'button-left',
      'button-right',
      'button-seam',
      'wheel',
      'wheel-hub',
      'rib-0',
      'rib-2',
      'side-button-0',
      'side-button-1',
      'accent-left',
      'accent-right',
      'cable-stub',
      'status-light'
    ]) {
      expect(el.querySelector(`[name="${name}"]`), name).not.toBeNull()
    }
    expect(el.querySelector('[data-testid="mousepad"]')).not.toBeNull()
  })

  it('carries a red accent pair echoing the owner photo', async () => {
    const el = await mount({ status: 'online' })
    const accents = el.querySelectorAll('[data-testid="mousepad-accent-material"]')
    expect(accents.length).toBe(2)
  })
})

describe('MousePad status light', () => {
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
  ] as Array<[MousePadStatus, string]>)('lights %s with %s', async (status, hex) => {
    const el = await mount({ status })
    const light = el.querySelector('[data-testid="mousepad-status-light"]')
    expect(light).not.toBeNull()
    const mat = materialOf(el, 'mousepad-status-material')
    expect(mat).not.toBeNull()
    expect(mat?.getAttribute('emissive')?.toLowerCase()).toBe(hex.toLowerCase())
  })
})

describe('MousePad dimmed', () => {
  it('reduces emissive/opacity across pad, body, accents and LED when dimmed', async () => {
    const lit = await mount({ status: 'online' })
    expect(materialOf(lit, 'mousepad-pad-material')?.getAttribute('opacity')).toBe('1')
    expect(materialOf(lit, 'mousepad-body-material')?.getAttribute('opacity')).toBe('1')
    expect(materialOf(lit, 'mousepad-status-material')?.getAttribute('emissiveintensity')).toBe(
      '1.6'
    )
    const litAccents = lit.querySelectorAll('[data-testid="mousepad-accent-material"]')
    expect(litAccents[0]?.getAttribute('emissiveintensity')).toBe('0.7')

    await act(async () => {
      root?.unmount()
    })
    host?.remove()
    const dim = await mount({ status: 'online', dimmed: true })
    expect(materialOf(dim, 'mousepad-pad-material')?.getAttribute('opacity')).toBe('0.6')
    expect(materialOf(dim, 'mousepad-body-material')?.getAttribute('opacity')).toBe('0.35')
    expect(materialOf(dim, 'mousepad-status-material')?.getAttribute('emissiveintensity')).toBe(
      '0.15'
    )
    const dimAccents = dim.querySelectorAll('[data-testid="mousepad-accent-material"]')
    expect(dimAccents[0]?.getAttribute('emissiveintensity')).toBe('0.1')
  })
})
