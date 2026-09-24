// @vitest-environment jsdom
import { act } from 'react'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZERO_TOKENS } from '../../../../shared/tokens'
import IPhone, { MODEL_FOOTPRINT, STATUS_HEX, type IPhoneStatus } from './IPhone'

let root: Root | null = null
let host: HTMLElement | null = null

const mount = async (props: {
  status: IPhoneStatus
  dimmed?: boolean
  scale?: number
}): Promise<HTMLElement> => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root?.render(createElement(IPhone, props))
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

describe('IPhone footprint', () => {
  it('exports a sane phone footprint (w, h, d > 0, h > w)', () => {
    expect(MODEL_FOOTPRINT.w).toBeGreaterThan(0)
    expect(MODEL_FOOTPRINT.h).toBeGreaterThan(0)
    expect(MODEL_FOOTPRINT.d).toBeGreaterThan(0)
    expect(MODEL_FOOTPRINT.h).toBeGreaterThan(MODEL_FOOTPRINT.w)
    expect(MODEL_FOOTPRINT).toEqual({ w: 0.78, h: 1.6, d: 0.13 })
  })
})

describe('IPhone structure', () => {
  it('renders the named meshes (body, screen, island, cameras, buttons)', async () => {
    const el = await mount({ status: 'online' })
    for (const name of ['body', 'screen', 'island', 'cameras', 'buttons']) {
      expect(el.querySelector(`[name="${name}"]`), name).not.toBeNull()
    }
    expect(el.querySelector('[data-testid="iphone"]')).not.toBeNull()
  })

  it('renders the camera module details (plateau, 3 lenses, lidar, flash)', async () => {
    const el = await mount({ status: 'online' })
    expect(el.querySelector('[name="camera-plateau"]')).not.toBeNull()
    for (const name of ['camera-lens-0', 'camera-lens-1', 'camera-lens-2']) {
      expect(el.querySelector(`[name="${name}"]`), name).not.toBeNull()
    }
    expect(el.querySelector('[name="camera-lidar"]')).not.toBeNull()
    expect(el.querySelector('[name="camera-flash"]')).not.toBeNull()
  })

  it('renders the side buttons (volume x2, action, power)', async () => {
    const el = await mount({ status: 'online' })
    for (const name of [
      'button-action',
      'button-volume-up',
      'button-volume-down',
      'button-power'
    ]) {
      expect(el.querySelector(`[name="${name}"]`), name).not.toBeNull()
    }
  })

  it('renders the detail pass (antenna, bottom edge, SIM, rings, glass, screen)', async () => {
    const el = await mount({ status: 'online' })
    for (const name of [
      'antenna-top-left',
      'antenna-top-right',
      'antenna-bottom-left',
      'antenna-bottom-right',
      'bottom-usbc',
      'bottom-usbc-tongue',
      'bottom-speaker-holes',
      'bottom-mic-holes',
      'sim-tray',
      'sim-pinhole',
      'lens-rings',
      'lens-inners',
      'camera-mic',
      'island-speaker',
      'back-glass',
      'screen-time',
      'screen-date',
      'app-icons',
      'app-icon-accent',
      'action-knurls',
      'button-gaps',
      'button-gap-action',
      'button-gap-volume-up',
      'button-gap-volume-down',
      'button-gap-power'
    ]) {
      expect(el.querySelector(`[name="${name}"]`), name).not.toBeNull()
    }
  })

  it('instances repeated detail at the budgeted counts', async () => {
    const el = await mount({ status: 'online' })
    for (const [name, count] of [
      ['bottom-speaker-holes', '6'],
      ['bottom-mic-holes', '3'],
      ['lens-rings', '3'],
      ['lens-inners', '3'],
      ['app-icons', '12'],
      ['action-knurls', '3']
    ] as Array<[string, string]>) {
      expect(
        el.querySelector(`[name="${name}"]`)?.getAttribute('args')?.split(',').at(-1),
        name
      ).toBe(count)
    }
  })

  it('stands on the y=0 plane (contact shadow at ground level)', async () => {
    const el = await mount({ status: 'online' })
    expect(el.querySelector('[name="base-shadow"]')).not.toBeNull()
  })
})

describe('IPhone status light', () => {
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
  ] as Array<[IPhoneStatus, string]>)('lights %s with %s', async (status, hex) => {
    const el = await mount({ status })
    const light = el.querySelector('[data-testid="iphone-status-light"]')
    expect(light).not.toBeNull()
    const mat = materialOf(el, 'iphone-status-material')
    expect(mat).not.toBeNull()
    expect(mat?.getAttribute('emissive')?.toLowerCase()).toBe(hex.toLowerCase())
  })
})

describe('IPhone dimmed', () => {
  it('reduces screen emissive and body opacity when dimmed', async () => {
    const lit = await mount({ status: 'online' })
    const litScreen = materialOf(lit, 'iphone-screen-material')
    const litBody = materialOf(lit, 'iphone-body-material')
    const litTime = materialOf(lit, 'iphone-time-material')
    expect(litScreen?.getAttribute('emissiveintensity')).toBe('0.7')
    expect(litBody?.getAttribute('opacity')).toBe('1')
    expect(litTime?.getAttribute('emissiveintensity')).toBe('0.9')

    await act(async () => {
      root?.unmount()
    })
    host?.remove()
    const dim = await mount({ status: 'online', dimmed: true })
    const dimScreen = materialOf(dim, 'iphone-screen-material')
    const dimBody = materialOf(dim, 'iphone-body-material')
    const dimTime = materialOf(dim, 'iphone-time-material')
    expect(dimScreen?.getAttribute('emissiveintensity')).toBe('0.05')
    expect(dimBody?.getAttribute('opacity')).toBe('0.35')
    expect(dimTime?.getAttribute('emissiveintensity')).toBe('0.05')
  })
})
