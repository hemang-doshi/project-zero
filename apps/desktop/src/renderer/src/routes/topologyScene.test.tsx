// @vitest-environment jsdom
import { act } from 'react'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeConnState } from '../../../shared/protocol'
import { BREADBOARD_DOT_CAP } from './topology.model'
import { buildSceneGraph, type SceneGraph } from './topology.model'
import { TopologyScene } from './TopologyScene'

const canvasProps: { current: Record<string, unknown> | null } = { current: null }
const controlsProps: { current: Record<string, unknown> | null } = { current: null }
const frameHooks = vi.hoisted(() => ({
  current: [] as Array<(state: unknown, delta: number) => void>
}))

vi.mock('@react-three/fiber', () => ({
  Canvas: (props: Record<string, unknown>): unknown => {
    canvasProps.current = props
    return (props.children as unknown) ?? null
  },
  useFrame: (cb: (state: unknown, delta: number) => void): void => {
    frameHooks.current.push(cb)
  },
  // Apply the selector like real R3F so invalidate/camera/controls resolve
  // to their fields instead of the whole state object.
  useThree: (sel: (s: Record<string, unknown>) => unknown): unknown =>
    sel({
      invalidate: (): void => {},
      camera: {
        position: {
          copy: (): void => {},
          set: (): void => {},
          clone: (): unknown => ({ lerpVectors: (): void => {} }),
          lerpVectors: (): void => {}
        },
        lookAt: (): void => {}
      },
      controls: null,
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
    }
  ],
  LIVE
)

let root: Root | null = null
let host: HTMLElement | null = null

const mount = async (
  onSelect: (id: string) => void,
  g: SceneGraph = graph
): Promise<HTMLElement> => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root?.render(createElement(TopologyScene, { graph: g, selectedId: null, onSelect }))
  })
  return host
}

beforeEach(() => {
  canvasProps.current = null
  controlsProps.current = null
  frameHooks.current = []
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

  it('enables full traversal: rotate, pan, and zoom with a floor clamp', async () => {
    await mount(() => {})
    expect(controlsProps.current?.enableRotate).toBe(true)
    expect(controlsProps.current?.enablePan).toBe(true)
    expect(controlsProps.current?.enableZoom).toBe(true)
    expect(controlsProps.current?.minDistance).toBe(3)
    expect(controlsProps.current?.maxDistance).toBe(26)
    expect(controlsProps.current?.maxPolarAngle).toBeLessThanOrEqual(Math.PI / 2)
  })

  it('carries no hub, router, or beam remnants', async () => {
    const el = await mount(() => {})
    expect(el.querySelector('[data-testid="zero-router"]')).toBeNull()
    expect(el.querySelectorAll('[data-testid^="edge-"]').length).toBe(0)
    expect(el.querySelectorAll('[data-testid^="flow-"]').length).toBe(0)
    expect(el.textContent).not.toContain('→zero')
  })

  it('stages the desk furniture: surface, stand, breadboard with dots', async () => {
    const el = await mount(() => {})
    expect(el.querySelector('[data-testid="desk-surface"]')).not.toBeNull()
    expect(el.querySelectorAll('[data-testid="laptop-stand"]').length).toBeGreaterThanOrEqual(2)
    expect(el.querySelector('[data-testid="breadboard"]')).not.toBeNull()
    const dots = el.querySelector('[data-testid="breadboard-dots"]')
    expect(dots).not.toBeNull()
    // The perforation count itself is pinned at the pure-data level
    // (breadboardDots length vs BREADBOARD_DOT_CAP in topology.model.test.ts);
    // the three.js InstancedMesh takes no DOM-count attribute.
    expect(BREADBOARD_DOT_CAP).toBe(200)
  })

  it('runs the four physical cables plus four colored jumpers', async () => {
    const el = await mount(() => {})
    for (const id of ['usb-c-macbook-monitor', 'esp32-usb', 'keyboard-cable', 'mouse-cable']) {
      expect(el.querySelector(`[data-testid="cable-${id}"]`)).not.toBeNull()
    }
    for (const id of ['jumper-red', 'jumper-yellow', 'jumper-blue', 'jumper-green']) {
      expect(el.querySelector(`[data-testid="${id}"]`)).not.toBeNull()
    }
  })

  it('carries no runtime ring: the owner removed it', async () => {
    const el = await mount(() => {})
    expect(el.querySelector('[data-testid="runtime-ring"]')).toBeNull()
    expect(el.textContent).not.toContain('ZERO RUNTIME LAYER')
  })

  it('renders overview titles small (pinned legible-minimal 8px)', async () => {
    const el = await mount(() => {})
    const label = [...el.querySelectorAll('div')].find(
      (d) => d.textContent === 'M4 MacBook Air · ONLINE'
    )
    expect(label).toBeDefined()
    expect(label?.style.fontSize).toBe('8px')
  })

  it('hides per-node titles in focus view while the detail panel carries the title', async () => {
    const el = await mount(() => {})
    expect(el.textContent).toContain('Desk Display · ESP32 · ONLINE')
    await act(async () => {
      el.querySelector('[data-testid="node-local-host"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
    })
    expect(el.querySelector('[data-testid="focus-detail"]')).not.toBeNull()
    // Titles vanish; the detail panel carries the focused title instead.
    expect(el.textContent).not.toContain('Desk Display · ESP32 · ONLINE')
    expect(el.textContent).not.toContain('Mouse + Desk Mat · ONLINE')
    expect(el.textContent).not.toContain('M4 MacBook Air · ONLINE')
    expect(el.querySelector('[data-testid="focus-detail"]')?.textContent).toContain(
      'M4 MacBook Air'
    )
    // The GATED status badge is not a title and stays.
    expect(el.textContent).toContain('GATED')
  })

  it('always renders the host MacBook even though the fixture enrolls no Mac', async () => {
    const el = await mount(() => {})
    const hostMesh = el.querySelector('[data-testid="node-local-host"]')
    expect(hostMesh).not.toBeNull()
    expect(el.querySelector('[data-testid="macbook-air"]')).not.toBeNull()
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

  it('places all six desk devices with no placeholder boxes', async () => {
    const el = await mount(() => {})
    expect(el.querySelector('[data-testid="macbook-air"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="monitor"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="esp32-desk-display"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="keyboard"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="mousepad"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="iphone"]')).not.toBeNull()
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

  it('clicks a device into focus with a detail overlay and highlight ring', async () => {
    const seen: string[] = []
    const el = await mount((id) => seen.push(id))
    expect(el.querySelector('[data-testid="focus-detail"]')).toBeNull()
    const mesh = el.querySelector('[data-testid="node-local-host"]')
    expect(mesh).not.toBeNull()
    await act(async () => {
      mesh?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(seen).toEqual(['local-host'])
    const detail = el.querySelector('[data-testid="focus-detail"]')
    expect(detail).not.toBeNull()
    expect(detail?.textContent).toContain('M4 MacBook Air')
    expect(detail?.textContent).toContain('ONLINE')
    expect(detail?.textContent).toContain('3.0 × 2.1 × 2.5')
    expect(el.querySelector('[data-testid="focus-ring-local-host"]')).not.toBeNull()
  })

  it('focuses a peripheral with honest no-node detail rows', async () => {
    const el = await mount(() => {})
    await act(async () => {
      el.querySelector('[data-testid="node-desk-keyboard"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
    })
    const detail = el.querySelector('[data-testid="focus-detail"]')
    expect(detail).not.toBeNull()
    expect(detail?.textContent).toContain('RGB Keyboard')
    expect(detail?.textContent).toContain('2.8 × 0.4 × 1.2')
  })

  it('renders one labelled puck per extra local device with the real names', async () => {
    const g = buildSceneGraph([], LIVE, [
      { id: 'usb-kb', name: 'Gaming Keyboard', transport: 'usb', kind: 'keyboard' },
      { id: 'usb-ser', name: 'USB Serial', transport: 'usb', kind: 'serial' },
      { id: 'bt-au', name: 'Spykar Sound', transport: 'bluetooth', kind: 'audio' }
    ])
    const el = await mount(() => {}, g)
    // The keyboard model takes the real connected name, not the generic one.
    expect(el.textContent).toContain('Gaming Keyboard · ONLINE')
    expect(el.textContent).not.toContain('RGB Keyboard')
    // One small puck node per extra device, labelled with the real name.
    expect(el.querySelector('[data-testid="node-peripheral-usb-ser"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="node-peripheral-bt-au"]')).not.toBeNull()
    expect(el.textContent).toContain('USB Serial · ONLINE')
    expect(el.textContent).toContain('Spykar Sound · ONLINE')
    // Pucks are markers, not models: no new full-model testids appear.
    expect(el.querySelectorAll('[data-testid="macbook-air"]').length).toBe(1)
    // The gated-iPhone rule is untouched by local devices.
    expect(el.textContent).toContain('GATED')
  })

  it('returns to overview from the Back control', async () => {
    const el = await mount(() => {})
    await act(async () => {
      el.querySelector('[data-testid="node-local-host"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
    })
    expect(el.querySelector('[data-testid="focus-detail"]')).not.toBeNull()
    await act(async () => {
      el.querySelector('[data-testid="focus-back"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
    })
    expect(el.querySelector('[data-testid="focus-detail"]')).toBeNull()
  })

  it('returns to overview on ESC', async () => {
    const el = await mount(() => {})
    await act(async () => {
      el.querySelector('[data-testid="node-local-host"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
    })
    expect(el.querySelector('[data-testid="focus-detail"]')).not.toBeNull()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(el.querySelector('[data-testid="focus-detail"]')).toBeNull()
  })

  it('returns to overview on empty-space click via onPointerMissed', async () => {
    const el = await mount(() => {})
    await act(async () => {
      el.querySelector('[data-testid="node-local-host"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
    })
    expect(el.querySelector('[data-testid="focus-detail"]')).not.toBeNull()
    await act(async () => {
      ;(canvasProps.current?.onPointerMissed as (() => void) | undefined)?.()
    })
    expect(el.querySelector('[data-testid="focus-detail"]')).toBeNull()
  })

  it('stops the bounded focus-tween interval when the flight completes', async () => {
    // Regression pin: a leaked 16ms invalidator would pin the renderer at
    // 60fps under frameloop="demand" (idle-CPU bar). Drive the captured frame
    // callbacks past FOCUS_TWEEN_MS and require the interval to clear.
    const cleared: number[] = []
    vi.spyOn(window, 'clearInterval').mockImplementation(((id?: number) => {
      if (id !== undefined) cleared.push(id)
      return undefined
    }) as typeof window.clearInterval)
    let now = 100000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const el = await mount(() => {})
    await act(async () => {
      el.querySelector('[data-testid="node-local-host"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
    })
    expect(frameHooks.current.length).toBeGreaterThan(0)
    await act(async () => {
      now += 1200
      for (const cb of frameHooks.current) cb({ clock: { elapsedTime: 0 } }, 0.016)
    })
    expect(cleared.length).toBeGreaterThan(0)
  })
})
