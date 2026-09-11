// @vitest-environment jsdom
import { act } from 'react'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCockpit } from '../store/cockpit'
import { NetworkRoute } from './NetworkRoute'
import type { SceneGraph } from './topology.model'
import fixtureJson from './fixtures/cockpit.json'

const sceneProps: { current: { graph: SceneGraph; selectedId: string | null } | null } = {
  current: null
}

vi.mock('./TopologyScene', () => ({
  TopologyScene: (props: {
    graph: SceneGraph
    selectedId: string | null
    onSelect: (id: string) => void
  }): unknown => {
    sceneProps.current = { graph: props.graph, selectedId: props.selectedId }
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

  it('feeds the scene hub edges plus the gated iPhone from typed snapshot nodes', async () => {
    await mount()
    const graph = sceneProps.current?.graph
    expect(graph?.nodes.some((n) => n.id === 'zero')).toBe(true)
    expect(graph?.edges.some((e) => e.from === 'desk-display-01' && e.to === 'zero')).toBe(true)
    const phone = graph?.nodes.find((n) => n.kind === 'phone')
    expect(phone?.status).toBe('GATED')
    expect(phone?.selectable).toBe(false)
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
})
