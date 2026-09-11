import { memo, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Html, OrbitControls } from '@react-three/drei'
import { ZERO_TYPE } from '../../../shared/tokens'
import {
  KIND_HEX,
  SCENE_FRAMELOOP,
  TONE_HEX,
  ZERO_HUB_ID,
  isWebGL2Available,
  type SceneGraph,
  type SceneNode
} from './topology.model'
import Esp32DeskDisplay, { MODEL_FOOTPRINT as ESP32_FOOTPRINT } from './models/Esp32DeskDisplay'
import IPhone, { MODEL_FOOTPRINT as PHONE_FOOTPRINT } from './models/IPhone'
import MacBookAir, { MODEL_FOOTPRINT as LAPTOP_FOOTPRINT } from './models/MacBookAir'
import Monitor, { MODEL_FOOTPRINT as MONITOR_FOOTPRINT } from './models/Monitor'

// This build targets WebGL2 (three r150+ renders WebGL2 only; the context
// creation throws when unavailable and the wrapper below renders the honest
// fallback instead). WebGPU via three's WebGPURenderer is a follow-up, not
// attempted here. Probe lives in topology.model.ts (pure module) so this
// file exports only the component.

const EDGE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// Shader-driven flow: the pulse position comes from the uTime uniform, which
// FlowField advances in useFrame by mutating the uniform only — no React
// state moves per frame. Static edges render as a constant dim line.
const EDGE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uAnimated;
  varying vec2 vUv;
  void main() {
    float alpha = 0.55;
    if (uAnimated > 0.5) {
      float pulse = fract(vUv.y * 2.0 - uTime * 0.35);
      float band = smoothstep(0.0, 0.12, pulse) * (1.0 - smoothstep(0.12, 0.5, pulse));
      alpha = 0.35 + 0.65 * band;
    }
    gl_FragColor = vec4(uColor, alpha);
  }
`

const INTRO_FROM = new THREE.Vector3(0, 3.4, 12.5)
const INTRO_TO = new THREE.Vector3(0, 1.6, 8.5)
const INTRO_SECONDS = 1.2

// Eases the camera from the wide establishing shot to the working position.
// Runs inside invalidated frames only (see Ticker); after the intro it holds
// still and costs nothing.
function CameraRig(): null {
  const camera = useThree((s) => s.camera)
  const start = useRef<number | null>(null)
  useFrame(({ clock }) => {
    if (start.current === null) {
      start.current = clock.elapsedTime
      camera.position.copy(INTRO_FROM)
    }
    const t = Math.min(1, (clock.elapsedTime - (start.current ?? 0)) / INTRO_SECONDS)
    const eased = 1 - Math.pow(1 - t, 3)
    camera.position.lerpVectors(INTRO_FROM, INTRO_TO, eased)
    camera.lookAt(0, 0.3, 0)
  })
  return null
}

// Demand-mode pump: with frameloop="demand" nothing renders unless something
// invalidates. This ticks at ~4fps ONLY while the intro is running or an
// online edge animates (and the tab is visible); offline/gated-only scenes
// render strictly on data change or user drag. Cleared on unmount with the
// window lifecycle.
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

// Re-renders one frame when the typed data or the selection changes.
function Invalidator({
  graph,
  selectedId
}: {
  graph: SceneGraph
  selectedId: string | null
}): null {
  const invalidate = useThree((s) => s.invalidate)
  const seen = useRef(false)
  const graphRef = useRef(graph)
  const selectedRef = useRef(selectedId)
  useEffect(() => {
    if (!seen.current) {
      seen.current = true
    } else if (graphRef.current !== graph || selectedRef.current !== selectedId) {
      invalidate()
    }
    graphRef.current = graph
    selectedRef.current = selectedId
  }, [graph, selectedId, invalidate])
  return null
}

const edgePlacement = (
  from: SceneNode['position'],
  to: SceneNode['position']
): { mid: [number, number, number]; quaternion: THREE.Quaternion; length: number } => {
  const a = new THREE.Vector3(...from)
  const b = new THREE.Vector3(...to)
  const dir = b.clone().sub(a)
  const length = Math.max(0.001, dir.length())
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.normalize()
  )
  const mid = a.add(b).multiplyScalar(0.5)
  return { mid: [mid.x, mid.y, mid.z], quaternion, length }
}

function FlowEdges({ graph }: { graph: SceneGraph }): React.JSX.Element {
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph])
  const hub = byId.get(ZERO_HUB_ID)
  const items = useMemo(
    () =>
      hub === undefined
        ? []
        : graph.edges.flatMap((edge) => {
            const node = byId.get(edge.from)
            if (node === undefined) return []
            return [{ edge, ...edgePlacement(node.position, hub.position) }]
          }),
    [graph, byId, hub]
  )
  const geometry = useMemo(() => new THREE.CylinderGeometry(0.025, 0.025, 1, 8), [])
  // The shader pulse is imperative GL-side state (uniforms), owned by this
  // memoized handle behind advance()/dispose(). React state never moves per
  // frame; useFrame only calls the handle.
  const flow = useMemo(() => {
    const mats = items.map(
      ({ edge }) =>
        new THREE.ShaderMaterial({
          uniforms: {
            uColor: { value: new THREE.Color(TONE_HEX[edge.tone]) },
            uTime: { value: 0 },
            uAnimated: { value: edge.animated ? 1 : 0 }
          },
          vertexShader: EDGE_VERTEX,
          fragmentShader: EDGE_FRAGMENT,
          transparent: true,
          depthWrite: false
        })
    )
    return {
      materials: mats,
      advance: (delta: number): void => {
        for (const m of mats) {
          const u = m.uniforms.uTime as THREE.IUniform<number>
          u.value += delta
        }
      },
      dispose: (): void => {
        for (const m of mats) m.dispose()
      }
    }
  }, [items])
  useEffect(
    () => () => {
      geometry.dispose()
      flow.dispose()
    },
    [geometry, flow]
  )
  useFrame((_, delta) => {
    flow.advance(delta)
  })
  return (
    <group>
      {items.map(({ edge, mid, quaternion, length }, i) => (
        <mesh
          key={edge.id}
          data-testid={`edge-${edge.id}`}
          position={mid}
          quaternion={quaternion}
          scale={[1, length, 1]}
          geometry={geometry}
          material={flow.materials[i]}
        />
      ))}
    </group>
  )
}

const labelStyle: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10,
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

// Label anchor above each model so the tag clears the tallest mesh.
const heightFor = (node: SceneNode): number => {
  switch (node.kind) {
    case 'hub':
      return 1.1
    case 'macbook':
      return LAPTOP_FOOTPRINT.h
    case 'monitor':
      return MONITOR_FOOTPRINT.h
    case 'esp32':
      return ESP32_FOOTPRINT.h
    case 'phone':
      return PHONE_FOOTPRINT.h
  }
}

type MeshProps = {
  node: SceneNode
  selected: boolean
  hovered: boolean
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
}

function SceneNodeMesh({
  node,
  selected,
  hovered,
  onHover,
  onSelect
}: MeshProps): React.JSX.Element {
  const glow = TONE_HEX[node.tone]
  const emissiveIntensity = selected || hovered ? 0.9 : node.dimmed ? 0.05 : 0.35
  const opacity = node.dimmed ? 0.35 : 1
  // Gated nodes own no click handler by construction: they can never emit a
  // semantic select (support lands later per owner direction).
  const click =
    node.selectable === false
      ? {}
      : {
          onClick: (e: ThreeEvent<MouseEvent>): void => {
            e.stopPropagation()
            onSelect(node.id)
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
  return (
    <group position={node.position} scale={selected ? 1.15 : 1} {...shared}>
      {node.kind === 'hub' ? (
        <mesh>
          <sphereGeometry args={[0.55, 32, 32]} />
          <meshStandardMaterial
            color={KIND_HEX.hub}
            emissive={glow}
            emissiveIntensity={emissiveIntensity}
            transparent={node.dimmed}
            opacity={opacity}
          />
        </mesh>
      ) : node.kind === 'macbook' ? (
        <MacBookAir status={status} dimmed={node.dimmed} />
      ) : node.kind === 'monitor' ? (
        <Monitor status={status} dimmed={node.dimmed} />
      ) : node.kind === 'esp32' ? (
        <Esp32DeskDisplay status={status} dimmed={node.dimmed} />
      ) : (
        <IPhone status={status} dimmed={node.dimmed} />
      )}
      {node.gated ? (
        <group position={[0, top + 0.05, 0]}>
          <Html center distanceFactor={9}>
            <div style={gatedStyle}>GATED</div>
          </Html>
        </group>
      ) : null}
      <NodeLabel node={node} y={node.gated ? top + 0.45 : top + 0.35} />
    </group>
  )
}

const sceneWrap: React.CSSProperties = {
  position: 'relative',
  height: 300,
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
  const available = useMemo(() => isWebGL2Available(), [])
  const animated = useMemo(() => graph.edges.some((e) => e.animated), [graph])
  const hasGated = useMemo(() => graph.nodes.some((n) => n.gated), [graph])
  if (!available) {
    return (
      <div data-testid="topology-fallback" style={{ ...sceneWrap, height: 'auto', padding: 14 }}>
        <span style={captionStyle}>
          3D unavailable (no WebGL2) — the node list below is the source.
        </span>
      </div>
    )
  }
  return (
    <div data-testid="topology-scene" style={sceneWrap}>
      <Canvas
        frameloop={SCENE_FRAMELOOP}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        camera={{ position: [INTRO_FROM.x, INTRO_FROM.y, INTRO_FROM.z], fov: 42 }}
      >
        <ambientLight intensity={0.9} />
        <directionalLight position={[4, 6, 6]} intensity={1.1} />
        {graph.nodes
          .filter((n) => n.kind === 'hub')
          .map((n) => (
            <pointLight
              key={`glow-${n.id}`}
              position={n.position}
              intensity={6}
              distance={7}
              color={KIND_HEX.hub}
            />
          ))}
        <CameraRig />
        <Ticker animated={animated} />
        <Invalidator graph={graph} selectedId={selectedId} />
        <FlowEdges graph={graph} />
        {graph.nodes.map((n) => (
          <SceneNodeMesh
            key={n.id}
            node={n}
            selected={selectedId === n.id}
            hovered={hoveredId === n.id}
            onHover={setHoveredId}
            onSelect={onSelect}
          />
        ))}
        <OrbitControls
          enableDamping
          dampingFactor={0.12}
          autoRotate={false}
          enablePan={false}
          minDistance={4}
          maxDistance={16}
          makeDefault
        />
      </Canvas>
      <div style={vignetteStyle} />
      <span style={captionStyle}>
        {hasGated
          ? '3D TOPOLOGY · DRAG TO ORBIT · IPHONE GATED — SUPPORT LATER'
          : '3D TOPOLOGY · DRAG TO ORBIT · SCROLL TO ZOOM'}
      </span>
    </div>
  )
})
