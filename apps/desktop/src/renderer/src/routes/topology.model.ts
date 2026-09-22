import type { RuntimeConnState } from '../../../shared/protocol'
import type { DeviceInfo } from '../../../shared/ipc'
import { ZERO_TOKENS } from '../../../shared/tokens'
import { nodeTone, type CockpitNode, type Tone } from './runtime.types'
import { matchDeviceByKind } from './devices.model'

// Pinned render mode for the 3D scene: R3F renders one frame per
// invalidation (data change, camera move, focus tick) instead of spinning an
// always-on rAF loop. The scene component must pass this exact value to
// <Canvas frameloop> — the scene test pins the prop, this export pins the
// value (Task 18 idle-CPU bar stands).
export const SCENE_FRAMELOOP = 'demand' as const

// This build targets WebGL2 (three r150+ renders WebGL2 only; context
// creation throws when unavailable and the scene wrapper renders the honest
// fallback instead). WebGPU via three's WebGPURenderer is a follow-up, not
// attempted here.
export function isWebGL2Available(): boolean {
  try {
    if (typeof document === 'undefined') return false
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('webgl2')
    return ctx !== null && ctx !== undefined
  } catch {
    return false
  }
}

// Desk-scene device kinds. There is no hub/router kind: the owner killed the
// router design (Task 27f-3) and the green data-beam connectors with it —
// this scene is the owner's physical desk, not a network topology diagram.
export type SceneNodeKind =
  'macbook' | 'monitor' | 'esp32' | 'keyboard' | 'mousepad' | 'phone' | 'peripheral'

export type SceneNode = {
  id: string
  kind: SceneNodeKind
  label: string
  sublabel: string
  status: string
  tone: Tone
  gated: boolean
  dimmed: boolean
  selectable: boolean
  position: [number, number, number]
  caps: string[]
  lastSeen: string | null
}

// The desk scene has cables, not data beams: connectivity is physical
// (USB-C, keyboard/mouse leads, ESP32 power), so the graph carries no edges
// at all. The node list beneath the scene stays the honest enrolled source.
export type SceneGraph = {
  nodes: SceneNode[]
}

// Scene colors are the Stitch palette tokens (no new hues introduced). The
// jumper-wire set reuses the four signal tokens verbatim.
export const TONE_HEX: Record<Tone, string> = {
  neutral: ZERO_TOKENS.secondaryInk,
  healthy: ZERO_TOKENS.statusGreen,
  attention: ZERO_TOKENS.markerYellow,
  error: ZERO_TOKENS.errorRed
}

const DISPLAY_CAPS = ['display.render', 'display.clear']

const isIPhoneId = (id: string): boolean => /iphone|phone/i.test(id)

const hasDisplayCaps = (node: CockpitNode): boolean =>
  node.capabilities.some((c) => DISPLAY_CAPS.includes(c))

const kindFor = (node: CockpitNode): SceneNodeKind => {
  if (isIPhoneId(node.id)) return 'phone'
  if (node.id === 'desk-display-01') return 'esp32'
  if (hasDisplayCaps(node)) return 'monitor'
  return 'macbook'
}

const labelFor = (node: CockpitNode, kind: SceneNodeKind): string => {
  if (kind === 'phone') return 'iPhone'
  if (kind === 'esp32') return 'Desk Display · ESP32'
  // The local host owns the product label (HOST_LABEL); any other bare
  // enrolled node renders honestly under its own id.
  if (node.id === HOST_NODE_ID) return HOST_LABEL
  return node.id
}

// The local host is the runtime host running zerod + this app. It is never a
// row in the daemon's nodes table (queryList reads enrolled/display nodes
// only), so a snapshot-only mapping can never yield the MacBook on real
// data. The host therefore always renders as the MacBook Air beside its
// attached display.
export const HOST_NODE_ID = 'local-host'
export const HOST_LABEL = 'M4 MacBook Air'

// Static desk peripherals: owner hardware with no daemon node. They are
// always present, like the host, and carry no caps/last-seen.
export const KEYBOARD_NODE_ID = 'desk-keyboard'
export const MOUSEPAD_NODE_ID = 'desk-mousepad'

// Desk furniture geometry (scene units, desk top plane at y = 0).
export const DESK_TOP_Y = 0
export const DESK_SIZE = { w: 13.5, h: 0.25, d: 7.5 }
export const DESK_CENTER: [number, number, number] = [0, -0.125, -0.2]
// Slim laptop stand the MacBook rides on (furniture, owned by the scene).
export const STAND_H = 0.35
export const STAND_SIZE = { w: 2.7, h: 0.06, d: 1.9 }
// White breadboard slab the ESP32 sits on (front-left station).
export const BREADBOARD = {
  center: [-3.5, 0.06, 1.3] as [number, number, number],
  w: 1.8,
  h: 0.12,
  d: 1.3
}
export const BREADBOARD_TOP_Y = BREADBOARD.center[1] + BREADBOARD.h / 2

// Canonical desk placement, composed like the owner's photo (left→right:
// Dell monitor, ESP32-on-breadboard front-left, MacBook Air on its stand
// center, RGB keyboard front-center, mouse+pad right, iPhone gated aside).
// Pairwise footprint gaps were checked by hand; the model test re-pins the
// no-overlap + desk-bounds invariants so future moves stay honest.
export const DESK_LAYOUT = {
  monitor: [-3.7, 0, -2.3] as [number, number, number],
  macbook: [0.1, STAND_H, -1.1] as [number, number, number],
  esp32: [-3.9, BREADBOARD_TOP_Y, 1.0] as [number, number, number],
  keyboard: [0.1, 0, 1.55] as [number, number, number],
  mousepad: [3.7, 0, 1.15] as [number, number, number],
  phone: [5.7, 0, -1.6] as [number, number, number]
}

// Overflow row for enrolled devices beyond the first of their kind (not seen
// on real data; honest fallback so an unexpected node never hides).
const OVERFLOW_Z = -3.1
const OVERFLOW_X0 = -5.5
const OVERFLOW_DX = 1.4

// Cable-stub endpoints in each device's local frame, grounded in the lane
// sources: the keyboard helix ends at f=1 (x −1.03, y 0.30, z −0.515;
// Keyboard.tsx cableCurve), the mouse pigtail ends at its last curve point
// (MousePad.tsx cableCurve), USB-C hints live on the model edges
// (MacBookAir port-usbc, Monitor port-usbc, Esp32 usb).
export const KB_STUB_LOCAL: [number, number, number] = [-1.03, 0.3, -0.515]
export const MOUSE_STUB_LOCAL: [number, number, number] = [0.5, 0.07, -0.72]
export const MACBOOK_USB_LOCAL: [number, number, number] = [-1.505, 0.1, 0.3]
export const MONITOR_USB_LOCAL: [number, number, number] = [-0.2, 0.7, -0.125]
export const ESP32_USB_LOCAL: [number, number, number] = [0, 1.02, 0]

const add = (
  base: [number, number, number],
  local: [number, number, number]
): [number, number, number] => [base[0] + local[0], base[1] + local[1], base[2] + local[2]]

// World-space port anchors derived from the canonical layout (single source
// for the cable curves below and the endpoint tests).
export const MACBOOK_USB_WORLD = add(DESK_LAYOUT.macbook, MACBOOK_USB_LOCAL)
export const MONITOR_USB_WORLD = add(DESK_LAYOUT.monitor, MONITOR_USB_LOCAL)
export const ESP32_USB_WORLD = add(DESK_LAYOUT.esp32, ESP32_USB_LOCAL)
export const KB_STUB_WORLD = add(DESK_LAYOUT.keyboard, KB_STUB_LOCAL)
export const MOUSE_STUB_WORLD = add(DESK_LAYOUT.mousepad, MOUSE_STUB_LOCAL)

// Behind the MacBook: where loose cable ends rest on the desk.
const CABLE_REST_BEHIND_MAC: [number, number, number] = [-0.9, 0.12, -2.75]
const MOUSE_REST_BEHIND_MAC: [number, number, number] = [2.0, 0.1, -2.9]
const ESP32_TRAIL_END: [number, number, number] = [-3.4, 0.08, -3.4]

export type DeskCable = {
  id: string
  from: string
  fromAnchor: [number, number, number]
  to: string
  toAnchor: [number, number, number]
  points: [number, number, number][]
  color: string
  radius: number
}

// Physical desk cables: dark TubeGeometry paths, no glow. Each curve starts
// EXACTLY at its device port anchor; the tests pin endpoint proximity so a
// layout move cannot silently detach a cable.
export function buildDeskCables(): DeskCable[] {
  const dark = ZERO_TOKENS.ink
  return [
    {
      id: 'usb-c-macbook-monitor',
      from: HOST_NODE_ID,
      fromAnchor: MACBOOK_USB_WORLD,
      to: 'monitor',
      toAnchor: MONITOR_USB_WORLD,
      points: [MACBOOK_USB_WORLD, [-2.2, 0.12, -1.6], [-3.2, 0.15, -2.5], MONITOR_USB_WORLD],
      color: dark,
      radius: 0.022
    },
    {
      id: 'esp32-usb',
      from: 'desk-display-01',
      fromAnchor: ESP32_USB_WORLD,
      to: 'desk-back',
      toAnchor: ESP32_TRAIL_END,
      points: [ESP32_USB_WORLD, [-4.3, 0.6, -0.2], [-4.0, 0.12, -2.2], ESP32_TRAIL_END],
      color: dark,
      radius: 0.02
    },
    {
      id: 'keyboard-cable',
      from: KEYBOARD_NODE_ID,
      fromAnchor: KB_STUB_WORLD,
      to: 'behind-macbook',
      toAnchor: CABLE_REST_BEHIND_MAC,
      points: [KB_STUB_WORLD, [-1.5, 0.1, -0.2], [-1.3, 0.1, -1.8], CABLE_REST_BEHIND_MAC],
      color: dark,
      radius: 0.018
    },
    {
      id: 'mouse-cable',
      from: MOUSEPAD_NODE_ID,
      fromAnchor: MOUSE_STUB_WORLD,
      to: 'behind-macbook',
      toAnchor: MOUSE_REST_BEHIND_MAC,
      points: [MOUSE_STUB_WORLD, [4.6, 0.06, -0.8], [3.6, 0.08, -2.2], MOUSE_REST_BEHIND_MAC],
      color: dark,
      radius: 0.018
    }
  ]
}

export type JumperWire = {
  id: string
  points: [number, number, number][]
  color: string
}

// Colored jumper wires from the ESP32 pin sides to breadboard holes,
// echoing the owner's photo. Token signal colors only (no new hues).
export function buildJumperWires(): JumperWire[] {
  const arch = (
    sx: number,
    sz: number,
    mx: number,
    mz: number,
    ex: number,
    ez: number
  ): [number, number, number][] => [
    [sx, 0.45, sz],
    [mx, 0.62, mz],
    [ex, BREADBOARD_TOP_Y + 0.01, ez]
  ]
  return [
    {
      id: 'jumper-red',
      points: arch(-4.15, 0.85, -4.2, 1.3, -4.2, 1.7),
      color: ZERO_TOKENS.errorRed
    },
    {
      id: 'jumper-yellow',
      points: arch(-3.65, 0.85, -3.5, 1.2, -3.3, 1.65),
      color: ZERO_TOKENS.markerYellow
    },
    {
      id: 'jumper-blue',
      points: arch(-4.15, 1.15, -4.25, 1.5, -4.05, 1.8),
      color: ZERO_TOKENS.highlightBlue
    },
    {
      id: 'jumper-green',
      points: arch(-3.65, 1.15, -3.4, 1.45, -3.05, 1.8),
      color: ZERO_TOKENS.statusGreen
    }
  ]
}

export const BREADBOARD_DOT_CAP = 200

// Perforated-hole hint for the breadboard top: dark dots on the white slab,
// skipping the rect the ESP32 body covers. Capped well under 200 instances.
export function breadboardDots(): Array<[number, number]> {
  const dots: Array<[number, number]> = []
  const x0 = BREADBOARD.center[0] - BREADBOARD.w / 2 + 0.1
  const z0 = BREADBOARD.center[2] - BREADBOARD.d / 2 + 0.07
  for (let c = 0; c < 11; c += 1) {
    for (let r = 0; r < 10; r += 1) {
      const x = x0 + c * 0.16
      const z = z0 + r * 0.115
      // ESP32 body rect (footprint 0.9 × 0.5 at DESK_LAYOUT.esp32).
      if (x > -4.35 && x < -3.45 && z > 0.72 && z < 1.28) continue
      dots.push([x, z])
    }
  }
  return dots.slice(0, BREADBOARD_DOT_CAP)
}

// Small generic markers for connected local devices beyond the keyboard
// and mouse (audio interfaces, USB-serial adapters, BT peripherals): one
// reused puck, never a full model per device.
export const PERIPHERAL_FOOTPRINT = { w: 0.5, h: 0.18, d: 0.5 }
export const PERIPHERAL_MAX = 8
// Markers sit along the desk back edge, clear of the monitor station and
// the cable rest points behind the MacBook.
export const PERIPHERAL_ROW = { x0: -4.5, dx: 1.2, z: -3.35 }

export const peripheralPosition = (i: number): [number, number, number] => [
  PERIPHERAL_ROW.x0 + i * PERIPHERAL_ROW.dx,
  0,
  PERIPHERAL_ROW.z
]

export function buildSceneGraph(
  snapshotNodes: CockpitNode[],
  conn: RuntimeConnState,
  localDevices: DeviceInfo[] = []
): SceneGraph {
  // The list route stays the honest source: revoked registrations remain in
  // the list but leave the spatial scene (lifecycle evidence, not topology).
  const live = snapshotNodes.filter((n) => !n.revoked)
  const online = conn === 'live'

  const hostTone: Tone = nodeTone(conn, 'ONLINE')
  // The snapshot exposes no hostname (session carries id/project only), so
  // the host renders under the bare product label — no suffix plumbing.
  const host: SceneNode = {
    id: HOST_NODE_ID,
    kind: 'macbook',
    label: HOST_LABEL,
    sublabel: 'local runtime host',
    status: online ? 'ONLINE' : 'OFFLINE',
    tone: hostTone,
    gated: false,
    dimmed: hostTone === 'error',
    selectable: true,
    position: [...DESK_LAYOUT.macbook],
    caps: [],
    lastSeen: null
  }

  const seenKind = new Set<SceneNodeKind>(['macbook'])
  let overflow = 0
  const devices: SceneNode[] = live.map((n) => {
    const kind = kindFor(n)
    // iPhone support has not landed: the node renders dimmed with a GATED
    // badge, owns no cables, and emits no events until support ships.
    const gated = kind === 'phone'
    const status = gated ? 'GATED' : n.status
    const tone: Tone = gated ? 'neutral' : nodeTone(conn, n.status)
    let position: [number, number, number]
    if (gated) {
      position = [...DESK_LAYOUT.phone]
    } else if (!seenKind.has(kind)) {
      seenKind.add(kind)
      position =
        kind === 'monitor'
          ? [...DESK_LAYOUT.monitor]
          : kind === 'esp32'
            ? [...DESK_LAYOUT.esp32]
            : [...DESK_LAYOUT.macbook]
      // A second bare enrolled node is a guest Mac beside the host's
      // display; it takes the overflow row, never the host slot.
      if (kind === 'macbook') {
        position = [OVERFLOW_X0 + overflow * OVERFLOW_DX, 0, OVERFLOW_Z]
        overflow += 1
      }
    } else {
      position = [OVERFLOW_X0 + overflow * OVERFLOW_DX, 0, OVERFLOW_Z]
      overflow += 1
    }
    return {
      id: n.id,
      kind,
      label: labelFor(n, kind),
      sublabel: n.id,
      status,
      tone,
      gated,
      dimmed: gated || tone === 'error',
      selectable: !gated,
      position,
      caps: [...n.capabilities],
      lastSeen: n.last_seen
    }
  })

  // Desk peripherals mirror the runtime: lit while live, dark when the
  // daemon is unreachable. They are furniture, not nodes (no caps/seen).
  // The keyboard/mouse models take the REAL connected product names when a
  // matching local device exists (match by kind); otherwise the generic
  // labels stand — a name is never fabricated.
  const peripheralTone: Tone = online ? 'healthy' : 'error'
  const keyboardMatch = matchDeviceByKind(localDevices, 'keyboard')
  const mouseMatch = matchDeviceByKind(localDevices, 'mouse')
  const keyboard: SceneNode = {
    id: KEYBOARD_NODE_ID,
    kind: 'keyboard',
    label: keyboardMatch !== null ? keyboardMatch.name : 'RGB Keyboard',
    sublabel:
      keyboardMatch !== null
        ? `desk keyboard · ${keyboardMatch.transport}${keyboardMatch.vendor !== undefined ? ` · ${keyboardMatch.vendor}` : ''}`
        : 'desk peripheral · always present',
    status: online ? 'ONLINE' : 'OFFLINE',
    tone: peripheralTone,
    gated: false,
    dimmed: !online,
    selectable: true,
    position: [...DESK_LAYOUT.keyboard],
    caps: [],
    lastSeen: null
  }
  const mousepad: SceneNode = {
    id: MOUSEPAD_NODE_ID,
    kind: 'mousepad',
    label: mouseMatch !== null ? mouseMatch.name : 'Mouse + Desk Mat',
    sublabel:
      mouseMatch !== null
        ? `mouse + desk mat · ${mouseMatch.transport}${mouseMatch.vendor !== undefined ? ` · ${mouseMatch.vendor}` : ''}`
        : 'desk peripheral · always present',
    status: online ? 'ONLINE' : 'OFFLINE',
    tone: peripheralTone,
    gated: false,
    dimmed: !online,
    selectable: true,
    position: [...DESK_LAYOUT.mousepad],
    caps: [],
    lastSeen: null
  }

  // Every other connected local device becomes one small labelled puck on
  // the desk back edge (deterministic id order, capped). Gated-iPhone rule
  // unchanged: phones never become pucks.
  const matchedIds = new Set(
    [keyboardMatch?.id, mouseMatch?.id].filter((id): id is string => id !== undefined)
  )
  const extras = localDevices
    .filter((d) => !matchedIds.has(d.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, PERIPHERAL_MAX)
  const peripherals: SceneNode[] = extras.map((d, i) => ({
    id: `peripheral-${d.id}`,
    kind: 'peripheral',
    label: d.name,
    sublabel: `${d.transport} · ${d.vendor ?? d.kind}`,
    status: online ? 'ONLINE' : 'OFFLINE',
    tone: peripheralTone,
    gated: false,
    dimmed: !online,
    selectable: false,
    position: peripheralPosition(i),
    caps: [],
    lastSeen: null
  }))

  const hasPhone = devices.some((d) => d.kind === 'phone')
  const phone: SceneNode = hasPhone
    ? (devices.find((d) => d.kind === 'phone') as SceneNode)
    : {
        id: 'iphone-upcoming',
        kind: 'phone',
        label: 'iPhone',
        sublabel: 'upcoming · support later',
        status: 'GATED',
        tone: 'neutral' as Tone,
        gated: true,
        dimmed: true,
        selectable: false,
        position: [...DESK_LAYOUT.phone],
        caps: [],
        lastSeen: null
      }
  const rest = devices.filter((d) => d.kind !== 'phone')
  const physicalPlaceholders: SceneNode[] = (['monitor', 'esp32'] as const)
    .filter((kind) => !rest.some((node) => node.kind === kind))
    .map((kind) => ({
      id: kind === 'monitor' ? 'desk-monitor-unregistered' : 'desk-display-unregistered',
      kind,
      label: kind === 'monitor' ? 'Desk Monitor' : 'Desk Display · ESP32',
      sublabel: 'physical desk model · no enrolled node',
      status: 'UNREGISTERED',
      tone: 'neutral' as Tone,
      gated: false,
      dimmed: true,
      selectable: false,
      position: [...DESK_LAYOUT[kind]],
      caps: [],
      lastSeen: null
    }))
  // Canonical photo order left→right: monitor, ESP32, MacBook, keyboard,
  // mousepad, iPhone gated aside, peripheral markers along the back edge.
  const order: Record<SceneNodeKind, number> = {
    monitor: 0,
    esp32: 1,
    macbook: 2,
    keyboard: 3,
    mousepad: 4,
    phone: 5,
    peripheral: 6
  }
  const nodes = [
    host,
    ...rest.filter((d) => d.id !== HOST_NODE_ID),
    ...physicalPlaceholders,
    keyboard,
    mousepad,
    phone,
    ...peripherals
  ].sort((a, b) => order[a.kind] - order[b.kind] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { nodes }
}

// Click-to-focus state machine (pure; the scene component owns the React
// wrapper). Overview when focusedId is null; focusing a non-selectable
// (gated) node is a no-op; back/escape/empty-space all return to overview.
export type FocusState = { focusedId: string | null }

export type FocusEvent =
  { type: 'focus'; id: string } | { type: 'back' } | { type: 'escape' } | { type: 'empty' }

export function focusReduce(
  state: FocusState,
  event: FocusEvent,
  isSelectable: (id: string) => boolean
): FocusState {
  switch (event.type) {
    case 'focus':
      return isSelectable(event.id) ? { focusedId: event.id } : state
    case 'back':
    case 'escape':
    case 'empty':
      return state.focusedId === null ? state : { focusedId: null }
  }
}

// Bounded camera tween endpoints (~900ms, easeInOutCubic). Close-ups frame
// the device from front-above at a distance scaled by its bounding radius;
// the scene supplies the radius from MODEL_FOOTPRINT so this module stays
// free of three imports.
export const FOCUS_TWEEN_MS = 900

export const OVERVIEW_CAMERA = {
  position: [0, 3.6, 13.2] as [number, number, number],
  target: [0, 0.1, -0.2] as [number, number, number]
}

export type DeskBounds = {
  min: [number, number, number]
  max: [number, number, number]
}

// Furniture, devices and overview labels, with a small physical margin.
export const DESK_OVERVIEW_BOUNDS: DeskBounds = {
  min: [-7.4, -0.5, -4.0],
  max: [7.4, 3.4, 3.8]
}

export function fitDeskCamera(
  bounds: DeskBounds,
  aspect: number
): { position: [number, number, number]; target: [number, number, number] } {
  const target = OVERVIEW_CAMERA.target
  const dy = OVERVIEW_CAMERA.position[1] - target[1]
  const dz = OVERVIEW_CAMERA.position[2] - target[2]
  const len = Math.hypot(dy, dz)
  const upY = dz / len
  const upZ = -dy / len
  const forwardY = dy / len
  const forwardZ = dz / len
  const tanV = Math.tan((42 * Math.PI) / 360)
  const tanH = tanV * (aspect > 0 ? aspect : 1)
  let distance = 0
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const localY = (y - target[1]) * upY + (z - target[2]) * upZ
        const localZ = (y - target[1]) * forwardY + (z - target[2]) * forwardZ
        distance = Math.max(
          distance,
          localZ + Math.abs(x - target[0]) / tanH,
          localZ + Math.abs(localY) / tanV
        )
      }
    }
  }
  distance *= 1.12
  return {
    position: [target[0], target[1] + forwardY * distance, target[2] + forwardZ * distance],
    target
  }
}

export function easeInOutCubic(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

const FOCUS_DIR: [number, number, number] = [0.55, 0.42, 1]
const FOCUS_DIR_LEN = Math.sqrt(
  FOCUS_DIR[0] * FOCUS_DIR[0] + FOCUS_DIR[1] * FOCUS_DIR[1] + FOCUS_DIR[2] * FOCUS_DIR[2]
)

export function focusCameraFor(
  position: [number, number, number],
  radius: number
): { position: [number, number, number]; target: [number, number, number] } {
  const dist = Math.max(1.2, radius * 2.4 + 1.6)
  return {
    position: [
      position[0] + (FOCUS_DIR[0] / FOCUS_DIR_LEN) * dist,
      position[1] + (FOCUS_DIR[1] / FOCUS_DIR_LEN) * dist,
      position[2] + (FOCUS_DIR[2] / FOCUS_DIR_LEN) * dist
    ],
    target: [position[0], position[1] + radius * 0.4, position[2]]
  }
}
