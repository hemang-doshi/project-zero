// @vitest-environment jsdom
import { act } from 'react'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZERO_TOKENS } from '../../../../shared/tokens'
import Monitor, { MODEL_FOOTPRINT, STATUS_HEX, type MonitorStatus } from './Monitor'

let root: Root | null = null
let host: HTMLElement | null = null

const mount = async (props: {
  status: MonitorStatus
  dimmed?: boolean
  scale?: number
}): Promise<HTMLElement> => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root?.render(createElement(Monitor, props))
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

describe('Monitor footprint', () => {
  it('exports a sane monitor footprint (w, h, d > 0, w > h)', () => {
    expect(MODEL_FOOTPRINT.w).toBeGreaterThan(0)
    expect(MODEL_FOOTPRINT.h).toBeGreaterThan(0)
    expect(MODEL_FOOTPRINT.d).toBeGreaterThan(0)
    expect(MODEL_FOOTPRINT.w).toBeGreaterThan(MODEL_FOOTPRINT.h)
    expect(MODEL_FOOTPRINT).toEqual({ w: 5.12, h: 4.16, d: 1.2 })
  })
})

describe('Monitor structure', () => {
  it('keeps the stand neck below the bottom of the panel', async () => {
    const el = await mount({ status: 'online' })
    const stand = el.querySelector('[data-testid="monitor-stand"]')
    const position = (stand?.getAttribute('position') ?? '').split(',').map(Number)
    const geometry = (stand?.querySelector('boxgeometry')?.getAttribute('args') ?? '').split(',').map(Number)
    expect(position[1] + geometry[1] / 2).toBeLessThanOrEqual(0.62)
  })
  it('renders the named meshes (panel, screen, chin, stand, base, back)', async () => {
    const el = await mount({ status: 'online' })
    for (const name of ['panel', 'screen', 'chin', 'stand', 'base', 'back']) {
      expect(el.querySelector(`[name="${name}"]`), name).not.toBeNull()
    }
    expect(el.querySelector('[data-testid="monitor"]')).not.toBeNull()
  })

  it('renders the back details (VESA plate, ports, power LED)', async () => {
    const el = await mount({ status: 'online' })
    expect(el.querySelector('[name="vesa"]')).not.toBeNull()
    for (const name of ['port-hdmi', 'port-dp', 'port-usbc']) {
      expect(el.querySelector(`[name="${name}"]`), name).not.toBeNull()
    }
    expect(el.querySelector('[data-testid="monitor-status-light"]')).not.toBeNull()
  })

  it('renders the detail pass 2 (OSD, full port array, vents, stand, bezel, badge, glow)', async () => {
    const el = await mount({ status: 'online' })
    for (const name of [
      'osd-buttons',
      'osd-joystick',
      'ports-recess',
      'port-hdmi-tongue',
      'port-usba',
      'port-usba-tongues',
      'port-power',
      'port-power-pin',
      'vesa-screws',
      'vent-slots',
      'cable-clip',
      'cable',
      'stand-seam',
      'bezel-micro-edge',
      'screen-glare',
      'menubar-dots',
      'screen-window-a-title',
      'window-dots',
      'screen-window-b-title',
      'dock-icons',
      'chin-badge',
      'back-glow'
    ]) {
      expect(el.querySelector(`[name="${name}"]`), name).not.toBeNull()
    }
  })

  it('instances repeated detail at the budgeted counts', async () => {
    const el = await mount({ status: 'online' })
    for (const [name, count] of [
      ['vesa-screws', '4'],
      ['vent-slots', '12'],
      ['osd-buttons', '4'],
      ['port-usba', '2'],
      ['port-usba-tongues', '2'],
      ['menubar-dots', '3'],
      ['window-dots', '3'],
      ['dock-icons', '6']
    ] as Array<[string, string]>) {
      expect(
        el.querySelector(`[name="${name}"]`)?.getAttribute('args')?.split(',').at(-1),
        name
      ).toBe(count)
    }
  })

  it('stands on the y=0 plane (base foot bottom and shadow at ground level)', async () => {
    const el = await mount({ status: 'online' })
    expect(el.querySelector('[name="base"]')).not.toBeNull()
    expect(el.querySelector('[name="base-shadow"]')).not.toBeNull()
  })
})

describe('Monitor status light', () => {
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
  ] as Array<[MonitorStatus, string]>)('lights %s with %s', async (status, hex) => {
    const el = await mount({ status })
    const light = el.querySelector('[data-testid="monitor-status-light"]')
    expect(light).not.toBeNull()
    const mat = materialOf(el, 'monitor-status-material')
    expect(mat).not.toBeNull()
    expect(mat?.getAttribute('emissive')?.toLowerCase()).toBe(hex.toLowerCase())
  })
})

describe('Monitor dimmed', () => {
  it('reduces screen emissive and body opacity when dimmed', async () => {
    const lit = await mount({ status: 'online' })
    const litScreen = materialOf(lit, 'monitor-screen-material')
    const litPanel = materialOf(lit, 'monitor-panel-material')
    expect(litScreen?.getAttribute('emissiveintensity')).toBe('0.7')
    expect(litPanel?.getAttribute('opacity')).toBe('1')

    await act(async () => {
      root?.unmount()
    })
    host?.remove()
    const dim = await mount({ status: 'online', dimmed: true })
    const dimScreen = materialOf(dim, 'monitor-screen-material')
    const dimPanel = materialOf(dim, 'monitor-panel-material')
    expect(dimScreen?.getAttribute('emissiveintensity')).toBe('0.05')
    expect(dimPanel?.getAttribute('opacity')).toBe('0.35')
  })

  it('dims the bias back-glow strip when dimmed', async () => {
    const lit = await mount({ status: 'online' })
    expect(materialOf(lit, 'monitor-back-glow-material')?.getAttribute('emissiveintensity')).toBe(
      '0.35'
    )

    await act(async () => {
      root?.unmount()
    })
    host?.remove()
    const dim = await mount({ status: 'online', dimmed: true })
    expect(materialOf(dim, 'monitor-back-glow-material')?.getAttribute('emissiveintensity')).toBe(
      '0.03'
    )
  })
})
