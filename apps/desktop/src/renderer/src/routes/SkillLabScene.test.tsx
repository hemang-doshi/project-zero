// @vitest-environment jsdom
import { act } from 'react'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STANDALONE_SCALE,
  VIAL_GAP_X,
  VIAL_GAP_Z,
  VIAL_STEP_X,
  VIAL_STEP_Z,
  labOverviewFor,
  layoutVialGrid,
  standaloneSkills,
  vialPosition
} from './SkillLabScene'
import { SkillLabScene } from './SkillLabScene'
import { SkillLabRoute } from './SkillLabRoute'
import type { PluginGroup, SkillSummary } from './skillPlugins'

const canvasProps: { current: Record<string, unknown> | null } = { current: null }
const controlsProps: { current: Record<string, unknown> | null } = { current: null }
const vialCalls: { current: Array<Record<string, unknown>> } = { current: [] }
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

// The sibling vial model is lanes A/B territory: stub it at the contract
// boundary ({ plugin: { id, name, color, glyph }, dimmed?, scale? },
// MODEL_FOOTPRINT { w: 0.9, h: 1.6, d: 0.9 }) and capture the props this
// scene passes through.
vi.mock('./models/SkillVial', () => ({
  default: (props: Record<string, unknown>): unknown => {
    vialCalls.current.push(props)
    const plugin = props.plugin as { id: string }
    // Real vials render no DOM text; the scene's Html labels own the names.
    return createElement('div', { 'data-testid': `skillvial-${plugin.id}` })
  },
  MODEL_FOOTPRINT: { w: 0.9, h: 1.6, d: 0.9 }
}))

const skill = (overrides: Partial<SkillSummary> & { id: string; name: string }): SkillSummary => ({
  source: 'installed',
  pluginId: 'p-codex',
  description: 'Does something useful.',
  ...overrides
})

const GROUPS: PluginGroup[] = [
  {
    id: 'p-codex',
    name: 'Codex Tools',
    color: '#F54E00',
    glyph: 'flask',
    skills: [
      skill({ id: 's-a', name: 'Alpha Skill', pluginId: 'p-codex', description: 'Alpha description.' }),
      skill({ id: 's-b', name: 'Beta Skill', pluginId: 'p-codex', source: 'installed' })
    ]
  },
  {
    id: 'p-design',
    name: 'Design Kit',
    color: '#3B82F6',
    glyph: 'stack',
    skills: [skill({ id: 's-c', name: 'Gamma Skill', pluginId: 'p-design' })]
  },
  {
    id: 'p-misc',
    name: 'Misc',
    color: '#10B981',
    glyph: 'bolt',
    skills: [
      skill({ id: 's-loose', name: 'Loose Skill', pluginId: null, description: 'No owning plugin.' })
    ]
  }
]

const SELF_LEARNT: SkillSummary[] = [
  { id: 'sl-1', name: 'Nightly Ritual', source: 'self-learnt', pluginId: null, description: 'Learnt overnight.' }
]

let root: Root | null = null
let host: HTMLElement | null = null

const mount = async (
  groups: PluginGroup[] = GROUPS,
  selfLearnt: SkillSummary[] = SELF_LEARNT
): Promise<HTMLElement> => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root?.render(createElement(SkillLabScene, { groups, selfLearnt }))
  })
  return host
}

beforeEach(() => {
  canvasProps.current = null
  controlsProps.current = null
  vialCalls.current = []
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
  delete (window as unknown as { zero?: unknown }).zero
  vi.restoreAllMocks()
})

describe('skill lab grid layout (pure)', () => {
  it('derives columns from the group count', () => {
    expect(layoutVialGrid(0)).toEqual({ cols: 0, rows: 0 })
    expect(layoutVialGrid(1)).toEqual({ cols: 1, rows: 1 })
    expect(layoutVialGrid(2)).toEqual({ cols: 2, rows: 1 })
    expect(layoutVialGrid(4)).toEqual({ cols: 2, rows: 2 })
    expect(layoutVialGrid(5)).toEqual({ cols: 3, rows: 2 })
    expect(layoutVialGrid(9)).toEqual({ cols: 3, rows: 3 })
  })

  it('spaces vials by the contract footprint plus gaps', () => {
    // Contract footprint { w: 0.9, h: 1.6, d: 0.9 } (pinned via the mock).
    expect(VIAL_STEP_X).toBe(0.9 + VIAL_GAP_X)
    expect(VIAL_STEP_Z).toBe(0.9 + VIAL_GAP_Z)
    expect(vialPosition(0, 3)).toEqual([0, 0, 0])
    expect(vialPosition(1, 3)).toEqual([VIAL_STEP_X, 0, 0])
    expect(vialPosition(3, 3)).toEqual([0, 0, VIAL_STEP_Z])
    expect(vialPosition(4, 3)).toEqual([VIAL_STEP_X, 0, VIAL_STEP_Z])
  })

  it('splits standalone skills (null pluginId) out of the plugin grid', () => {
    const out = standaloneSkills(GROUPS)
    expect(out.map((s) => s.id)).toEqual(['s-loose'])
    expect(standaloneSkills([])).toEqual([])
    // Dedupes by id; first occurrence wins.
    const dup: PluginGroup[] = [
      { id: 'a', name: 'A', color: '#000', glyph: 'orb', skills: [skill({ id: 'x', name: 'X', pluginId: null })] },
      { id: 'b', name: 'B', color: '#000', glyph: 'orb', skills: [skill({ id: 'x', name: 'X2', pluginId: null })] }
    ]
    expect(standaloneSkills(dup)).toHaveLength(1)
    expect(standaloneSkills(dup)[0].name).toBe('X')
  })

  it('fits the overview camera to the shelf width', () => {
    const narrow = labOverviewFor(4)
    const wide = labOverviewFor(10)
    expect(wide.position[2]).toBeGreaterThan(narrow.position[2])
    expect(narrow.target).toEqual([0, 0.7, 0.4])
  })
})

describe('SkillLabScene', () => {
  it('renders the canvas render-on-demand with no perpetual loops', async () => {
    await mount()
    expect(canvasProps.current?.frameloop).toBe('demand')
    expect((canvasProps.current?.gl as Record<string, unknown>)?.powerPreference).toBe(
      'high-performance'
    )
  })

  it('leaves the camera user-driven: rotate, pan, zoom damped, no autorotate', async () => {
    await mount()
    expect(controlsProps.current?.autoRotate).toBe(false)
    expect(controlsProps.current?.enableDamping).toBe(true)
    expect(controlsProps.current?.enableRotate).toBe(true)
    expect(controlsProps.current?.enablePan).toBe(true)
    expect(controlsProps.current?.enableZoom).toBe(true)
    expect(controlsProps.current?.maxPolarAngle).toBeLessThanOrEqual(Math.PI / 2)
  })

  it('renders one vial per plugin group on the dark shelf', async () => {
    const el = await mount()
    expect(el.querySelector('[data-testid="lab-shelf"]')).not.toBeNull()
    for (const g of GROUPS) {
      expect(el.querySelector(`[data-testid="vial-${g.id}"]`)).not.toBeNull()
      expect(el.querySelector(`[data-testid="skillvial-${g.id}"]`)).not.toBeNull()
    }
    // Labels carry the plugin names; the vial gets the contract props.
    expect(el.textContent).toContain('Codex Tools')
    const codex = vialCalls.current.find(
      (c) => (c.plugin as { id: string }).id === 'p-codex'
    )
    expect(codex?.dimmed).toBe(false)
    expect(codex?.scale).toBe(1)
    expect(codex?.plugin).toMatchObject({
      id: 'p-codex',
      name: 'Codex Tools',
      color: '#F54E00',
      glyph: 'flask'
    })
  })

  it('clicks a vial into focus with a detail panel listing that plugin\u2019s actual skills', async () => {
    const el = await mount()
    expect(el.querySelector('[data-testid="vial-detail"]')).toBeNull()
    await act(async () => {
      el.querySelector('[data-testid="vial-p-codex"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
    })
    const detail = el.querySelector('[data-testid="vial-detail"]')
    expect(detail).not.toBeNull()
    expect(detail?.textContent).toContain('Codex Tools')
    expect(detail?.textContent).toContain('Alpha Skill')
    expect(detail?.textContent).toContain('Alpha description.')
    expect(detail?.textContent).toContain('Beta Skill')
    expect(detail?.textContent).toContain('INSTALLED')
    expect(detail?.textContent).toContain('glyph flask')
    // Other plugins stay out of the detail panel.
    expect(detail?.textContent).not.toContain('Gamma Skill')
    expect(el.querySelector('[data-testid="vial-focus-ring-plugin:p-codex"]')).not.toBeNull()
    // Overview vial labels hide in focus view; the detail carries the title.
    expect(el.textContent).not.toContain('Design Kit')
  })

  it('renders standalone skills as smaller vials in their own row', async () => {
    const el = await mount()
    expect(el.querySelector('[data-testid="standalone-row-label"]')?.textContent).toContain(
      'STANDALONE'
    )
    expect(el.querySelector('[data-testid="vial-standalone-s-loose"]')).not.toBeNull()
    const loose = vialCalls.current.find(
      (c) => (c.plugin as { id: string }).id === 's-loose'
    )
    expect(loose?.scale).toBe(STANDALONE_SCALE)
  })

  it('focuses a standalone vial with an honest single-skill detail', async () => {
    const el = await mount()
    await act(async () => {
      el.querySelector('[data-testid="vial-standalone-s-loose"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
    })
    const detail = el.querySelector('[data-testid="vial-detail"]')
    expect(detail?.textContent).toContain('Loose Skill')
    expect(detail?.textContent).toContain('No owning plugin.')
    expect(detail?.textContent).toContain('STANDALONE SKILL')
  })

  it('shows honest-empty states for an empty grid and standalone row', async () => {
    const el = await mount([], [])
    expect(el.querySelector('[data-testid="vial-grid-empty"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="standalone-row-empty"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="scene-selflearn-empty"]')).not.toBeNull()
  })

  it('lists self-learnt skills with details above the grid', async () => {
    const el = await mount()
    const row = el.querySelector('[data-testid="scene-selflearn-row-sl-1"]')
    expect(row).not.toBeNull()
    expect(row?.textContent).toContain('Nightly Ritual')
    expect(row?.textContent).toContain('Learnt overnight.')
    expect(row?.textContent).toContain('SELF-LEARNT')
  })

  it('returns to the shelf from Back, ESC, and empty-space clicks', async () => {
    const el = await mount()
    await act(async () => {
      el.querySelector('[data-testid="vial-p-design"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
    })
    expect(el.querySelector('[data-testid="vial-detail"]')).not.toBeNull()
    await act(async () => {
      el.querySelector('[data-testid="vial-back"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
    })
    expect(el.querySelector('[data-testid="vial-detail"]')).toBeNull()

    await act(async () => {
      el.querySelector('[data-testid="vial-p-design"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
    })
    expect(el.querySelector('[data-testid="vial-detail"]')).not.toBeNull()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(el.querySelector('[data-testid="vial-detail"]')).toBeNull()

    await act(async () => {
      el.querySelector('[data-testid="vial-p-design"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
    })
    expect(el.querySelector('[data-testid="vial-detail"]')).not.toBeNull()
    await act(async () => {
      ;(canvasProps.current?.onPointerMissed as (() => void) | undefined)?.()
    })
    expect(el.querySelector('[data-testid="vial-detail"]')).toBeNull()
  })

  it('stops the bounded focus-tween interval when the flight completes', async () => {
    const cleared: number[] = []
    vi.spyOn(window, 'clearInterval').mockImplementation(((id?: number) => {
      if (id !== undefined) cleared.push(id)
      return undefined
    }) as typeof window.clearInterval)
    let now = 100000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const el = await mount()
    await act(async () => {
      el.querySelector('[data-testid="vial-p-codex"]')?.dispatchEvent(
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

  it('renders an honest fallback with no canvas when WebGL2 is unavailable', async () => {
    vi.restoreAllMocks()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    canvasProps.current = null
    await mount()
    expect(canvasProps.current).toBeNull()
    expect(host?.textContent).toContain('3D unavailable')
    expect(host?.querySelector('[data-testid="skilllab-fallback"]')).not.toBeNull()
  })

  it('never calls sockets or IPC: renders fully from props with window.zero missing', async () => {
    delete (window as unknown as { zero?: unknown }).zero
    const invoke = vi.fn()
    try {
      const el = await mount()
      expect(window).not.toHaveProperty('zero')
      expect(el.querySelector('[data-testid="skilllab-scene"]')).not.toBeNull()
      expect(el.querySelector('[data-testid="vial-p-codex"]')).not.toBeNull()
      expect(invoke).not.toHaveBeenCalled()
    } finally {
      delete (window as unknown as { zero?: unknown }).zero
    }
  })

  it('never calls invoke even when a bridge exists', async () => {
    const invoke = vi.fn(async () => null)
    ;(window as unknown as { zero?: unknown }).zero = { invoke, subscribe: () => () => {} }
    const el = await mount()
    await act(async () => {
      el.querySelector('[data-testid="vial-p-codex"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
    })
    expect(invoke).not.toHaveBeenCalled()
  })
})

describe('SkillLabRoute (scene wiring)', () => {
  it('mounts SELF-LEARNING and INSTALLED BY PLUGIN sections with an honest fallback', () => {
    delete (window as unknown as { zero?: unknown }).zero
    const html = renderToString(createElement(SkillLabRoute))
    expect(html).toContain('SELF-LEARNING')
    expect(html).toContain('INSTALLED BY PLUGIN')
    // Fallback derives self-learnt rows from the learned-in-* fixtures.
    expect(html).toContain('Zero Debug Ritual')
    expect(html).toContain('Desk Display Notes')
    // The op is not wired yet: the grid stays honestly empty.
    expect(html).toContain('skills.discover is not wired')
  })
})
