/* eslint-disable react/no-unknown-property -- R3F three intrinsics (position, rotation, scale, args, geometry, material, …) that the DOM property allowlist cannot know. Scoped to this scene file only. */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Html, OrbitControls } from '@react-three/drei'
import { ZERO_TOKENS, ZERO_TYPE } from '../../../shared/tokens'
import {
  BREADBOARD,
  BREADBOARD_TOP_Y,
  DESK_OVERVIEW_BOUNDS,
  DESK_CENTER,
  DESK_LAYOUT,
  DESK_SIZE,
  FOCUS_TWEEN_MS,
  OVERVIEW_CAMERA,
  PERIPHERAL_FOOTPRINT,
  SCENE_FRAMELOOP,
  STAND_H,
  STAND_SIZE,
  TONE_HEX,
  breadboardDots,
  visibleDeskCables,
  buildJumperWires,
  easeInOutCubic,
  fitDeskCamera,
  focusCameraFor,
  focusReduce,
  isWebGL2Available,
  type DeskCable,
  type FocusState,
  type JumperWire,
  type SceneGraph,
  type SceneNode
} from './topology.model'
import Esp32DeskDisplay, { MODEL_FOOTPRINT as ESP32_FOOTPRINT } from './models/Esp32DeskDisplay'
import IPhone, { MODEL_FOOTPRINT as PHONE_FOOTPRINT } from './models/IPhone'
import Keyboard, { MODEL_FOOTPRINT as KEYBOARD_FOOTPRINT } from './models/Keyboard'
import MacBookAir, { MODEL_FOOTPRINT as LAPTOP_FOOTPRINT } from './models/MacBookAir'
import Monitor, { MODEL_FOOTPRINT as MONITOR_FOOTPRINT } from './models/Monitor'
import MousePad, { MODEL_FOOTPRINT as MOUSEPAD_FOOTPRINT } from './models/MousePad'

// This build targets WebGL2 (three r150+ renders WebGL2 only; the context
// creation throws when unavailable and the wrapper below renders the honest
// fallback instead). WebGPU via three's WebGPURenderer is a follow-up, not
// attempted here. Probe lives in topology.model.ts (pure module) so this
// file exports only the component.

// Baked contact shadow: a radial-gradient alpha blob on a plane under each
// device. Chosen over drei ContactShadows (which costs an extra depth render
// pass per frame) — this is one transparent quad per device, zero passes.
const BLOB_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const BLOB_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    float d = length(vUv - vec2(0.5));
    float a = smoothstep(0.5, 0.08, d) * 0.32;
    gl_FragColor = vec4(0.06, 0.045, 0.04, a);
  }
`

const INTRO_FROM = new THREE.Vector3(0, 4.6, 16.5)
const INTRO_SECONDS = 1.2

// Eases the camera from the wide establishing shot to the working position.
// Runs inside invalidated frames only (see Ticker); suppressed once a focus
// tween has ever taken over, and holds still otherwise at zero cost.
function CameraRig({
  suppressed,
  overview
}: {
  suppressed: boolean
  overview: typeof OVERVIEW_CAMERA
}): null {
  const camera = useThree((s) => s.camera)
  const invalidate = useThree((s) => s.invalidate)
  const start = useRef<number | null>(null)
  const introTo = useMemo(() => new THREE.Vector3(...overview.position), [overview])
  useEffect(() => invalidate(), [introTo, invalidate])
  useFrame(({ clock }) => {
    if (suppressed) return
    if (start.current === null) {
      start.current = clock.elapsedTime
      camera.position.copy(INTRO_FROM)
    }
    const t = Math.min(1, (clock.elapsedTime - (start.current ?? 0)) / INTRO_SECONDS)
    const eased = 1 - Math.pow(1 - t, 3)
    camera.position.lerpVectors(INTRO_FROM, introTo, eased)
    camera.lookAt(...overview.target)
  })
  return null
}

// Demand-mode pump: with frameloop="demand" nothing renders unless something
// invalidates. This ticks at ~4fps ONLY while the intro is running or a flow
// animates — and only while the tab is visible. The interval itself is ~free
// when idle: it returns without invalidating, so no frame renders. Cleared
// on unmount with the window lifecycle.
function Ticker({ animated }: { animated: boolean }): null {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    const startedAt = Date.now()
    const id = window.setInterval(() => {
      if (Date.now() - startedAt >= 1300 && !animated) return
      if (document.visibilityState !== 'visible') return
      invalidate()
    }, 250)
    return () => window.clearInterval(id)
  }, [animated, invalidate])
  return null
}

// Re-renders one frame when the typed data, the selection, or the focus
// changes.
function Invalidator({
  graph,
  selectedId,
  focusedId
}: {
  graph: SceneGraph
  selectedId: string | null
  focusedId: string | null
}): null {
  const invalidate = useThree((s) => s.invalidate)
  const seen = useRef(false)
  const sig = useRef({ graph, selectedId, focusedId })
  useEffect(() => {
    if (!seen.current) {
      seen.current = true
    } else if (
      sig.current.graph !== graph ||
      sig.current.selectedId !== selectedId ||
      sig.current.focusedId !== focusedId
    ) {
      invalidate()
    }
    sig.current = { graph, selectedId, focusedId }
  }, [graph, selectedId, focusedId, invalidate])
  return null
}

// Bounded camera tween for click-to-focus: eases position + controls target
// over FOCUS_TWEEN_MS, then stops. Frames are driven by a short-lived ~60fps
// interval that exists ONLY for the tween lifetime (frameloop="demand"
// stands); the tween restarts when viewKey changes and cancels on unmount.
type Flight = {
  fromPos: THREE.Vector3
  toPos: THREE.Vector3
  fromTg: THREE.Vector3
  toTg: THREE.Vector3
  t0: number
  interval: number | null
}

// Interval handles are cleared against the captured flight object, never by
// re-reading the ref: nulling the ref first must not strand the interval
// (a leaked 16ms invalidator would pin the renderer at 60fps forever).
function stopFlight(f: Flight | null): void {
  if (f?.interval !== null && f?.interval !== undefined) {
    window.clearInterval(f.interval)
    f.interval = null
  }
}

function FocusController({
  viewKey,
  view
}: {
  viewKey: string
  view: typeof OVERVIEW_CAMERA
}): null {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as {
    target: THREE.Vector3
    update: () => void
  } | null
  const invalidate = useThree((s) => s.invalidate)
  const viewRef = useRef(view)
  useEffect(() => {
    viewRef.current = view
  })
  const flight = useRef<Flight | null>(null)
  const mounted = useRef(false)
  useEffect(() => {
    // Mount renders the overview camera already (CameraRig owns the intro
    // sweep); only viewKey CHANGES fly.
    if (!mounted.current) {
      mounted.current = true
      return
    }
    const v = viewRef.current
    stopFlight(flight.current)
    const next: Flight = {
      fromPos: camera.position.clone(),
      toPos: new THREE.Vector3(v.position[0], v.position[1], v.position[2]),
      fromTg: controls?.target.clone() ?? new THREE.Vector3(0, 0.1, -0.2),
      toTg: new THREE.Vector3(v.target[0], v.target[1], v.target[2]),
      t0: performance.now(),
      interval: window.setInterval(() => invalidate(), 16)
    }
    flight.current = next
    return () => {
      stopFlight(next)
      if (flight.current === next) flight.current = null
    }
    // viewKey is the tween trigger; view itself rides viewRef so inline
    // object identity never restarts the flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey])
  useEffect(
    () => () => {
      stopFlight(flight.current)
      flight.current = null
    },
    []
  )
  useFrame(() => {
    const f = flight.current
    if (f === null) return
    const t = Math.min(1, (performance.now() - f.t0) / FOCUS_TWEEN_MS)
    const e = easeInOutCubic(t)
    camera.position.lerpVectors(f.fromPos, f.toPos, e)
    if (controls !== null && controls !== undefined) {
      controls.target.lerpVectors(f.fromTg, f.toTg, e)
      controls.update()
    } else {
      camera.lookAt(f.toTg)
    }
    if (t >= 1) {
      stopFlight(f)
      if (flight.current === f) flight.current = null
    }
  })
  return null
}

function SceneCameraControls({
  focused,
  focusNonce
}: {
  focused: SceneNode | null
  focusNonce: number
}): React.JSX.Element {
  const size = useThree((s) => s.size)
  const aspect = size.width > 0 && size.height > 0 ? size.width / size.height : 1
  const overview = useMemo(() => fitDeskCamera(DESK_OVERVIEW_BOUNDS, aspect), [aspect])
  const view = useMemo(
    () => (focused !== null ? focusCameraFor(focused.position, radiusFor(focused)) : overview),
    [focused, overview]
  )
  const viewKey = focused?.id ?? (focusNonce > 0 ? `__overview__:${aspect}` : '__overview__')
  const overviewDistance = Math.hypot(
    overview.position[0] - overview.target[0],
    overview.position[1] - overview.target[1],
    overview.position[2] - overview.target[2]
  )
  return (
    <>
      <CameraRig suppressed={focusNonce > 0} overview={overview} />
      <FocusController viewKey={viewKey} view={view} />
      <OrbitControls
        enableDamping
        dampingFactor={0.12}
        autoRotate={false}
        enablePan
        enableZoom
        enableRotate
        minDistance={3}
        maxDistance={Math.max(26, overviewDistance * 1.1)}
        maxPolarAngle={Math.PI / 2 - 0.06}
        makeDefault
      />
    </>
  )
}

// Desk furniture: wood-tone neutral surface (canvasTan token), legs, the
// slim laptop stand (furniture, not a device lane), and the white breadboard
// slab with its perforated-hole hint.
function DeskFurniture({ dots }: { dots: Array<[number, number]> }): React.JSX.Element {
  const dotRef = useRef<THREE.InstancedMesh | null>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  useLayoutEffect(() => {
    const m = dotRef.current
    if (m === null || typeof m.setMatrixAt !== 'function') return
    dots.forEach(([x, z], i) => {
      dummy.position.set(x, BREADBOARD_TOP_Y + 0.001, z)
      dummy.rotation.set(-Math.PI / 2, 0, 0)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
    })
    m.instanceMatrix.needsUpdate = true
  }, [dots, dummy])
  const legX = DESK_SIZE.w / 2 - 0.55
  return (
    <group>
      <mesh
        name="desk-surface"
        data-testid="desk-surface"
        position={[DESK_CENTER[0], DESK_CENTER[1], DESK_CENTER[2]]}
      >
        <boxGeometry args={[DESK_SIZE.w, DESK_SIZE.h, DESK_SIZE.d]} />
        <meshStandardMaterial color={ZERO_TOKENS.canvasTan} roughness={0.85} metalness={0} />
      </mesh>
      {(
        [
          [-legX, -3.4],
          [legX, -3.4],
          [-legX, 3.0],
          [legX, 3.0]
        ] as const
      ).map(([x, z], i) => (
        <mesh key={i} name={`desk-leg-${i}`} data-testid="desk-leg" position={[x, -1.15, z]}>
          <boxGeometry args={[0.3, 1.8, 0.3]} />
          <meshStandardMaterial color={ZERO_TOKENS.ink} roughness={0.6} metalness={0.3} />
        </mesh>
      ))}
      {/* slim laptop stand: thin top plate on two side rails */}
      <mesh
        name="laptop-stand-top"
        data-testid="laptop-stand"
        position={[DESK_LAYOUT.macbook[0], STAND_H - 0.03, DESK_LAYOUT.macbook[2]]}
      >
        <boxGeometry args={[STAND_SIZE.w, STAND_SIZE.h, STAND_SIZE.d]} />
        <meshStandardMaterial color={ZERO_TOKENS.ink} roughness={0.4} metalness={0.7} />
      </mesh>
      {[-1.25, 1.25].map((dx) => (
        <mesh
          key={dx}
          name="laptop-stand-rail"
          data-testid="laptop-stand"
          position={[DESK_LAYOUT.macbook[0] + dx, (STAND_H - 0.06) / 2, DESK_LAYOUT.macbook[2]]}
        >
          <boxGeometry args={[0.08, STAND_H - 0.06, STAND_SIZE.d - 0.2]} />
          <meshStandardMaterial color={ZERO_TOKENS.ink} roughness={0.4} metalness={0.7} />
        </mesh>
      ))}
      {/* white breadboard slab */}
      <mesh
        name="breadboard"
        data-testid="breadboard"
        position={[BREADBOARD.center[0], BREADBOARD.center[1], BREADBOARD.center[2]]}
      >
        <boxGeometry args={[BREADBOARD.w, BREADBOARD.h, BREADBOARD.d]} />
        <meshStandardMaterial color={ZERO_TOKENS.cardWhite} roughness={0.5} metalness={0} />
      </mesh>
      <group data-testid="breadboard-dots">
        <instancedMesh
          ref={dotRef}
          args={[undefined, undefined, dots.length]}
          frustumCulled={false}
        >
          <circleGeometry args={[0.024, 10]} />
          <meshBasicMaterial color={ZERO_TOKENS.ink} />
        </instancedMesh>
      </group>
    </group>
  )
}

// One physical cable: dark TubeGeometry along a CatmullRom curve through the
// layout-derived points. Geometry is memoized per cable and disposed with it.
function CableMesh({ cable }: { cable: DeskCable }): React.JSX.Element {
  const geom = useMemo(
    () =>
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(cable.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]))),
        48,
        cable.radius,
        8,
        false
      ),
    [cable]
  )
  useEffect(() => () => geom.dispose(), [geom])
  return (
    <mesh name={cable.id} data-testid={`cable-${cable.id}`} geometry={geom}>
      <meshStandardMaterial color={cable.color} roughness={0.6} metalness={0.2} />
    </mesh>
  )
}

// One colored jumper wire: thinner tube, token signal color, arched from an
// ESP32 pin side down to a breadboard hole.
function JumperMesh({ wire }: { wire: JumperWire }): React.JSX.Element {
  const geom = useMemo(
    () =>
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(wire.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]))),
        32,
        0.018,
        8,
        false
      ),
    [wire]
  )
  useEffect(() => () => geom.dispose(), [geom])
  return (
    <mesh name={wire.id} data-testid={wire.id} geometry={geom}>
      <meshStandardMaterial color={wire.color} roughness={0.5} metalness={0.1} />
    </mesh>
  )
}

const labelStyle: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 8,
  fontWeight: 700,
  letterSpacing: '0.06em',
  color: 'var(--z-ink)',
  background: 'var(--z-card-cream)',
  border: '1px solid var(--z-line)',
  borderRadius: 5,
  padding: '3px 7px',
  whiteSpace: 'nowrap'
}

const gatedStyle: React.CSSProperties = {
  ...labelStyle,
  color: 'var(--z-secondary-ink)'
}

const detailStyle: React.CSSProperties = {
  position: 'absolute',
  top: 10,
  right: 10,
  width: 218,
  background: 'var(--z-card-cream)',
  border: '1px solid var(--z-line)',
  borderRadius: 8,
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontFamily: ZERO_TYPE.mono
}

const detailName: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--z-ink)'
}

const detailRow: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--z-secondary-ink)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const backStyle: React.CSSProperties = {
  marginTop: 4,
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  color: 'var(--z-ink)',
  background: 'transparent',
  border: '1px solid var(--z-line)',
  borderRadius: 5,
  padding: '5px 8px',
  cursor: 'pointer'
}

function NodeLabel({ node, y }: { node: SceneNode; y: number }): React.JSX.Element {
  return (
    <group position={[0, y, 0]}>
      <Html center distanceFactor={9}>
        <div style={labelStyle}>
          {node.label} · {node.status}
        </div>
      </Html>
    </group>
  )
}

type ModelStatus = 'online' | 'suspect' | 'offline' | 'gated'

// The models light their own status LEDs from this prop; the tone still comes
// from daemon status via nodeTone in topology.model (never re-derived here).
const toModelStatus = (node: SceneNode): ModelStatus => {
  if (node.gated) return 'gated'
  switch (node.tone) {
    case 'healthy':
      return 'online'
    case 'attention':
      return 'suspect'
    case 'error':
      return 'offline'
    default:
      return node.status === 'OFFLINE' ? 'offline' : 'suspect'
  }
}

const FOOTPRINT_FOR: Record<SceneNode['kind'], { w: number; h: number; d: number }> = {
  macbook: LAPTOP_FOOTPRINT,
  monitor: MONITOR_FOOTPRINT,
  esp32: ESP32_FOOTPRINT,
  keyboard: KEYBOARD_FOOTPRINT,
  mousepad: MOUSEPAD_FOOTPRINT,
  phone: PHONE_FOOTPRINT,
  peripheral: PERIPHERAL_FOOTPRINT
}

// Label anchor above each model so the tag clears the tallest mesh.
const heightFor = (node: SceneNode): number => FOOTPRINT_FOR[node.kind].h

const radiusFor = (node: SceneNode): number => {
  const f = FOOTPRINT_FOR[node.kind]
  return Math.max(f.w, f.h, f.d) / 2
}

type MeshProps = {
  node: SceneNode
  selected: boolean
  hovered: boolean
  focused: boolean
  labelsHidden: boolean
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
  onFocus: (id: string) => void
}

// One small reused marker for every extra connected local device (audio
// interfaces, USB-serial adapters, BT peripherals): a dark puck with a
// tone-lit top disc + the device's real name as its label. Never a full
// model per device. Inner meshes use `name` only — the wrapping group owns
// the single data-testid (one data-* per R3F object).
function PeripheralPuck({ node }: { node: SceneNode }): React.JSX.Element {
  const glow = TONE_HEX[node.tone]
  return (
    <group>
      <mesh name={`puck-base-${node.id}`} position={[0, 0.06, 0]}>
        <cylinderGeometry args={[0.22, 0.25, 0.12, 24]} />
        <meshStandardMaterial color={ZERO_TOKENS.ink} roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh name={`puck-glow-${node.id}`} position={[0, 0.13, 0]}>
        <cylinderGeometry args={[0.14, 0.14, 0.02, 24]} />
        <meshStandardMaterial color={glow} emissive={glow} emissiveIntensity={0.8} />
      </mesh>
    </group>
  )
}

function SceneNodeMesh({
  node,
  selected,
  hovered,
  focused,
  labelsHidden,
  onHover,
  onSelect,
  onFocus
}: MeshProps): React.JSX.Element {
  const glow = TONE_HEX[node.tone]
  // Gated nodes own no click handler by construction: they can never emit a
  // semantic select (support lands later per owner direction).
  const click =
    node.selectable === false
      ? {}
      : {
          onClick: (e: ThreeEvent<MouseEvent>): void => {
            e.stopPropagation()
            onSelect(node.id)
            onFocus(node.id)
          }
        }
  const shared = {
    'data-testid': `node-${node.id}`,
    onPointerOver: (e: ThreeEvent<PointerEvent>): void => {
      e.stopPropagation()
      onHover(node.id)
    },
    onPointerOut: (): void => onHover(null),
    ...click
  }
  const status = toModelStatus(node)
  const top = heightFor(node)
  const ringR = Math.max(FOOTPRINT_FOR[node.kind].w, FOOTPRINT_FOR[node.kind].d) / 2 + 0.35
  return (
    <group position={node.position} scale={selected || focused || hovered ? 1.15 : 1} {...shared}>
      {node.kind === 'macbook' ? (
        <MacBookAir status={status} dimmed={node.dimmed} />
      ) : node.kind === 'monitor' ? (
        <Monitor status={status} dimmed={node.dimmed} />
      ) : node.kind === 'esp32' ? (
        <Esp32DeskDisplay status={status} dimmed={node.dimmed} />
      ) : node.kind === 'keyboard' ? (
        <Keyboard status={status} dimmed={node.dimmed} />
      ) : node.kind === 'mousepad' ? (
        <MousePad status={status} dimmed={node.dimmed} />
      ) : node.kind === 'peripheral' ? (
        <PeripheralPuck node={node} />
      ) : (
        <IPhone status={status} dimmed={node.dimmed} />
      )}
      {focused ? (
        <mesh
          data-testid={`focus-ring-${node.id}`}
          position={[0, 0.03, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <torusGeometry args={[ringR, 0.03, 8, 64]} />
          <meshStandardMaterial color={glow} emissive={glow} emissiveIntensity={0.9} />
        </mesh>
      ) : null}
      {node.gated ? (
        <group position={[0, top + 0.05, 0]}>
          <Html center distanceFactor={9}>
            <div style={gatedStyle}>GATED</div>
          </Html>
        </group>
      ) : null}
      {/* Per-node titles vanish in focus/close-up view (the focus detail
          panel carries the title); the GATED badge stays as status. */}
      {labelsHidden ? null : <NodeLabel node={node} y={node.gated ? top + 0.45 : top + 0.35} />}
    </group>
  )
}

const sceneWrap: React.CSSProperties = {
  position: 'relative',
  height: 'clamp(420px, 58vh, 680px)',
  flexShrink: 0,
  borderRadius: 10,
  overflow: 'hidden',
  background: 'var(--z-card-cream)',
  border: '1px solid var(--z-line)'
}

const vignetteStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  background: 'radial-gradient(ellipse at center, transparent 55%, rgba(92, 64, 56, 0.14) 100%)'
}

const captionStyle: React.CSSProperties = {
  position: 'absolute',
  left: 10,
  bottom: 8,
  fontFamily: ZERO_TYPE.mono,
  fontSize: 9,
  letterSpacing: '0.08em',
  color: 'var(--z-secondary-ink)',
  pointerEvents: 'none'
}

export type TopologySceneProps = {
  graph: SceneGraph
  selectedId: string | null
  onSelect: (id: string) => void
}

export const TopologyScene = memo(function TopologyScene({
  graph,
  selectedId,
  onSelect
}: TopologySceneProps): React.JSX.Element {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [focus, setFocus] = useState<FocusState>({ focusedId: null })
  const [focusNonce, setFocusNonce] = useState(0)
  const cables = useMemo(() => visibleDeskCables(graph), [graph])
  const jumpers = useMemo(() => buildJumperWires(), [])
  const dots = useMemo(() => breadboardDots(), [])
  const blobMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: BLOB_VERTEX,
        fragmentShader: BLOB_FRAGMENT,
        transparent: true,
        depthWrite: false
      }),
    []
  )
  useEffect(() => () => blobMat.dispose(), [blobMat])
  const available = useMemo(() => isWebGL2Available(), [])
  const hasGated = useMemo(() => graph.nodes.some((n) => n.gated), [graph])
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph])
  const isSelectable = useMemo(() => {
    const ids = new Set(graph.nodes.filter((n) => n.selectable).map((n) => n.id))
    return (id: string): boolean => ids.has(id)
  }, [graph])
  const focused = focus.focusedId !== null ? (byId.get(focus.focusedId) ?? null) : null
  // A focused node that left the snapshot releases focus instead of pointing
  // at stale data (same honesty rule as the list selection).
  const activeFocused = focused !== null && focused.selectable ? focused : null
  const exitFocus = (): void => {
    setFocus((s) => focusReduce(s, { type: 'empty' }, isSelectable))
  }
  const requestFocus = (id: string): void => {
    setFocus((s) => focusReduce(s, { type: 'focus', id }, isSelectable))
    setFocusNonce((n) => n + 1)
  }

  useEffect(() => {
    if (activeFocused === null) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') exitFocus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // isSelectable is graph-derived; exitFocus is stable logic.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFocused?.id])

  if (!available) {
    return (
      <div data-testid="topology-fallback" style={{ ...sceneWrap, height: 'auto', padding: 14 }}>
        <span style={captionStyle}>
          3D unavailable (no WebGL2) — the node list below is the source.
        </span>
      </div>
    )
  }
  const footprint = activeFocused !== null ? FOOTPRINT_FOR[activeFocused.kind] : null
  return (
    <div data-testid="topology-scene" style={sceneWrap}>
      <Canvas
        frameloop={SCENE_FRAMELOOP}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        camera={{
          position: [
            OVERVIEW_CAMERA.position[0],
            OVERVIEW_CAMERA.position[1],
            OVERVIEW_CAMERA.position[2]
          ],
          fov: 42
        }}
        onPointerMissed={() => exitFocus()}
      >
        <ambientLight intensity={0.85} />
        <directionalLight position={[4, 6, 6]} intensity={1.1} />
        <directionalLight position={[-5, 3, -2]} intensity={0.25} />
        <Ticker animated={false} />
        <Invalidator graph={graph} selectedId={selectedId} focusedId={focus.focusedId} />
        <SceneCameraControls focused={activeFocused} focusNonce={focusNonce} />
        <DeskFurniture dots={dots} />
        {cables.map((c) => (
          <CableMesh key={c.id} cable={c} />
        ))}
        {jumpers.map((w) => (
          <JumperMesh key={w.id} wire={w} />
        ))}
        {graph.nodes.map((n) => (
          <group key={`shadow-${n.id}`}>
            <mesh
              data-testid={`shadow-${n.id}`}
              position={[n.position[0], 0.006, n.position[2]]}
              rotation={[-Math.PI / 2, 0, 0]}
              material={blobMat}
            >
              <planeGeometry
                args={[FOOTPRINT_FOR[n.kind].w * 1.25, FOOTPRINT_FOR[n.kind].d * 1.25]}
              />
            </mesh>
            <SceneNodeMesh
              node={n}
              selected={selectedId === n.id}
              hovered={hoveredId === n.id}
              focused={activeFocused?.id === n.id}
              labelsHidden={activeFocused !== null}
              onHover={setHoveredId}
              onSelect={onSelect}
              onFocus={requestFocus}
            />
          </group>
        ))}
      </Canvas>
      <div style={vignetteStyle} />
      {activeFocused !== null && footprint !== null ? (
        <div data-testid="focus-detail" style={detailStyle}>
          <span style={detailName}>{activeFocused.label}</span>
          <span style={{ ...detailRow, color: TONE_HEX[activeFocused.tone] }}>
            ● {activeFocused.status}
          </span>
          <span style={detailRow}>NODE {activeFocused.sublabel}</span>
          <span style={detailRow}>KIND {activeFocused.kind.toUpperCase()}</span>
          <span style={detailRow}>
            SIZE {footprint.w.toFixed(1)} × {footprint.h.toFixed(1)} × {footprint.d.toFixed(1)}
          </span>
          <span style={detailRow}>
            CAPS {activeFocused.caps.length > 0 ? activeFocused.caps.join(' ') : '—'}
          </span>
          <span style={detailRow}>SEEN {activeFocused.lastSeen ?? '—'}</span>
          <button type="button" data-testid="focus-back" style={backStyle} onClick={exitFocus}>
            ← BACK TO OVERVIEW
          </button>
        </div>
      ) : null}
      <span style={captionStyle}>
        {hasGated
          ? '3D DESK SETUP · DRAG ORBIT · RIGHT-DRAG PAN · SCROLL ZOOM · IPHONE GATED'
          : '3D DESK SETUP · DRAG ORBIT · RIGHT-DRAG PAN · SCROLL ZOOM'}
      </span>
    </div>
  )
})
