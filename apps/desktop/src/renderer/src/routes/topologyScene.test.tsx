// @vitest-environment jsdom
import { act } from 'react'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeConnState } from '../../../shared/protocol'
import { buildSceneGraph } from './topology.model'
import { TopologyScene } from './TopologyScene'

const canvasProps: { current: Record<string, unknown> | null } = { current: null }
const controlsProps: { current: Record<string, unknown> | null } = { current: null }

vi.mock('@react-three/fiber', () => ({
  Canvas: (props: Record<string, unknown>): unknown => {
    canvasProps.current = props
    return (props.children as unknown) ?? null
  },
  useFrame: (): void => {},
  useThree: (): unknown => ({
    invalidate: (): void => {},
    camera: { position: { copy: (): void => {}, set: (): void => {} }, lookAt: (): void => {} },
    clock: { elapsedTime: 0 }
  })
}))

vi.mock('@react-three/drei', () => ({
  OrbitControls: (props: Record<string, unknown>): null => {
    controlsProps.current = props
    return null
  },
  Html: ({ children }: { children?: unknown }): unknown => children ?? null
}))

const LIVE: RuntimeConnState = 'live'

const graph = buildSceneGraph(
  [
    {
      id: 'desk-display-01',
      revoked: false,
      capabilities: ['display.render', 'display.clear'],
      last_seen: '2026-09-11T05:59:49.000Z',
      status: 'ONLINE'
    },
    {
      id: 'desk-simulator',
      revoked: false,
      capabilities: ['display.render', 'display.clear'],
      last_seen: '2026-09-09T01:51:25.000Z',
      status: 'OFFLINE'
    },
    {
      id: 'work-mac',
      revoked: false,
      capabilities: [],
      last_seen: '2026-09-11T05:59:49.000Z',
      status: 'ONLINE'
    }
  ],
  LIVE
)

let root: Root | null = null
let host: HTMLElement | null = null

const mount = async (onSelect: (id: string) => void): Promise<HTMLElement> => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root?.render(createElement(TopologyScene, { graph, selectedId: null, onSelect }))
  })
  return host
}

beforeEach(() => {
  canvasProps.current = null
  controlsProps.current = null
  // The fiber mock renders R3F intrinsics (<mesh>, <boxGeometry>, …) as plain
  // DOM tags, tripping React's casing validation. Real R3F resolves these
  // itself, so filter that artifact narrowly and let all other errors through.
  vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...rest: unknown[]) => {
    if (typeof message === 'string' && message.includes('incorrect casing')) return
    process.stderr.write(`console.error: ${String(message)} ${rest.map(String).join(' ')}\n`)
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never)
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

describe('TopologyScene', () => {
  it('renders the canvas render-on-demand with high-performance WebGL', async () => {
    await mount(() => {})
    expect(canvasProps.current?.frameloop).toBe('demand')
    expect((canvasProps.current?.gl as Record<string, unknown>)?.powerPreference).toBe(
      'high-performance'
    )
  })

  it('leaves the camera user-driven with auto-rotate off and damping on', async () => {
    await mount(() => {})
    expect(controlsProps.current?.autoRotate).toBe(false)
    expect(controlsProps.current?.enableDamping).toBe(true)
  })

  it('emits a semantic select id when a live node is clicked', async () => {
    const seen: string[] = []
    const el = await mount((id) => seen.push(id))
    const mesh = el.querySelector('[data-testid="node-desk-display-01"]')
    expect(mesh).not.toBeNull()
    await act(async () => {
      mesh?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(seen).toEqual(['desk-display-01'])
  })

  it('places the four real device models with no placeholder boxes', async () => {
    const el = await mount(() => {})
    expect(el.querySelector('[data-testid="macbook-air"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="monitor"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="esp32-desk-display"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="iphone"]')).not.toBeNull()
  })

  it('draws one hub edge per live non-gated node and none for the gated iPhone', async () => {
    const el = await mount(() => {})
    const edges = [...el.querySelectorAll('[data-testid^="edge-"]')].map((e) =>
      e.getAttribute('data-testid')
    )
    expect(edges).toContain('edge-desk-display-01→zero')
    expect(edges).toContain('edge-desk-simulator→zero')
    expect(edges).toContain('edge-work-mac→zero')
    const phone = graph.nodes.find((n) => n.kind === 'phone')
    expect(phone).toBeDefined()
    expect(edges.some((id) => id?.startsWith(`edge-${phone?.id}`))).toBe(false)
  })

  it('emits nothing for the gated iPhone and badges it GATED', async () => {
    const seen: string[] = []
    const el = await mount((id) => seen.push(id))
    expect(el.textContent).toContain('GATED')
    const phone = graph.nodes.find((n) => n.kind === 'phone')
    expect(phone).toBeDefined()
    const mesh = el.querySelector(`[data-testid="node-${phone?.id}"]`)
    expect(mesh).not.toBeNull()
    await act(async () => {
      mesh?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(seen).toEqual([])
  })

  it('renders an honest fallback with no canvas when WebGL2 is unavailable', async () => {
    vi.restoreAllMocks()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    canvasProps.current = null
    await mount(() => {})
    expect(canvasProps.current).toBeNull()
    expect(host?.textContent).toContain('3D unavailable')
  })
})
