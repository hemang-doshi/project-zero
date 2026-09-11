// @vitest-environment jsdom
import { act } from 'react'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SkillVial, {
  BASE_H,
  BASE_Y,
  MODEL_BASE_BOTTOM,
  MODEL_FOOTPRINT,
  PLUGIN_GLYPHS,
  type SkillGlyph,
  type SkillVialPlugin
} from './SkillVial'

let root: Root | null = null
let host: HTMLElement | null = null

const pluginFor = (glyph: SkillGlyph, color = '#B45CFF'): SkillVialPlugin => ({
  id: `test-${glyph}`,
  name: `Test ${glyph}`,
  color,
  glyph
})

const mount = async (props: {
  plugin: SkillVialPlugin
  dimmed?: boolean
  scale?: number
}): Promise<HTMLElement> => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root?.render(createElement(SkillVial, props))
  })
  return host
}

beforeEach(() => {
  // The fiber mock-free render emits R3F intrinsics (<mesh>, <boxGeometry>, …)
  // as plain DOM tags, tripping React's casing validation. Real R3F resolves
  // these itself, so filter that artifact narrowly and let all other errors
  // through — same harness as MousePad.test.tsx.
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

describe('SkillVial footprint', () => {
  it('exports the exact binding footprint', () => {
    expect(MODEL_FOOTPRINT).toEqual({ w: 0.9, h: 1.6, d: 0.9 })
  })

  it('exports the binding glyph set', () => {
    expect([...PLUGIN_GLYPHS]).toEqual(['flask', 'masks', 'stack', 'bolt', 'orb'])
  })
})

describe('SkillVial structure', () => {
  it('renders the vial assembly (base, glass, dome, liquid, strands, rungs, cap, rim, chip)', async () => {
    const el = await mount({ plugin: pluginFor('flask') })
    for (const name of [
      'base',
      'glass',
      'dome',
      'liquid',
      'strand-a',
      'strand-b',
      'rung-0',
      'rung-2',
      'rung-4',
      'cap',
      'rim',
      'chip',
      'chip-glyph'
    ]) {
      expect(el.querySelector(`[name="${name}"]`), name).not.toBeNull()
    }
    expect(el.querySelector('[data-testid="skillvial"]')).not.toBeNull()
  })

  it('stands on y=0 via the base disc (bottom face flush on the desk plane)', () => {
    expect(MODEL_BASE_BOTTOM).toBe(0)
    expect(BASE_Y - BASE_H / 2).toBe(0)
  })

  it('renders the base mesh at half its thickness above y=0', async () => {
    const el = await mount({ plugin: pluginFor('orb') })
    expect(el.querySelector('[data-testid="skillvial-base"]')).not.toBeNull()
    expect(BASE_Y).toBeGreaterThan(0)
  })
})

describe('SkillVial glyphs', () => {
  const glyphMeshes: Record<SkillGlyph, string[]> = {
    flask: ['glyph-flask-body', 'glyph-flask-neck'],
    masks: ['glyph-masks-left', 'glyph-masks-right'],
    stack: ['glyph-stack-0', 'glyph-stack-1', 'glyph-stack-2'],
    bolt: ['glyph-bolt-shard'],
    orb: ['glyph-orb-core', 'glyph-orb-ring']
  }

  it.each([...PLUGIN_GLYPHS] as SkillGlyph[])('renders glyph %s with its own geometry', async (glyph) => {
    const el = await mount({ plugin: pluginFor(glyph) })
    for (const name of glyphMeshes[glyph]) {
      expect(el.querySelector(`[name="${name}"]`), name).not.toBeNull()
    }
  })

  it('renders distinct geometry per glyph value (no cross-glyph leakage)', async () => {
    const el = await mount({ plugin: pluginFor('bolt') })
    expect(el.querySelector('[name="glyph-bolt-shard"]')).not.toBeNull()
    for (const other of ['glyph-flask-body', 'glyph-masks-left', 'glyph-stack-0', 'glyph-orb-core']) {
      expect(el.querySelector(`[name="${other}"]`), other).toBeNull()
    }

    await act(async () => {
      root?.unmount()
    })
    host?.remove()
    const el2 = await mount({ plugin: pluginFor('stack') })
    expect(el2.querySelector('[name="glyph-stack-2"]')).not.toBeNull()
    expect(el2.querySelector('[name="glyph-bolt-shard"]')).toBeNull()
  })
})

describe('SkillVial plugin color', () => {
  it('flows the plugin color to the helix emissive', async () => {
    const el = await mount({ plugin: pluginFor('flask', '#FF00AA') })
    const helix = el.querySelectorAll('[data-testid="skillvial-helix-material"]')
    expect(helix.length).toBe(2)
    for (const mat of helix) {
      expect(mat.getAttribute('emissive')?.toLowerCase()).toBe('#ff00aa')
      expect(mat.getAttribute('color')?.toLowerCase()).toBe('#ff00aa')
    }
  })

  it('tracks color changes across plugins', async () => {
    const el = await mount({ plugin: pluginFor('masks', '#00CC88') })
    const helix = materialOf(el, 'skillvial-helix-material')
    expect(helix?.getAttribute('emissive')?.toLowerCase()).toBe('#00cc88')
  })
})

describe('SkillVial dimmed', () => {
  it('reduces helix emissive and glass opacity when dimmed', async () => {
    const lit = await mount({ plugin: pluginFor('orb') })
    expect(materialOf(lit, 'skillvial-helix-material')?.getAttribute('emissiveintensity')).toBe(
      '1.8'
    )
    expect(materialOf(lit, 'skillvial-glass-material')?.getAttribute('opacity')).toBe('0.28')

    await act(async () => {
      root?.unmount()
    })
    host?.remove()
    const dim = await mount({ plugin: pluginFor('orb'), dimmed: true })
    expect(materialOf(dim, 'skillvial-helix-material')?.getAttribute('emissiveintensity')).toBe(
      '0.25'
    )
    expect(materialOf(dim, 'skillvial-glass-material')?.getAttribute('opacity')).toBe('0.12')
  })
})
