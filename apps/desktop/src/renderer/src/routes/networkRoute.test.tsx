// @vitest-environment jsdom
import { act } from 'react'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCockpit } from '../store/cockpit'
import { NetworkRoute } from './NetworkRoute'
import type { SceneGraph } from './topology.model'
import fixtureJson from './fixtures/cockpit.json'

const sceneProps: {
  current: { graph: SceneGraph; selectedId: string | null; onSelect: (id: string) => void } | null
} = {
  current: null
}

vi.mock('./TopologyScene', () => ({
  TopologyScene: (props: {
    graph: SceneGraph
    selectedId: string | null
    onSelect: (id: string) => void
  }): unknown => {
    sceneProps.current = {
      graph: props.graph,
      selectedId: props.selectedId,
      onSelect: props.onSelect
    }
    return createElement('div', {
      'data-testid': 'topology-stub',
      onClick: (): void => props.onSelect('desk-display-01')
    })
  }
}))

let root: Root | null = null
let host: HTMLElement | null = null

const mount = async (): Promise<HTMLElement> => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root?.render(createElement(NetworkRoute))
  })
  await act(async () => {})
  return host
}

beforeEach(() => {
  sceneProps.current = null
  useCockpit.setState({
    state: 'live',
    snapshot: fixtureJson as unknown,
    lastError: null,
    refreshAt: Date.now()
  })
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  host?.remove()
  host = null
})

describe('NetworkRoute topology', () => {
  it('renders the 3D scene above the honest node list with one freshness chip', async () => {
    const el = await mount()
    const scene = el.querySelector('[data-testid="topology-stub"]')
    expect(scene).not.toBeNull()
    expect(el.textContent).toContain('desk-display-01')
    expect(el.textContent).toContain('desk-simulator')
    const chips = [...el.querySelectorAll('span')].filter((s) =>
      s.textContent?.startsWith('LIVE · REV')
    )
    expect(chips).toHaveLength(1)
  })

  it('feeds the scene the desk graph: no hub, no edges, gated iPhone aside', async () => {
    await mount()
    const graph = sceneProps.current?.graph
    // Router design killed: no hub node, no green edge connectors at all.
    expect(graph?.nodes.some((n) => n.id === 'zero')).toBe(false)
    expect(graph?.nodes.some((n) => (n.kind as string) === 'hub')).toBe(false)
    expect('edges' in (graph as object)).toBe(false)
    const phone = graph?.nodes.find((n) => n.kind === 'phone')
    expect(phone?.status).toBe('GATED')
    expect(phone?.selectable).toBe(false)
    // Desk peripherals ride along with the snapshot devices.
    expect(graph?.nodes.some((n) => n.id === 'desk-keyboard')).toBe(true)
    expect(graph?.nodes.some((n) => n.id === 'desk-mousepad')).toBe(true)
  })

  it('selects the same node from the scene and from the list row', async () => {
    const el = await mount()
    expect(sceneProps.current?.selectedId).toBeNull()
    await act(async () => {
      el.querySelector('[data-testid="topology-stub"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
    })
    expect(sceneProps.current?.selectedId).toBe('desk-display-01')
    const selected = [...el.querySelectorAll('[data-testid^="node-row-"]')].filter(
      (r) => r.getAttribute('aria-pressed') === 'true'
    )
    expect(selected.map((r) => r.getAttribute('data-testid'))).toEqual(['node-row-desk-display-01'])
    await act(async () => {
      el.querySelector('[data-testid="node-row-desk-simulator"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
    })
    expect(sceneProps.current?.selectedId).toBe('desk-simulator')
  })

  it('keeps the always-present host selectable even with no list row', async () => {
    await mount()
    expect(sceneProps.current?.graph.nodes.some((n) => n.id === 'local-host')).toBe(true)
    await act(async () => {
      sceneProps.current?.onSelect('local-host')
    })
    // The host has no list row, but the scene selection must survive (the
    // list only renders snapshot nodes).
    expect(sceneProps.current?.selectedId).toBe('local-host')
  })
})

describe('NetworkRoute local devices', () => {
  const FIXTURE = {
    devices: [
      {
        id: 'usb-kb',
        name: 'Gaming Keyboard',
        transport: 'usb',
        kind: 'keyboard',
        vendor: 'BY Tech'
      },
      { id: 'usb-ms', name: 'USB Receiver', transport: 'usb', kind: 'mouse', vendor: 'YJX-CHIP' },
      { id: 'usb-ser', name: 'USB Serial', transport: 'usb', kind: 'serial' },
      { id: 'bt-au', name: 'Spykar Sound', transport: 'bluetooth', kind: 'audio' }
    ],
    note: null
  }
  const invoke = vi.fn((op: string): Promise<unknown> =>
    op === 'devices.list'
      ? Promise.resolve(FIXTURE)
      : Promise.reject(new Error(`unexpected op ${op}`))
  )

  beforeEach(() => {
    invoke.mockClear()
    invoke.mockImplementation((op: string): Promise<unknown> =>
      op === 'devices.list'
        ? Promise.resolve(FIXTURE)
        : Promise.reject(new Error(`unexpected op ${op}`))
    )
    ;(window as unknown as { zero: unknown }).zero = { invoke }
  })

  afterEach(() => {
    delete (window as unknown as { zero?: unknown }).zero
  })

  it('renders a LOCAL DEVICES section with real names, transport chips and kind glyphs', async () => {
    const el = await mount()
    await act(async () => {})
    expect(el.textContent).toContain('LOCAL DEVICES')
    for (const id of [
      'device-row-usb-kb',
      'device-row-usb-ms',
      'device-row-usb-ser',
      'device-row-bt-au'
    ]) {
      expect(el.querySelector(`[data-testid="${id}"]`)).not.toBeNull()
    }
    expect(el.textContent).toContain('Gaming Keyboard')
    expect(el.textContent).toContain('USB')
    expect(el.textContent).toContain('BT')
    expect(el.textContent).toContain('⌨')
    expect(el.textContent).toContain('♪')
  })

  it('refreshes on demand with the Bluetooth slow path, polls fast otherwise', async () => {
    const el = await mount()
    await act(async () => {})
    expect(invoke).toHaveBeenCalledWith('devices.list', undefined)
    await act(async () => {
      el.querySelector('[data-testid="devices-refresh"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
    })
    await act(async () => {})
    expect(invoke).toHaveBeenCalledWith('devices.list', { refreshBt: true })
  })

  it('feeds local devices into the scene: real keyboard label plus pucks', async () => {
    await mount()
    await act(async () => {})
    const graph = sceneProps.current?.graph
    expect(graph?.nodes.find((n) => n.id === 'desk-keyboard')?.label).toBe('Gaming Keyboard')
    expect(graph?.nodes.find((n) => n.id === 'desk-mousepad')?.label).toBe('USB Receiver')
    expect(graph?.nodes.some((n) => n.id === 'peripheral-usb-ser')).toBe(true)
    expect(graph?.nodes.some((n) => n.id === 'peripheral-bt-au')).toBe(true)
  })

  it('stays honest when the lister sees nothing', async () => {
    invoke.mockImplementation((op: string): Promise<unknown> =>
      op === 'devices.list'
        ? Promise.resolve({ devices: [], note: 'No local USB or Bluetooth devices seen.' })
        : Promise.reject(new Error(`unexpected op ${op}`))
    )
    const el = await mount()
    await act(async () => {})
    expect(el.textContent).toContain('LOCAL DEVICES')
    expect(el.textContent).toContain('No local USB or Bluetooth devices seen.')
    // No fabricated names: the 3D models keep their generic labels.
    expect(sceneProps.current?.graph.nodes.find((n) => n.id === 'desk-keyboard')?.label).toBe(
      'RGB Keyboard'
    )
  })
})
