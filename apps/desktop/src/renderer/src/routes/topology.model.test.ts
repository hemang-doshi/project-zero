// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { RuntimeConnState } from '../../../shared/protocol'
import { ZERO_TOKENS } from '../../../shared/tokens'
import { nodeTone } from './runtime.types'
import type { CockpitNode } from './runtime.types'
import {
  BREADBOARD,
  BREADBOARD_DOT_CAP,
  BREADBOARD_TOP_Y,
  DESK_CENTER,
  DESK_LAYOUT,
  DESK_SIZE,
  ESP32_USB_WORLD,
  HOST_LABEL,
  HOST_NODE_ID,
  KB_STUB_WORLD,
  KEYBOARD_NODE_ID,
  MACBOOK_USB_WORLD,
  MONITOR_USB_WORLD,
  MOUSEPAD_NODE_ID,
  MOUSE_STUB_WORLD,
  OVERVIEW_CAMERA,
  SCENE_FRAMELOOP,
  TONE_HEX,
  FOCUS_TWEEN_MS,
  breadboardDots,
  buildDeskCables,
  buildJumperWires,
  buildSceneGraph,
  easeInOutCubic,
  focusCameraFor,
  focusReduce
} from './topology.model'
import { MODEL_FOOTPRINT as ESP32_FOOTPRINT } from './models/Esp32DeskDisplay'
import { MODEL_FOOTPRINT as PHONE_FOOTPRINT } from './models/IPhone'
import { MODEL_FOOTPRINT as KEYBOARD_FOOTPRINT } from './models/Keyboard'
import { MODEL_FOOTPRINT as LAPTOP_FOOTPRINT } from './models/MacBookAir'
import { MODEL_FOOTPRINT as MONITOR_FOOTPRINT } from './models/Monitor'
import { MODEL_FOOTPRINT as MOUSEPAD_FOOTPRINT } from './models/MousePad'

const LIVE: RuntimeConnState = 'live'

const node = (over: Partial<CockpitNode> & { id: string }): CockpitNode => ({
  revoked: false,
  capabilities: [],
  last_seen: '2026-09-11T05:59:49.000Z',
  status: 'ONLINE',
  ...over
})

const dist = (a: [number, number, number], b: [number, number, number]): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

describe('desk scene graph', () => {
  it('carries no hub node and no edges: the desk has cables, not data beams', () => {
    const graph = buildSceneGraph(
      [
        node({ id: 'desk-display-01', capabilities: ['display.render', 'display.clear'] }),
        node({ id: 'work-mac', status: 'SUSPECT' })
      ],
      LIVE
    )
    expect(graph.nodes.every((n) => n.id !== 'zero')).toBe(true)
    expect(graph.nodes.every((n) => (n.kind as string) !== 'hub')).toBe(true)
    expect('edges' in graph).toBe(false)
  })

  it('labels desk-display-01 as ESP32 and other displays as monitor', () => {
    const graph = buildSceneGraph(
      [
        node({ id: 'desk-display-01', capabilities: ['display.render'] }),
        node({ id: 'desk-simulator', capabilities: ['display.render', 'display.clear'] })
      ],
      LIVE
    )
    const esp32 = graph.nodes.find((n) => n.id === 'desk-display-01')
    expect(esp32?.kind).toBe('esp32')
    expect(esp32?.label).toBe('Desk Display · ESP32')
    const monitor = graph.nodes.find((n) => n.id === 'desk-simulator')
    expect(monitor?.kind).toBe('monitor')
    expect(monitor?.label).toBe('desk-simulator')
  })

  it('respects MODEL_FOOTPRINT relative sizes', () => {
    expect(MONITOR_FOOTPRINT).toEqual({ w: 3.2, h: 2.6, d: 0.75 })
    expect(LAPTOP_FOOTPRINT).toEqual({ w: 3.0, h: 2.13, d: 2.5 })
    expect(ESP32_FOOTPRINT).toEqual({ w: 0.9, h: 1.1, d: 0.5 })
    expect(PHONE_FOOTPRINT).toEqual({ w: 0.78, h: 1.6, d: 0.13 })
    expect(KEYBOARD_FOOTPRINT).toEqual({ w: 2.8, h: 0.38, d: 1.16 })
    expect(MOUSEPAD_FOOTPRINT).toEqual({ w: 2.6, h: 0.5, d: 1.35 })
    expect(MONITOR_FOOTPRINT.h).toBeGreaterThan(LAPTOP_FOOTPRINT.h)
    expect(LAPTOP_FOOTPRINT.h).toBeGreaterThan(PHONE_FOOTPRINT.h)
    expect(PHONE_FOOTPRINT.h).toBeGreaterThan(ESP32_FOOTPRINT.h)
  })

  it('excludes revoked nodes from the scene while the list keeps them', () => {
    const graph = buildSceneGraph([node({ id: 'old-node', revoked: true })], LIVE)
    expect(graph.nodes.some((n) => n.id === 'old-node')).toBe(false)
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
  })

  it('gates a real snapshot iPhone node with no selection', () => {
    const graph = buildSceneGraph(
      [node({ id: 'owner-iphone', status: 'ONLINE' }), node({ id: 'desk-display-01' })],
      LIVE
    )
    const phone = graph.nodes.find((n) => n.id === 'owner-iphone')
    expect(phone?.gated).toBe(true)
    expect(phone?.status).toBe('GATED')
    expect(phone?.selectable).toBe(false)
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

  it('lays out deterministically in canonical photo order', () => {
    const input = [
      node({ id: 'desk-display-01', capabilities: ['display.render', 'display.clear'] }),
      node({ id: 'desk-simulator', capabilities: ['display.render', 'display.clear'] })
    ]
    const first = buildSceneGraph(input, LIVE)
    const second = buildSceneGraph(input, LIVE)
    expect(first).toEqual(second)
    expect(first.nodes.map((n) => n.kind)).toEqual([
      'monitor',
      'esp32',
      'macbook',
      'keyboard',
      'mousepad',
      'phone'
    ])
    expect(first.nodes.map((n) => n.id)).toEqual([
      'desk-simulator',
      'desk-display-01',
      'local-host',
      'desk-keyboard',
      'desk-mousepad',
      'iphone-upcoming'
    ])
  })

  it('maps tones to Stitch palette hex colors', () => {
    expect(TONE_HEX.healthy).toBe('#10B981')
    expect(TONE_HEX.attention).toBe('#F7DF94')
    expect(TONE_HEX.error).toBe('#DC2626')
  })

  it('pins render-on-demand so no always-on rAF loop exists', () => {
    expect(SCENE_FRAMELOOP).toBe('demand')
  })

  it('always renders the local host as the MacBook Air even with no Mac node', () => {
    // Evidence-first root cause: the daemon nodes table never enrolls the
    // local host (real fixture: desk-display-01 + desk-simulator only), so a
    // snapshot-only mapping can never yield kind macbook on real data.
    const graph = buildSceneGraph([], LIVE)
    const host = graph.nodes.find((n) => n.id === HOST_NODE_ID)
    expect(host?.kind).toBe('macbook')
    expect(host?.label).toBe(HOST_LABEL)
    expect(host?.selectable).toBe(true)
    expect(host?.gated).toBe(false)
    expect(host?.position).toEqual(DESK_LAYOUT.macbook)
  })

  it('labels the host with the bare product label (no hostname in the snapshot)', () => {
    // The snapshot exposes no hostname (session carries id/project only), so
    // there is no suffix plumbing: the host is always exactly HOST_LABEL.
    const graph = buildSceneGraph([], LIVE)
    expect(graph.nodes.find((n) => n.id === HOST_NODE_ID)?.label).toBe('M4 MacBook Air')
    expect(graph.nodes.find((n) => n.id === HOST_NODE_ID)?.label).toBe(HOST_LABEL)
  })

  it('maps the real fixture shape: host MacBook, monitor display, ESP32 display', () => {
    const graph = buildSceneGraph(
      [
        node({ id: 'desk-display-01', capabilities: ['display.render', 'display.clear'] }),
        node({
          id: 'desk-simulator',
          capabilities: ['display.render', 'display.clear'],
          status: 'OFFLINE'
        })
      ],
      LIVE
    )
    expect(graph.nodes.find((n) => n.id === HOST_NODE_ID)?.kind).toBe('macbook')
    expect(graph.nodes.find((n) => n.id === 'desk-simulator')?.kind).toBe('monitor')
    expect(graph.nodes.find((n) => n.id === 'desk-display-01')?.kind).toBe('esp32')
    expect(graph.nodes.find((n) => n.id === 'desk-simulator')?.position).toEqual(
      DESK_LAYOUT.monitor
    )
    expect(graph.nodes.find((n) => n.id === 'desk-display-01')?.position).toEqual(DESK_LAYOUT.esp32)
  })

  it('always seats the keyboard and mousepad peripherals with no snapshot rows', () => {
    const graph = buildSceneGraph([], LIVE)
    const kb = graph.nodes.find((n) => n.id === KEYBOARD_NODE_ID)
    const pad = graph.nodes.find((n) => n.id === MOUSEPAD_NODE_ID)
    expect(kb?.kind).toBe('keyboard')
    expect(kb?.position).toEqual(DESK_LAYOUT.keyboard)
    expect(kb?.selectable).toBe(true)
    expect(kb?.caps).toEqual([])
    expect(pad?.kind).toBe('mousepad')
    expect(pad?.position).toEqual(DESK_LAYOUT.mousepad)
    expect(pad?.selectable).toBe(true)
  })

  it('places stations with no footprint overlaps inside the desk bounds', () => {
    const graph = buildSceneGraph(
      [
        node({ id: 'desk-display-01', capabilities: ['display.render', 'display.clear'] }),
        node({ id: 'desk-simulator', capabilities: ['display.render', 'display.clear'] })
      ],
      LIVE
    )
    const widths: Record<string, { w: number; d: number; x: number; z: number }> = {}
    for (const n of graph.nodes) {
      if (n.gated) continue
      if (n.kind === 'esp32') {
        // The ESP32 rides ON the breadboard: the station rect is the slab.
        widths[n.id] = {
          w: BREADBOARD.w,
          d: BREADBOARD.d,
          x: BREADBOARD.center[0],
          z: BREADBOARD.center[2]
        }
        continue
      }
      const f =
        n.kind === 'macbook'
          ? LAPTOP_FOOTPRINT
          : n.kind === 'monitor'
            ? MONITOR_FOOTPRINT
            : n.kind === 'keyboard'
              ? KEYBOARD_FOOTPRINT
              : MOUSEPAD_FOOTPRINT
      widths[n.id] = { w: f.w, d: f.d, x: n.position[0], z: n.position[2] }
    }
    const ids = Object.keys(widths)
    // The gated iPhone sits aside: check it separately against desk bounds.
    const phone = graph.nodes.find((n) => n.kind === 'phone')
    expect(phone).toBeDefined()
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = widths[ids[i]]
        const b = widths[ids[j]]
        const overlapX =
          Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2)
        const overlapZ =
          Math.min(a.z + a.d / 2, b.z + b.d / 2) - Math.max(a.z - a.d / 2, b.z - b.d / 2)
        expect(overlapX > 0 && overlapZ > 0, `${ids[i]} vs ${ids[j]} overlap`).toBe(false)
      }
      const s = widths[ids[i]]
      expect(Math.abs(s.x - DESK_CENTER[0])).toBeLessThanOrEqual(DESK_SIZE.w / 2 - s.w / 2)
      expect(Math.abs(s.z - DESK_CENTER[2])).toBeLessThanOrEqual(DESK_SIZE.d / 2 - s.d / 2)
    }
    if (phone !== undefined) {
      expect(Math.abs(phone.position[0] - DESK_CENTER[0])).toBeLessThanOrEqual(
        DESK_SIZE.w / 2 - PHONE_FOOTPRINT.w / 2
      )
      // Aside means right of the mousepad station.
      const pad = graph.nodes.find((n) => n.id === MOUSEPAD_NODE_ID)
      expect(phone.position[0]).toBeGreaterThan(pad?.position[0] ?? 0)
    }
  })

  it('carries snapshot fields for the focus detail overlay', () => {
    const graph = buildSceneGraph(
      [
        node({
          id: 'desk-display-01',
          capabilities: ['display.render'],
          last_seen: '2026-09-11T05:59:49.000Z'
        })
      ],
      LIVE
    )
    const esp = graph.nodes.find((n) => n.id === 'desk-display-01')
    expect(esp?.caps).toEqual(['display.render'])
    expect(esp?.lastSeen).toBe('2026-09-11T05:59:49.000Z')
    expect(graph.nodes.find((n) => n.id === HOST_NODE_ID)?.caps).toEqual([])
  })
})

describe('desk cables', () => {
  it('routes the four physical cables with port-anchored endpoints', () => {
    const cables = buildDeskCables()
    expect(cables.map((c) => c.id).sort()).toEqual(
      ['esp32-usb', 'keyboard-cable', 'mouse-cable', 'usb-c-macbook-monitor'].sort()
    )
    const anchors: Record<string, [number, number, number]> = {
      'usb-c-macbook-monitor': MACBOOK_USB_WORLD,
      'esp32-usb': ESP32_USB_WORLD,
      'keyboard-cable': KB_STUB_WORLD,
      'mouse-cable': MOUSE_STUB_WORLD
    }
    for (const c of cables) {
      // Curve starts EXACTLY at the declared device port anchor...
      expect(dist(c.points[0], c.fromAnchor)).toBeLessThan(1e-9)
      expect(dist(c.points[0], anchors[c.id])).toBeLessThan(1e-9)
      // ...and ends exactly at the rest anchor.
      expect(dist(c.points[c.points.length - 1], c.toAnchor)).toBeLessThan(1e-9)
      expect(c.points.length).toBeGreaterThanOrEqual(3)
      expect(c.radius).toBeGreaterThan(0)
      // Physical, dark: the ink token, never a glow hue.
      expect(c.color).toBe(ZERO_TOKENS.ink)
    }
  })

  it('lands the USB-C run on the MacBook port and the monitor port', () => {
    const usb = buildDeskCables().find((c) => c.id === 'usb-c-macbook-monitor')
    expect(dist(MACBOOK_USB_WORLD, DESK_LAYOUT.macbook)).toBeLessThan(2.2)
    expect(dist(MONITOR_USB_WORLD, DESK_LAYOUT.monitor)).toBeLessThan(2.2)
    // Monitor end rises to the panel port height.
    expect(usb?.points[usb.points.length - 1][1]).toBeGreaterThan(0.5)
  })

  it('starts the peripheral cables at the lane cable stubs', () => {
    // Stub world anchors sit within one footprint unit of their device.
    expect(dist(KB_STUB_WORLD, DESK_LAYOUT.keyboard)).toBeLessThan(1.6)
    expect(dist(MOUSE_STUB_WORLD, DESK_LAYOUT.mousepad)).toBeLessThan(1.6)
    expect(dist(ESP32_USB_WORLD, DESK_LAYOUT.esp32)).toBeLessThan(1.4)
  })
})

describe('breadboard and jumpers', () => {
  it('dots the slab within bounds under the instance cap', () => {
    const dots = breadboardDots()
    expect(dots.length).toBeGreaterThan(0)
    expect(dots.length).toBeLessThanOrEqual(BREADBOARD_DOT_CAP)
    for (const [x, z] of dots) {
      expect(Math.abs(x - BREADBOARD.center[0])).toBeLessThanOrEqual(BREADBOARD.w / 2)
      expect(Math.abs(z - BREADBOARD.center[2])).toBeLessThanOrEqual(BREADBOARD.d / 2)
      // No dots under the ESP32 body.
      expect(x > -4.35 && x < -3.45 && z > 0.72 && z < 1.28).toBe(false)
    }
    expect(BREADBOARD_TOP_Y).toBeCloseTo(0.12)
  })

  it('arches four token-colored jumpers from ESP32 pins to the slab', () => {
    const wires = buildJumperWires()
    expect(wires.map((w) => w.id)).toEqual([
      'jumper-red',
      'jumper-yellow',
      'jumper-blue',
      'jumper-green'
    ])
    expect(wires.map((w) => w.color)).toEqual([
      ZERO_TOKENS.errorRed,
      ZERO_TOKENS.markerYellow,
      ZERO_TOKENS.highlightBlue,
      ZERO_TOKENS.statusGreen
    ])
    for (const w of wires) {
      const [s, , e] = w.points
      // Starts at pin height beside the ESP32 body...
      expect(s[1]).toBeCloseTo(0.45)
      expect(Math.hypot(s[0] - DESK_LAYOUT.esp32[0], s[2] - DESK_LAYOUT.esp32[2])).toBeLessThan(0.7)
      // ...ends flat on the slab inside its bounds.
      expect(e[1]).toBeCloseTo(BREADBOARD_TOP_Y + 0.01)
      expect(Math.abs(e[0] - BREADBOARD.center[0])).toBeLessThanOrEqual(BREADBOARD.w / 2)
      expect(Math.abs(e[2] - BREADBOARD.center[2])).toBeLessThanOrEqual(BREADBOARD.d / 2)
    }
  })
})

describe('topology focus state machine', () => {
  const selectable = (id: string): boolean => id !== 'iphone-upcoming'

  it('focuses a selectable device', () => {
    expect(
      focusReduce({ focusedId: null }, { type: 'focus', id: 'local-host' }, selectable)
    ).toEqual({
      focusedId: 'local-host'
    })
  })

  it('ignores focus on a gated node', () => {
    const s = { focusedId: null }
    expect(focusReduce(s, { type: 'focus', id: 'iphone-upcoming' }, selectable)).toBe(s)
  })

  it('returns to overview on back, escape, and empty-space', () => {
    const s = { focusedId: 'local-host' }
    expect(focusReduce(s, { type: 'back' }, selectable)).toEqual({ focusedId: null })
    expect(focusReduce(s, { type: 'escape' }, selectable)).toEqual({ focusedId: null })
    expect(focusReduce(s, { type: 'empty' }, selectable)).toEqual({ focusedId: null })
  })

  it('stays in overview when exiting from overview', () => {
    const s = { focusedId: null }
    expect(focusReduce(s, { type: 'back' }, selectable)).toBe(s)
  })

  it('switches focus directly between devices', () => {
    expect(focusReduce({ focusedId: 'a' }, { type: 'focus', id: 'b' }, () => true)).toEqual({
      focusedId: 'b'
    })
  })
})

describe('topology focus camera', () => {
  it('pins the bounded tween budget and desk overview endpoints', () => {
    expect(FOCUS_TWEEN_MS).toBe(900)
    expect(OVERVIEW_CAMERA.position).toEqual([0, 3.6, 13.2])
    expect(OVERVIEW_CAMERA.target).toEqual([0, 0.1, -0.2])
  })

  it('frames the device front-above with a footprint-scaled distance', () => {
    const near = focusCameraFor([2.6, 0.1, 0], 0.55)
    const far = focusCameraFor([2.6, 0.1, 0], 1.6)
    for (const v of [near, far]) {
      expect(v.target[0]).toBeCloseTo(2.6)
      expect(v.position[2]).toBeGreaterThan(0)
      expect(v.position[1]).toBeGreaterThan(v.target[1])
    }
    const nearDist = Math.hypot(near.position[0] - 2.6, near.position[1] - 0.1, near.position[2])
    const farDist = Math.hypot(far.position[0] - 2.6, far.position[1] - 0.1, far.position[2])
    expect(farDist).toBeGreaterThan(nearDist)
  })

  it('eases in-out cubic across the unit interval', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(1)).toBe(1)
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5)
    expect(easeInOutCubic(0.25)).toBeLessThan(0.25)
    expect(easeInOutCubic(0.75)).toBeGreaterThan(0.75)
  })
})
