// @vitest-environment jsdom
import { act } from 'react'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZERO_TOKENS } from '../../../../shared/tokens'
import Esp32DeskDisplay, { MODEL_FOOTPRINT, STATUS_HEX, type Esp32Status } from './Esp32DeskDisplay'
import { MODEL_FOOTPRINT as LAPTOP_FOOTPRINT } from './MacBookAir'
import { MODEL_FOOTPRINT as PHONE_FOOTPRINT } from './IPhone'
import { MODEL_FOOTPRINT as MONITOR_FOOTPRINT } from './Monitor'

let root: Root | null = null
let host: HTMLElement | null = null

const mount = async (props: {
  status: Esp32Status
  dimmed?: boolean
  scale?: number
}): Promise<HTMLElement> => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root?.render(createElement(Esp32DeskDisplay, props))
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

describe('Esp32DeskDisplay footprint', () => {
  it('exports a sane desk-display footprint (w, h, d > 0, portrait h ≈ 1.0-1.2)', () => {
    expect(MODEL_FOOTPRINT.w).toBeGreaterThan(0)
    expect(MODEL_FOOTPRINT.h).toBeGreaterThan(0)
    expect(MODEL_FOOTPRINT.d).toBeGreaterThan(0)
    expect(MODEL_FOOTPRINT.h).toBeGreaterThanOrEqual(1.0)
    expect(MODEL_FOOTPRINT.h).toBeLessThanOrEqual(1.2)
    expect(MODEL_FOOTPRINT).toEqual({ w: 0.9, h: 1.1, d: 0.5 })
  })

  it('is smaller than the laptop and monitor in every dimension', () => {
    for (const dim of ['w', 'h', 'd'] as const) {
      expect(MODEL_FOOTPRINT[dim]).toBeLessThan(LAPTOP_FOOTPRINT[dim])
      expect(MODEL_FOOTPRINT[dim]).toBeLessThan(MONITOR_FOOTPRINT[dim])
    }
  })

  it('is bulkier than the phone (wider, deeper, larger volume)', () => {
    expect(MODEL_FOOTPRINT.w).toBeGreaterThan(PHONE_FOOTPRINT.w)
    expect(MODEL_FOOTPRINT.d).toBeGreaterThan(PHONE_FOOTPRINT.d)
    const volume = MODEL_FOOTPRINT.w * MODEL_FOOTPRINT.h * MODEL_FOOTPRINT.d
    const phoneVolume = PHONE_FOOTPRINT.w * PHONE_FOOTPRINT.h * PHONE_FOOTPRINT.d
    expect(volume).toBeGreaterThan(phoneVolume)
  })
})

describe('Esp32DeskDisplay structure', () => {
  it('renders the named meshes (pcb, pins, module, screen, bezel, usb, boot, en, stand, status LED)', async () => {
    const el = await mount({ status: 'online' })
    for (const name of [
      'pcb',
      'pins',
      'module',
      'screen',
      'bezel',
      'usb',
      'boot',
      'en',
      'stand',
      'stand-arm',
      'status-light'
    ]) {
      expect(el.querySelector(`[name="${name}"]`), name).not.toBeNull()
    }
    expect(el.querySelector('[data-testid="esp32-desk-display"]')).not.toBeNull()
  })

  it('renders both pin-header rows with 12 gold pins each', async () => {
    const el = await mount({ status: 'online' })
    expect(el.querySelector('[name="pins-left"]')).not.toBeNull()
    expect(el.querySelector('[name="pins-right"]')).not.toBeNull()
    for (const name of ['pin-l-0', 'pin-l-11', 'pin-r-0', 'pin-r-11']) {
      expect(el.querySelector(`[name="${name}"]`), name).not.toBeNull()
    }
  })

  it('renders the mini UI on the TFT face (header, timer digits, waveform)', async () => {
    const el = await mount({ status: 'online' })
    expect(el.querySelector('[name="screen-header"]')).not.toBeNull()
    for (const name of ['screen-timer-0', 'screen-timer-1', 'screen-timer-2']) {
      expect(el.querySelector(`[name="${name}"]`), name).not.toBeNull()
    }
    for (let i = 0; i < 5; i += 1) {
      expect(el.querySelector(`[name="screen-wave-${i}"]`), `screen-wave-${i}`).not.toBeNull()
    }
  })

  it('renders the detail pass 2 (solder, silkscreen, power cluster, TFT mount, button trim)', async () => {
    const el = await mount({ status: 'online' })
    for (const name of [
      'mounting-holes',
      'solder-joints',
      'regulator',
      'capacitors',
      'crystal',
      'diode',
      'diode-band',
      'fuse',
      'power-led',
      'rgb-led',
      'silkscreen',
      'flex-ribbon',
      'flex-connector',
      'sd-slot',
      'sd-card',
      'bezel-screws',
      'standoffs',
      'boot-cap',
      'en-cap',
      'button-legends'
    ]) {
      expect(el.querySelector(`[name="${name}"]`), name).not.toBeNull()
    }
  })

  it('instances repeated detail at the budgeted counts', async () => {
    const el = await mount({ status: 'online' })
    for (const [name, count] of [
      ['solder-joints', '24'],
      ['silkscreen', '10'],
      ['capacitors', '5'],
      ['mounting-holes', '4'],
      ['bezel-screws', '4'],
      ['standoffs', '4'],
      ['button-legends', '2']
    ] as Array<[string, string]>) {
      expect(
        el.querySelector(`[name="${name}"]`)?.getAttribute('args')?.split(',').at(-1),
        name
      ).toBe(count)
    }
  })

  it('stays within the 120 draw-call budget (one call per mesh/instancedMesh)', async () => {
    const el = await mount({ status: 'online' })
    const draws = el.querySelectorAll('mesh, instancedMesh').length
    expect(draws).toBeGreaterThan(50)
    expect(draws).toBeLessThanOrEqual(120)
  })

  it('stands on the y=0 plane (contact shadow at ground level)', async () => {
    const el = await mount({ status: 'online' })
    expect(el.querySelector('[name="base-shadow"]')).not.toBeNull()
  })
})

describe('Esp32DeskDisplay status light', () => {
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
  ] as Array<[Esp32Status, string]>)('lights %s with %s', async (status, hex) => {
    const el = await mount({ status })
    const light = el.querySelector('[data-testid="esp32-status-light"]')
    expect(light).not.toBeNull()
    const mat = materialOf(el, 'esp32-status-material')
    expect(mat).not.toBeNull()
    expect(mat?.getAttribute('emissive')?.toLowerCase()).toBe(hex.toLowerCase())
  })
})

describe('Esp32DeskDisplay dimmed', () => {
  it('reduces screen emissive and pcb opacity when dimmed', async () => {
    const lit = await mount({ status: 'online' })
    const litScreen = materialOf(lit, 'esp32-screen-material')
    const litPcb = materialOf(lit, 'esp32-pcb-material')
    expect(litScreen?.getAttribute('emissiveintensity')).toBe('0.7')
    expect(litPcb?.getAttribute('opacity')).toBe('1')

    await act(async () => {
      root?.unmount()
    })
    host?.remove()
    const dim = await mount({ status: 'online', dimmed: true })
    const dimScreen = materialOf(dim, 'esp32-screen-material')
    const dimPcb = materialOf(dim, 'esp32-pcb-material')
    expect(dimScreen?.getAttribute('emissiveintensity')).toBe('0.05')
    expect(dimPcb?.getAttribute('opacity')).toBe('0.35')
  })

  it('dims the power and RGB LEDs when dimmed', async () => {
    const lit = await mount({ status: 'online' })
    expect(materialOf(lit, 'esp32-power-material')?.getAttribute('emissiveintensity')).toBe('1.4')
    expect(materialOf(lit, 'esp32-rgb-material')?.getAttribute('emissiveintensity')).toBe('1')

    await act(async () => {
      root?.unmount()
    })
    host?.remove()
    const dim = await mount({ status: 'online', dimmed: true })
    expect(materialOf(dim, 'esp32-power-material')?.getAttribute('emissiveintensity')).toBe('0.12')
    expect(materialOf(dim, 'esp32-rgb-material')?.getAttribute('emissiveintensity')).toBe('0.1')
  })
})
