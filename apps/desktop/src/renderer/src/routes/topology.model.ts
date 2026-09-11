import type { RuntimeConnState } from '../../../shared/protocol'
import { ZERO_TOKENS } from '../../../shared/tokens'
import { nodeTone, type CockpitNode, type Tone } from './runtime.types'

// Pinned render mode for the 3D scene: R3F renders one frame per
// invalidation (data change, camera move, flow tick) instead of spinning an
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

export const ZERO_HUB_ID = 'zero'

export type SceneNodeKind = 'hub' | 'macbook' | 'monitor' | 'esp32' | 'phone'

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
}

export type SceneEdge = {
  id: string
  from: string
  to: string
  tone: Tone
  animated: boolean
}

export type SceneGraph = {
  nodes: SceneNode[]
  edges: SceneEdge[]
}

// Scene colors are the Stitch palette tokens (no new hues introduced).
export const TONE_HEX: Record<Tone, string> = {
  neutral: ZERO_TOKENS.secondaryInk,
  healthy: ZERO_TOKENS.statusGreen,
  attention: ZERO_TOKENS.markerYellow,
  error: ZERO_TOKENS.errorRed
}

export const KIND_HEX: Record<SceneNodeKind, string> = {
  hub: ZERO_TOKENS.brandOrange,
  macbook: ZERO_TOKENS.ink,
  monitor: ZERO_TOKENS.highlightBlue,
  esp32: ZERO_TOKENS.statusGreen,
  phone: ZERO_TOKENS.secondaryInk
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
  if (kind === 'macbook') return 'M4 MacBook Air'
  if (kind === 'esp32') return 'Desk Display · ESP32'
  return node.id
}

const HUB_POSITION: [number, number, number] = [0, 0.9, 0]
// Wide enough that the laptop (3.0) and monitor (3.2) footprints never overlap.
const DEVICE_SPACING = 3.6

export function buildSceneGraph(snapshotNodes: CockpitNode[], conn: RuntimeConnState): SceneGraph {
  // The list route stays the honest source: revoked registrations remain in
  // the list but leave the spatial scene (lifecycle evidence, not topology).
  const live = snapshotNodes.filter((n) => !n.revoked)
  const hasPhone = live.some((n) => isIPhoneId(n.id))

  const devices: SceneNode[] = live.map((n) => {
    const kind = kindFor(n)
    // iPhone support has not landed: the node renders dimmed with a GATED
    // badge, owns no edges, and emits no events until support ships.
    const gated = kind === 'phone'
    const status = gated ? 'GATED' : n.status
    const tone: Tone = gated ? 'neutral' : nodeTone(conn, n.status)
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
      position: [0, 0, 0]
    }
  })
  if (!hasPhone) {
    devices.push({
      id: 'iphone-upcoming',
      kind: 'phone',
      label: 'iPhone',
      sublabel: 'upcoming · support later',
      status: 'GATED',
      tone: 'neutral',
      gated: true,
      dimmed: true,
      selectable: false,
      position: [0, 0, 0]
    })
  }

  // Slot devices along x with the hub centered above. When the middle slot
  // would hold a live device it shifts half a slot so no live node hides
  // under the hub glyph; the gated back row keeps its own slot.
  const nonHub = devices.length
  const middleIsLive = nonHub % 2 === 1 && devices[Math.floor(nonHub / 2)]?.gated !== true
  devices.forEach((d, i) => {
    let slot = i - (nonHub - 1) / 2
    if (!d.gated && middleIsLive) slot += 0.5
    d.position = [slot * DEVICE_SPACING, d.gated ? -0.9 : 0.1, d.gated ? -1.2 : 0]
  })

  const nodes: SceneNode[] = [
    {
      id: ZERO_HUB_ID,
      kind: 'hub',
      label: 'Zero',
      sublabel: 'daemon runtime authority',
      status: 'ONLINE',
      tone: conn === 'live' ? 'healthy' : 'neutral',
      gated: false,
      dimmed: false,
      selectable: false,
      position: HUB_POSITION
    },
    ...devices
  ]
  const edges: SceneEdge[] = devices
    .filter((d) => !d.gated)
    .map((d) => ({
      id: `${d.id}→${ZERO_HUB_ID}`,
      from: d.id,
      to: ZERO_HUB_ID,
      tone: d.tone,
      animated: d.tone === 'healthy'
    }))
  return { nodes, edges }
}
