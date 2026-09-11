// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { RuntimeConnState } from '../../../shared/protocol'
import { nodeTone } from './runtime.types'
import type { CockpitNode } from './runtime.types'
import { buildSceneGraph, SCENE_FRAMELOOP, TONE_HEX, ZERO_HUB_ID } from './topology.model'
import { MODEL_FOOTPRINT as ESP32_FOOTPRINT } from './models/Esp32DeskDisplay'
import { MODEL_FOOTPRINT as PHONE_FOOTPRINT } from './models/IPhone'
import { MODEL_FOOTPRINT as LAPTOP_FOOTPRINT } from './models/MacBookAir'
import { MODEL_FOOTPRINT as MONITOR_FOOTPRINT } from './models/Monitor'

const LIVE: RuntimeConnState = 'live'

const node = (over: Partial<CockpitNode> & { id: string }): CockpitNode => ({
  revoked: false,
  capabilities: [],
  last_seen: '2026-09-11T05:59:49.000Z',
  status: 'ONLINE',
  ...over
})

describe('topology.model scene graph', () => {
  it('maps snapshot nodes to hub edges from each live node to Zero', () => {
    const graph = buildSceneGraph(
      [
        node({ id: 'desk-display-01', capabilities: ['display.render', 'display.clear'] }),
        node({ id: 'work-mac', status: 'SUSPECT' })
      ],
      LIVE
    )
    const hub = graph.nodes.find((n) => n.id === ZERO_HUB_ID)
    expect(hub?.label).toBe('Zero')
    const edgeTargets = new Set(graph.edges.map((e) => `${e.from}→${e.to}`))
    expect(edgeTargets.has('desk-display-01→zero')).toBe(true)
    expect(edgeTargets.has('work-mac→zero')).toBe(true)
  })

  it('labels the Mac node M4 MacBook Air, desk-display-01 as ESP32, other displays as monitor', () => {
    const graph = buildSceneGraph(
      [
        node({ id: 'desk-display-01', capabilities: ['display.render'] }),
        node({ id: 'desk-simulator', capabilities: ['display.render', 'display.clear'] }),
        node({ id: 'work-mac' })
      ],
      LIVE
    )
    const mac = graph.nodes.find((n) => n.id === 'work-mac')
    expect(mac?.kind).toBe('macbook')
    expect(mac?.label).toBe('M4 MacBook Air')
    const esp32 = graph.nodes.find((n) => n.id === 'desk-display-01')
    expect(esp32?.kind).toBe('esp32')
    expect(esp32?.label).toBe('Desk Display · ESP32')
    const monitor = graph.nodes.find((n) => n.id === 'desk-simulator')
    expect(monitor?.kind).toBe('monitor')
    expect(monitor?.label).toBe('desk-simulator')
  })

  it('respects MODEL_FOOTPRINT relative sizes (monitor > laptop > phone > esp32 heights)', () => {
    expect(MONITOR_FOOTPRINT).toEqual({ w: 3.2, h: 2.6, d: 0.75 })
    expect(LAPTOP_FOOTPRINT).toEqual({ w: 3.0, h: 2.13, d: 2.5 })
    expect(ESP32_FOOTPRINT).toEqual({ w: 0.9, h: 1.1, d: 0.5 })
    expect(PHONE_FOOTPRINT).toEqual({ w: 0.78, h: 1.6, d: 0.13 })
    expect(MONITOR_FOOTPRINT.h).toBeGreaterThan(LAPTOP_FOOTPRINT.h)
    expect(LAPTOP_FOOTPRINT.h).toBeGreaterThan(PHONE_FOOTPRINT.h)
    expect(PHONE_FOOTPRINT.h).toBeGreaterThan(ESP32_FOOTPRINT.h)
  })

  it('draws one hub edge per live non-gated node with status tones', () => {
    const graph = buildSceneGraph(
      [
        node({ id: 'up', status: 'ONLINE' }),
        node({ id: 'stale', status: 'SUSPECT' }),
        node({ id: 'down', status: 'OFFLINE' }),
        node({ id: 'owner-iphone', status: 'ONLINE' })
      ],
      LIVE
    )
    expect(graph.edges.map((e) => e.from).sort()).toEqual(['down', 'stale', 'up'])
    expect(graph.edges.every((e) => e.to === ZERO_HUB_ID)).toBe(true)
    expect(graph.edges.find((e) => e.from === 'up')?.tone).toBe('healthy')
    expect(graph.edges.find((e) => e.from === 'stale')?.tone).toBe('attention')
    expect(graph.edges.find((e) => e.from === 'down')?.tone).toBe('error')
  })

  it('excludes revoked nodes from the scene while the list keeps them', () => {
    const graph = buildSceneGraph([node({ id: 'old-node', revoked: true })], LIVE)
    expect(graph.nodes.some((n) => n.id === 'old-node')).toBe(false)
    expect(graph.edges.some((e) => e.from === 'old-node')).toBe(false)
  })

  it('appends a synthetic gated iPhone when the snapshot has none', () => {
    const graph = buildSceneGraph([node({ id: 'desk-display-01' })], LIVE)
    const phone = graph.nodes.find((n) => n.kind === 'phone')
    expect(phone?.id).toBe('iphone-upcoming')
    expect(phone?.label).toBe('iPhone')
    expect(phone?.status).toBe('GATED')
    expect(phone?.gated).toBe(true)
    expect(phone?.selectable).toBe(false)
    expect(phone?.dimmed).toBe(true)
    expect(graph.edges.some((e) => e.from === phone?.id)).toBe(false)
  })

  it('gates a real snapshot iPhone node with no edges and no selection', () => {
    const graph = buildSceneGraph(
      [node({ id: 'owner-iphone', status: 'ONLINE' }), node({ id: 'desk-display-01' })],
      LIVE
    )
    const phone = graph.nodes.find((n) => n.id === 'owner-iphone')
    expect(phone?.gated).toBe(true)
    expect(phone?.status).toBe('GATED')
    expect(phone?.selectable).toBe(false)
    expect(graph.edges.some((e) => e.from === 'owner-iphone')).toBe(false)
    expect(graph.nodes.filter((n) => n.kind === 'phone')).toHaveLength(1)
  })

  it('derives tones by reusing nodeTone for every status', () => {
    const statuses = ['ONLINE', 'SUSPECT', 'OFFLINE', 'PAIRED'] as const
    const graph = buildSceneGraph(
      statuses.map((status, i) => node({ id: `n-${i}`, status })),
      LIVE
    )
    for (let i = 0; i < statuses.length; i += 1) {
      const scene = graph.nodes.find((n) => n.id === `n-${i}`)
      expect(scene?.tone).toBe(nodeTone(LIVE, statuses[i]))
    }
  })

  it('dims gated and offline nodes but not online or suspect ones', () => {
    const graph = buildSceneGraph(
      [
        node({ id: 'up', status: 'ONLINE' }),
        node({ id: 'stale', status: 'SUSPECT' }),
        node({ id: 'down', status: 'OFFLINE' })
      ],
      LIVE
    )
    expect(graph.nodes.find((n) => n.id === 'up')?.dimmed).toBe(false)
    expect(graph.nodes.find((n) => n.id === 'stale')?.dimmed).toBe(false)
    expect(graph.nodes.find((n) => n.id === 'down')?.dimmed).toBe(true)
    expect(graph.nodes.find((n) => n.kind === 'phone')?.dimmed).toBe(true)
  })

  it('animates flow only along healthy online edges', () => {
    const graph = buildSceneGraph(
      [node({ id: 'up', status: 'ONLINE' }), node({ id: 'stale', status: 'SUSPECT' })],
      LIVE
    )
    expect(graph.edges.find((e) => e.from === 'up')?.animated).toBe(true)
    expect(graph.edges.find((e) => e.from === 'stale')?.animated).toBe(false)
  })

  it('lays out deterministically with the hub centered and gated nodes behind', () => {
    const first = buildSceneGraph([node({ id: 'a' }), node({ id: 'b' })], LIVE)
    const second = buildSceneGraph([node({ id: 'a' }), node({ id: 'b' })], LIVE)
    expect(first).toEqual(second)
    const hub = first.nodes.find((n) => n.id === ZERO_HUB_ID)
    expect(hub?.position[0]).toBe(0)
    const phone = first.nodes.find((n) => n.kind === 'phone')
    expect(phone !== undefined && phone.position[2] < 0).toBe(true)
  })

  it('maps tones to Stitch palette hex colors', () => {
    expect(TONE_HEX.healthy).toBe('#10B981')
    expect(TONE_HEX.attention).toBe('#F7DF94')
    expect(TONE_HEX.error).toBe('#DC2626')
  })

  it('pins render-on-demand so no always-on rAF loop exists', () => {
    expect(SCENE_FRAMELOOP).toBe('demand')
  })
})
