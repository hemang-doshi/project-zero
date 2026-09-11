// @vitest-environment jsdom
import { act } from 'react'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZERO_TOKENS } from '../../../../shared/tokens'
import Keyboard, { KEY_COUNT, MODEL_FOOTPRINT, STATUS_HEX, type KeyboardStatus } from './Keyboard'
import { MODEL_FOOTPRINT as LAPTOP_FOOTPRINT } from './MacBookAir'
import { MODEL_FOOTPRINT as PHONE_FOOTPRINT } from './IPhone'
import { MODEL_FOOTPRINT as MONITOR_FOOTPRINT } from './Monitor'
import { MODEL_FOOTPRINT as ESP32_FOOTPRINT } from './Esp32DeskDisplay'

let root: Root | null = null
let host: HTMLElement | null = null

const mount = async (props: {
  status: KeyboardStatus
  dimmed?: boolean
  scale?: number
}): Promise<HTMLElement> => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root?.render(createElement(Keyboard, props))
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

describe('Keyboard footprint', () => {
  it('exports a sane tenkeyless footprint (w ≈ 2.6-3.0, w >> d, low h)', () => {
    expect(MODEL_FOOTPRINT.w).toBeGreaterThan(0)
    expect(MODEL_FOOTPRINT.h).toBeGreaterThan(0)
    expect(MODEL_FOOTPRINT.d).toBeGreaterThan(0)
    expect(MODEL_FOOTPRINT.w).toBeGreaterThanOrEqual(2.6)
    expect(MODEL_FOOTPRINT.w).toBeLessThanOrEqual(3.0)
    // Keyboard proportions: much wider than deep, low slab height.
    expect(MODEL_FOOTPRINT.w / MODEL_FOOTPRINT.d).toBeGreaterThanOrEqual(2)
    expect(MODEL_FOOTPRINT.h).toBeLessThan(0.5)
    expect(MODEL_FOOTPRINT).toEqual({ w: 2.8, h: 0.38, d: 1.16 })
  })

  it('is narrower than the laptop and shallower than its depth', () => {
    expect(MODEL_FOOTPRINT.w).toBeLessThanOrEqual(LAPTOP_FOOTPRINT.w)
    expect(MODEL_FOOTPRINT.d).toBeLessThan(LAPTOP_FOOTPRINT.d)
  })

  it('has the lowest standing height of all models', () => {
    for (const other of [LAPTOP_FOOTPRINT, MONITOR_FOOTPRINT, PHONE_FOOTPRINT, ESP32_FOOTPRINT]) {
      expect(MODEL_FOOTPRINT.h).toBeLessThan(other.h)
    }
  })
})

describe('Keyboard structure', () => {
  it('renders the named meshes (chassis, keycaps, keyglow, underglow, cable stub, feet, status LED)', async () => {
    const el = await mount({ status: 'online' })
    for (const name of [
      'chassis',
      'keycaps',
      'keyglow',
      'underglow',
      'cable-stub',
      'cable-plug',
      'foot-0',
      'foot-3',
      'status-light'
    ]) {
      expect(el.querySelector(`[name="${name}"]`), name).not.toBeNull()
    }
    expect(el.querySelector('[data-testid="keyboard"]')).not.toBeNull()
  })

  it('holds a sane 75%-ish key grid (60-110 instances, pinned exact)', async () => {
    expect(KEY_COUNT).toBeGreaterThanOrEqual(60)
    expect(KEY_COUNT).toBeLessThanOrEqual(110)
    expect(KEY_COUNT).toBe(76)
    const el = await mount({ status: 'online' })
    for (const testid of ['keyboard-keycaps', 'keyboard-keyglow']) {
      const mesh = materialOf(el, testid)
      expect(mesh, testid).not.toBeNull()
      expect(mesh?.getAttribute('data-key-count')).toBe(String(KEY_COUNT))
    }
  })

  it('stands on the y=0 plane (contact shadow at ground level)', async () => {
    const el = await mount({ status: 'online' })
    expect(el.querySelector('[name="base-shadow"]')).not.toBeNull()
  })
})

describe('Keyboard status light', () => {
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
  ] as Array<[KeyboardStatus, string]>)('lights %s with %s', async (status, hex) => {
    const el = await mount({ status })
    const light = el.querySelector('[data-testid="keyboard-status-light"]')
    expect(light).not.toBeNull()
    const mat = materialOf(el, 'keyboard-status-material')
    expect(mat).not.toBeNull()
    expect(mat?.getAttribute('emissive')?.toLowerCase()).toBe(hex.toLowerCase())
  })
})

describe('Keyboard dimmed', () => {
  it('reduces emissive/opacity across caps, glow, wash and LED when dimmed', async () => {
    const lit = await mount({ status: 'online' })
    expect(materialOf(lit, 'keyboard-keycaps-material')?.getAttribute('opacity')).toBe('1')
    expect(materialOf(lit, 'keyboard-keyglow-material')?.getAttribute('opacity')).toBe('1')
    expect(materialOf(lit, 'keyboard-underglow-material')?.getAttribute('opacity')).toBe('0.3')
    expect(materialOf(lit, 'keyboard-status-material')?.getAttribute('emissiveintensity')).toBe(
      '1.6'
    )

    await act(async () => {
      root?.unmount()
    })
    host?.remove()
    const dim = await mount({ status: 'online', dimmed: true })
    expect(materialOf(dim, 'keyboard-keycaps-material')?.getAttribute('opacity')).toBe('0.35')
    expect(materialOf(dim, 'keyboard-keyglow-material')?.getAttribute('opacity')).toBe('0.5')
    expect(materialOf(dim, 'keyboard-underglow-material')?.getAttribute('opacity')).toBe('0.06')
    expect(materialOf(dim, 'keyboard-status-material')?.getAttribute('emissiveintensity')).toBe(
      '0.15'
    )
  })
})
