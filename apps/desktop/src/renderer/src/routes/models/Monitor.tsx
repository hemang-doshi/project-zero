/* eslint-disable react/no-unknown-property -- R3F three intrinsics (position, rotation, scale, args, geometry, material, color, emissive, …) that the DOM property allowlist cannot know. Scoped to this model file only. */
/* eslint-disable react-refresh/only-export-components -- binding model-lane contract: MODEL_FOOTPRINT + STATUS_HEX must live beside the component. */
import { invalidate } from '@react-three/fiber'
import { memo, useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'

export type MonitorStatus = 'online' | 'suspect' | 'offline' | 'gated'

export type MonitorProps = {
  status: MonitorStatus
  dimmed?: boolean
  scale?: number
}

// Status light colors. Stitch token hexes hardcoded per the model-lane rule
// (no new tokens): --z-status-green, --z-marker-yellow, --z-secondary-ink
// (offline gray-brown), --z-error-red.
export const STATUS_HEX: Record<MonitorStatus, string> = {
  online: '#10B981',
  suspect: '#F7DF94',
  offline: '#5C4038',
  gated: '#DC2626'
}

// Bounding size in scene units of the unscaled model.
// Proportions follow a modern 27"-class 16:9 display (609.6 × 352.8 mm
// panel): width 3.2, standing height 2.6 (panel top), depth 0.75
// (base foot front lip to back-shell curve).
export const MODEL_FOOTPRINT = { w: 3.2, h: 2.6, d: 0.75 }

// Dark aluminum/plastic body (no token charcoal exists — hardcoded, not a token).
const BODY = '#2A2E35'
const BODY_DARK = '#1E2126'
const NEAR_BLACK = '#101216'
// Bezel micro-edge highlight (hardcoded trim, not a token).
const MICRO_EDGE = '#3A3F47'
// Screen tints from Stitch tokens: --z-ink base, --z-highlight-blue glow,
// --z-card-cream / --z-nav-cream desktop windows, --z-brand-orange dock dot.
const SCREEN_BASE = '#191C20'
const SCREEN_GLOW = '#3B82F6'
const WINDOW_A = '#FAF8F5'
const WINDOW_B = '#F3ECDF'
const DOCK_DOT = '#F54E00'
// Neutral chin badge pill: --z-line. Anti-glare tint: --z-card-white.
const BADGE = '#DED7CA'
const GLARE = '#FFFFFF'
// USB3 tongue blue hint: --z-highlight-blue (same hex as SCREEN_GLOW).
const USB3_TONGUE = '#3B82F6'

const PANEL_W = 3.2
const PANEL_H = 1.98
const PANEL_T = 0.12
const PANEL_BOTTOM = 0.62
const PANEL_CENTER_Y = PANEL_BOTTOM + PANEL_H / 2
const FRONT_Z = PANEL_T / 2
// 16:9 glass with thin side/top bezels and a slightly thicker bottom chin.
const SCREEN_W = 3.04
const SCREEN_H = 1.68
const CHIN_H = 0.23
const SCREEN_CENTER_Y = PANEL_BOTTOM + CHIN_H + SCREEN_H / 2
const CHIN_CENTER_Y = PANEL_BOTTOM + CHIN_H / 2

// Detail-pass instancing budgets (each instancedMesh = 1 draw call):
// VESA screws, top-edge vent slots, OSD buttons, USB-A pair + tongues,
// menu-bar dots, window traffic dots, dock icons.
const VESA_SCREW_SPOTS: Array<[number, number]> = [
  [-0.18, 1.13],
  [0.18, 1.13],
  [-0.18, 0.77],
  [0.18, 0.77]
]
const VESA_SCREW_Z = -0.158
const VENT_N = 12
const VENT_X0 = -1.32
const VENT_PITCH = 0.24
const VENT_Y = 2.54
const VENT_Z = -0.085
const OSD_N = 4
const OSD_X0 = 0.95
const OSD_PITCH = 0.16
const OSD_Y = 0.603
const OSD_Z = 0.03
const USBA_X: Array<number> = [-0.15, 0.15]
const USBA_Y = 0.7
const USBA_Z = -0.125
const USBA_TONGUE_Z = -0.146
const MENUBAR_DOT_N = 3
const MENUBAR_DOT_X0 = 1.1
const MENUBAR_DOT_PITCH = 0.11
const WINDOW_DOT_N = 3
const WINDOW_DOT_X0 = -1.22
const WINDOW_DOT_PITCH = 0.1
const DOCK_ICON_N = 6
const DOCK_ICON_X0 = -0.3
const DOCK_ICON_PITCH = 0.19

function MonitorInner({
  status,
  dimmed
}: {
  status: MonitorStatus
  dimmed: boolean
}): React.JSX.Element {
  // Instanced repeated parts (VESA screws, vent slots, OSD buttons, USB-A
  // pair + tongues, menu-bar dots, window dots, dock icons). Same harness as
  // the iPhone lane: the `typeof setMatrixAt` guard no-ops under the mock-DOM
  // unit render, where refs are plain elements instead of THREE objects.
  // useLayoutEffect + demand invalidate() (T29b ruling): matrices fill before
  // paint, and the global invalidate() no-ops when no Canvas is mounted, so
  // the jsdom render stays side-effect free.
  const vesaScrewsRef = useRef<THREE.InstancedMesh | null>(null)
  const ventSlotsRef = useRef<THREE.InstancedMesh | null>(null)
  const osdButtonsRef = useRef<THREE.InstancedMesh | null>(null)
  const usbaRef = useRef<THREE.InstancedMesh | null>(null)
  const usbaTonguesRef = useRef<THREE.InstancedMesh | null>(null)
  const menubarDotsRef = useRef<THREE.InstancedMesh | null>(null)
  const windowDotsRef = useRef<THREE.InstancedMesh | null>(null)
  const dockIconsRef = useRef<THREE.InstancedMesh | null>(null)

  useLayoutEffect(() => {
    const dummy = new THREE.Object3D()
    const fill = (
      mesh: THREE.InstancedMesh | null,
      positions: Array<[number, number, number]>,
      rotation: [number, number, number] = [0, 0, 0]
    ): void => {
      if (mesh === null || typeof mesh.setMatrixAt !== 'function') return
      positions.forEach(([x, y, z], i) => {
        dummy.position.set(x, y, z)
        dummy.rotation.set(rotation[0], rotation[1], rotation[2])
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
      })
      mesh.instanceMatrix.needsUpdate = true
    }
    fill(
      vesaScrewsRef.current,
      VESA_SCREW_SPOTS.map(([x, y]) => [x, y, VESA_SCREW_Z] as [number, number, number]),
      [Math.PI / 2, 0, 0]
    )
    fill(
      ventSlotsRef.current,
      Array.from(
        { length: VENT_N },
        (_, i) => [VENT_X0 + i * VENT_PITCH, VENT_Y, VENT_Z] as [number, number, number]
      )
    )
    fill(
      osdButtonsRef.current,
      Array.from(
        { length: OSD_N },
        (_, i) => [OSD_X0 + i * OSD_PITCH, OSD_Y, OSD_Z] as [number, number, number]
      )
    )
    fill(
      usbaRef.current,
      USBA_X.map((x) => [x, USBA_Y, USBA_Z] as [number, number, number])
    )
    fill(
      usbaTonguesRef.current,
      USBA_X.map((x) => [x, USBA_Y - 0.01, USBA_TONGUE_Z] as [number, number, number])
    )
    fill(
      menubarDotsRef.current,
      Array.from(
        { length: MENUBAR_DOT_N },
        (_, i) =>
          [MENUBAR_DOT_X0 + i * MENUBAR_DOT_PITCH, SCREEN_CENTER_Y + 0.79, FRONT_Z + 0.008] as [
            number,
            number,
            number
          ]
      )
    )
    fill(
      windowDotsRef.current,
      Array.from(
        { length: WINDOW_DOT_N },
        (_, i) =>
          [WINDOW_DOT_X0 + i * WINDOW_DOT_PITCH, SCREEN_CENTER_Y + 0.475, FRONT_Z + 0.01] as [
            number,
            number,
            number
          ]
      )
    )
    fill(
      dockIconsRef.current,
      Array.from(
        { length: DOCK_ICON_N },
        (_, i) =>
          [DOCK_ICON_X0 + i * DOCK_ICON_PITCH, SCREEN_CENTER_Y - 0.7, FRONT_Z + 0.008] as [
            number,
            number,
            number
          ]
      )
    )
    // Demand-frameloop nudge: the one-shot fills above land before paint, so
    // request the frame. Guarded — the mock-DOM unit render has no Canvas,
    // and some test mocks of @react-three/fiber omit invalidate entirely.
    try {
      invalidate()
    } catch {
      // No live Canvas to nudge; the initial mount frame already covers it.
    }
  }, [])

  const bodyOpacity = dimmed ? 0.35 : 1
  const screenGlow = dimmed ? 0.05 : 0.7
  const desktopGlow = dimmed ? 0.03 : 0.5
  const statusGlow = dimmed ? 0.15 : 1.6
  const glyphGlow = dimmed ? 0.04 : 0.75
  const biasGlow = dimmed ? 0.03 : 0.35

  return (
    <group position={[0, 0, 0]}>
      {/* soft fake contact shadow — the integration lane owns real lights */}
      <mesh
        name="base-shadow"
        rotation-x={-Math.PI / 2}
        position={[0, 0.002, -0.05]}
        scale={[2.0, 0.85, 1]}
      >
        <circleGeometry args={[1, 40]} />
        <meshBasicMaterial color={SCREEN_BASE} transparent opacity={0.22} depthWrite={false} />
      </mesh>

      {/* weighted elliptical base foot, standing on y=0 */}
      <mesh
        name="base"
        data-testid="monitor-base"
        position={[0, 0.03, -0.05]}
        scale={[1.15, 1, 0.7]}
      >
        <cylinderGeometry args={[0.5, 0.55, 0.06, 32]} />
        <meshStandardMaterial
          color={BODY_DARK}
          metalness={0.7}
          roughness={0.45}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>

      {/* center stand neck rising from the foot to the panel */}
      <mesh name="stand" data-testid="monitor-stand" position={[0, 0.45, -0.03]}>
        <boxGeometry args={[0.22, 0.8, 0.14]} />
        <meshStandardMaterial
          color={BODY}
          metalness={0.8}
          roughness={0.4}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>

      {/* height-adjustment seam ringing the telescoping neck */}
      <mesh name="stand-seam" data-testid="monitor-stand-seam" position={[0, 0.52, -0.03]}>
        <boxGeometry args={[0.225, 0.018, 0.145]} />
        <meshStandardMaterial
          color={NEAR_BLACK}
          roughness={0.6}
          metalness={0.4}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>

      {/* cable-management clip loop on the neck back + routed cable hint */}
      <mesh
        name="cable-clip"
        data-testid="monitor-cable-clip"
        position={[0, 0.5, -0.12]}
        rotation-x={Math.PI / 2}
      >
        <torusGeometry args={[0.05, 0.012, 8, 24]} />
        <meshStandardMaterial
          color={BODY_DARK}
          metalness={0.7}
          roughness={0.5}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>
      <mesh name="cable" data-testid="monitor-cable" position={[0, 0.43, -0.14]}>
        <boxGeometry args={[0.035, 0.75, 0.02]} />
        <meshStandardMaterial color={NEAR_BLACK} roughness={0.7} metalness={0.2} />
      </mesh>

      {/* 16:9 panel housing with thin bezels, front facing +Z */}
      <mesh name="panel" data-testid="monitor-panel" position={[0, PANEL_CENTER_Y, 0]}>
        <boxGeometry args={[PANEL_W, PANEL_H, PANEL_T]} />
        <meshStandardMaterial
          data-testid="monitor-panel-material"
          color={BODY}
          metalness={0.8}
          roughness={0.4}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>

      {/* back shell with a subtle central curve */}
      <mesh name="back" data-testid="monitor-back" position={[0, PANEL_CENTER_Y, -0.09]}>
        <boxGeometry args={[3.0, 1.8, 0.08]} />
        <meshStandardMaterial
          color={BODY_DARK}
          metalness={0.7}
          roughness={0.5}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>
      <mesh
        name="back-curve"
        position={[0, PANEL_CENTER_Y, -0.12]}
        rotation-z={Math.PI / 2}
        scale={[1, 1, 0.2]}
      >
        <cylinderGeometry args={[0.5, 0.5, 2.7, 24]} />
        <meshStandardMaterial
          color={BODY_DARK}
          metalness={0.7}
          roughness={0.5}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>

      {/* VESA-mount plate on the back with four instanced screws (1 draw) */}
      <mesh name="vesa" data-testid="monitor-vesa" position={[0, 0.95, -0.14]}>
        <boxGeometry args={[0.5, 0.5, 0.03]} />
        <meshStandardMaterial
          color={BODY}
          metalness={0.8}
          roughness={0.4}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>
      <instancedMesh
        name="vesa-screws"
        data-testid="monitor-vesa-screws"
        data-count={VESA_SCREW_SPOTS.length}
        ref={vesaScrewsRef}
        args={[undefined, undefined, VESA_SCREW_SPOTS.length]}
        frustumCulled={false}
      >
        <cylinderGeometry args={[0.02, 0.02, 0.012, 12]} />
        <meshStandardMaterial color={NEAR_BLACK} roughness={0.6} metalness={0.4} />
      </instancedMesh>

      {/* ventilation slots along the top back edge (1 draw, instanced) */}
      <instancedMesh
        name="vent-slots"
        data-testid="monitor-vent-slots"
        data-count={VENT_N}
        ref={ventSlotsRef}
        args={[undefined, undefined, VENT_N]}
        frustumCulled={false}
      >
        <boxGeometry args={[0.14, 0.025, 0.03]} />
        <meshStandardMaterial color={NEAR_BLACK} roughness={0.7} metalness={0.2} />
      </instancedMesh>

      {/* input port cluster along the lower back edge: recess strip grouping
          five distinct connector shapes — wide HDMI, taller DP, pill USB-C,
          paired USB-A with blue tongues, round power barrel + pin */}
      <mesh name="ports-recess" data-testid="monitor-ports-recess" position={[-0.3, 0.7, -0.118]}>
        <boxGeometry args={[2.1, 0.2, 0.02]} />
        <meshStandardMaterial color={NEAR_BLACK} roughness={0.7} metalness={0.2} />
      </mesh>
      <mesh name="port-hdmi" position={[-1.15, 0.7, -0.125]}>
        <boxGeometry args={[0.28, 0.06, 0.04]} />
        <meshStandardMaterial color={NEAR_BLACK} roughness={0.7} metalness={0.2} />
      </mesh>
      <mesh name="port-hdmi-tongue" position={[-1.15, 0.69, -0.146]}>
        <boxGeometry args={[0.24, 0.02, 0.01]} />
        <meshStandardMaterial color={BODY_DARK} roughness={0.6} metalness={0.4} />
      </mesh>
      <mesh name="port-dp" position={[-0.8, 0.7, -0.125]}>
        <boxGeometry args={[0.24, 0.07, 0.04]} />
        <meshStandardMaterial color={NEAR_BLACK} roughness={0.7} metalness={0.2} />
      </mesh>
      <mesh name="port-usbc" position={[-0.5, 0.7, -0.125]} rotation-z={Math.PI / 2}>
        <capsuleGeometry args={[0.025, 0.09, 4, 8]} />
        <meshStandardMaterial color={NEAR_BLACK} roughness={0.7} metalness={0.2} />
      </mesh>
      <instancedMesh
        name="port-usba"
        data-testid="monitor-port-usba"
        data-count={USBA_X.length}
        ref={usbaRef}
        args={[undefined, undefined, USBA_X.length]}
        frustumCulled={false}
      >
        <boxGeometry args={[0.22, 0.09, 0.04]} />
        <meshStandardMaterial color={NEAR_BLACK} roughness={0.7} metalness={0.2} />
      </instancedMesh>
      <instancedMesh
        name="port-usba-tongues"
        data-testid="monitor-port-usba-tongues"
        data-count={USBA_X.length}
        ref={usbaTonguesRef}
        args={[undefined, undefined, USBA_X.length]}
        frustumCulled={false}
      >
        <boxGeometry args={[0.18, 0.025, 0.01]} />
        <meshStandardMaterial
          color={BODY_DARK}
          emissive={USB3_TONGUE}
          emissiveIntensity={dimmed ? 0.02 : 0.25}
        />
      </instancedMesh>
      <mesh name="port-power" position={[0.5, 0.7, -0.125]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.045, 0.045, 0.04, 20]} />
        <meshStandardMaterial color={NEAR_BLACK} roughness={0.7} metalness={0.2} />
      </mesh>
      <mesh name="port-power-pin" position={[0.5, 0.7, -0.146]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.015, 0.015, 0.012, 12]} />
        <meshStandardMaterial color={BODY_DARK} roughness={0.5} metalness={0.6} />
      </mesh>

      {/* ambient bias-light strip washing the wall behind the panel */}
      <mesh name="back-glow" data-testid="monitor-back-glow" position={[0, 0.68, -0.16]}>
        <boxGeometry args={[2.4, 0.06, 0.02]} />
        <meshStandardMaterial
          data-testid="monitor-back-glow-material"
          color={NEAR_BLACK}
          emissive={SCREEN_GLOW}
          emissiveIntensity={biasGlow}
        />
      </mesh>

      {/* bezel micro-edge peeking around the black bezel */}
      <mesh name="bezel-micro-edge" position={[0, SCREEN_CENTER_Y, FRONT_Z + 0.001]}>
        <planeGeometry args={[3.14, 1.78]} />
        <meshStandardMaterial
          color={MICRO_EDGE}
          roughness={0.35}
          metalness={0.8}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>

      {/* thin black bezel framing the glass */}
      <mesh name="bezel" position={[0, SCREEN_CENTER_Y, FRONT_Z + 0.002]}>
        <planeGeometry args={[3.12, 1.76]} />
        <meshStandardMaterial
          color={NEAR_BLACK}
          roughness={0.5}
          metalness={0.3}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>

      {/* glowing 16:9 screen face */}
      <mesh
        name="screen"
        data-testid="monitor-screen"
        position={[0, SCREEN_CENTER_Y, FRONT_Z + 0.004]}
      >
        <planeGeometry args={[SCREEN_W, SCREEN_H]} />
        <meshStandardMaterial
          data-testid="monitor-screen-material"
          color={SCREEN_BASE}
          emissive={SCREEN_GLOW}
          emissiveIntensity={screenGlow}
        />
      </mesh>
      {/* desktop hints: menu bar, two windows with title bars, dock + icons */}
      <mesh name="screen-menubar" position={[0, SCREEN_CENTER_Y + 0.79, FRONT_Z + 0.006]}>
        <planeGeometry args={[SCREEN_W, 0.1]} />
        <meshStandardMaterial
          color={SCREEN_BASE}
          emissive={SCREEN_GLOW}
          emissiveIntensity={dimmed ? 0.08 : 0.9}
        />
      </mesh>
      {/* menu-bar status glyphs, top right (1 draw, instanced) */}
      <instancedMesh
        name="menubar-dots"
        data-testid="monitor-menubar-dots"
        data-count={MENUBAR_DOT_N}
        ref={menubarDotsRef}
        args={[undefined, undefined, MENUBAR_DOT_N]}
        frustumCulled={false}
      >
        <planeGeometry args={[0.05, 0.05]} />
        <meshStandardMaterial
          color={SCREEN_BASE}
          emissive={WINDOW_A}
          emissiveIntensity={glyphGlow}
        />
      </instancedMesh>
      <mesh name="screen-window-a" position={[-0.65, SCREEN_CENTER_Y + 0.06, FRONT_Z + 0.006]}>
        <planeGeometry args={[1.35, 0.95]} />
        <meshStandardMaterial
          color={SCREEN_BASE}
          emissive={WINDOW_A}
          emissiveIntensity={desktopGlow}
        />
      </mesh>
      <mesh
        name="screen-window-a-title"
        position={[-0.65, SCREEN_CENTER_Y + 0.475, FRONT_Z + 0.008]}
      >
        <planeGeometry args={[1.35, 0.12]} />
        <meshStandardMaterial
          color={SCREEN_BASE}
          emissive={WINDOW_B}
          emissiveIntensity={dimmed ? 0.04 : 0.65}
        />
      </mesh>
      {/* window traffic dots in the front title bar (1 draw, instanced) */}
      <instancedMesh
        name="window-dots"
        data-testid="monitor-window-dots"
        data-count={WINDOW_DOT_N}
        ref={windowDotsRef}
        args={[undefined, undefined, WINDOW_DOT_N]}
        frustumCulled={false}
      >
        <planeGeometry args={[0.045, 0.045]} />
        <meshStandardMaterial
          color={SCREEN_BASE}
          emissive={WINDOW_A}
          emissiveIntensity={glyphGlow}
        />
      </instancedMesh>
      <mesh name="screen-window-b" position={[0.9, SCREEN_CENTER_Y - 0.14, FRONT_Z + 0.006]}>
        <planeGeometry args={[0.95, 0.75]} />
        <meshStandardMaterial
          color={SCREEN_BASE}
          emissive={WINDOW_B}
          emissiveIntensity={desktopGlow}
        />
      </mesh>
      <mesh name="screen-window-b-title" position={[0.9, SCREEN_CENTER_Y + 0.175, FRONT_Z + 0.008]}>
        <planeGeometry args={[0.95, 0.1]} />
        <meshStandardMaterial
          color={SCREEN_BASE}
          emissive={WINDOW_A}
          emissiveIntensity={dimmed ? 0.04 : 0.65}
        />
      </mesh>
      <mesh name="screen-dock" position={[0, SCREEN_CENTER_Y - 0.71, FRONT_Z + 0.006]}>
        <planeGeometry args={[1.7, 0.13]} />
        <meshStandardMaterial
          color={SCREEN_BASE}
          emissive={SCREEN_GLOW}
          emissiveIntensity={dimmed ? 0.06 : 0.65}
        />
      </mesh>
      {/* dock app glyphs (1 draw, instanced) */}
      <instancedMesh
        name="dock-icons"
        data-testid="monitor-dock-icons"
        data-count={DOCK_ICON_N}
        ref={dockIconsRef}
        args={[undefined, undefined, DOCK_ICON_N]}
        frustumCulled={false}
      >
        <planeGeometry args={[0.07, 0.07]} />
        <meshStandardMaterial
          color={SCREEN_BASE}
          emissive={SCREEN_GLOW}
          emissiveIntensity={glyphGlow}
        />
      </instancedMesh>
      <mesh name="screen-dock-dot" position={[-0.55, SCREEN_CENTER_Y - 0.71, FRONT_Z + 0.008]}>
        <planeGeometry args={[0.06, 0.06]} />
        <meshStandardMaterial
          color={SCREEN_BASE}
          emissive={DOCK_DOT}
          emissiveIntensity={dimmed ? 0.05 : 0.8}
        />
      </mesh>

      {/* anti-glare tint washing the glass (transparent, depth-sorted last) */}
      <mesh
        name="screen-glare"
        data-testid="monitor-glare"
        position={[0, SCREEN_CENTER_Y, FRONT_Z + 0.01]}
      >
        <planeGeometry args={[SCREEN_W, SCREEN_H]} />
        <meshStandardMaterial
          color={GLARE}
          emissive={GLARE}
          emissiveIntensity={dimmed ? 0.01 : 0.04}
          transparent
          opacity={dimmed ? 0.03 : 0.08}
          depthWrite={false}
        />
      </mesh>

      {/* slightly thicker bottom chin */}
      <mesh name="chin" data-testid="monitor-chin" position={[0, CHIN_CENTER_Y, FRONT_Z]}>
        <boxGeometry args={[PANEL_W, CHIN_H, 0.02]} />
        <meshStandardMaterial
          color={BODY}
          metalness={0.8}
          roughness={0.4}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>

      {/* neutral chin badge pill — no trademark text or logos */}
      <mesh
        name="chin-badge"
        data-testid="monitor-chin-badge"
        position={[-1.25, CHIN_CENTER_Y, FRONT_Z + 0.012]}
        rotation-z={Math.PI / 2}
      >
        <capsuleGeometry args={[0.02, 0.08, 4, 8]} />
        <meshStandardMaterial
          color={BADGE}
          roughness={0.5}
          metalness={0.3}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>

      {/* OSD buttons under the chin (1 draw, instanced) + joystick nub */}
      <instancedMesh
        name="osd-buttons"
        data-testid="monitor-osd-buttons"
        data-count={OSD_N}
        ref={osdButtonsRef}
        args={[undefined, undefined, OSD_N]}
        frustumCulled={false}
      >
        <boxGeometry args={[0.07, 0.025, 0.03]} />
        <meshStandardMaterial color={BODY_DARK} roughness={0.5} metalness={0.6} />
      </instancedMesh>
      <mesh name="osd-joystick" data-testid="monitor-osd-joystick" position={[0.72, OSD_Y, OSD_Z]}>
        <sphereGeometry args={[0.028, 16, 12]} />
        <meshStandardMaterial color={NEAR_BLACK} roughness={0.5} metalness={0.4} />
      </mesh>

      {/* power LED dot on the chin doubling as the connection status light */}
      <mesh
        name="status-light"
        data-testid="monitor-status-light"
        position={[0, CHIN_CENTER_Y, FRONT_Z + 0.015]}
      >
        <sphereGeometry args={[0.032, 16, 12]} />
        <meshStandardMaterial
          data-testid="monitor-status-material"
          color={NEAR_BLACK}
          emissive={STATUS_HEX[status]}
          emissiveIntensity={statusGlow}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>
    </group>
  )
}

// Modern 27"-class desktop monitor, centered at the origin, front facing +Z,
// standing on y=0 via its base foot. No lights, no textures, no frame loop of
// its own — the integration lane owns the Canvas, lights and frameloop="demand".
function Monitor({ status, dimmed = false, scale = 1 }: MonitorProps): React.JSX.Element {
  return (
    <group data-testid="monitor" scale={scale}>
      <MonitorInner status={status} dimmed={dimmed} />
    </group>
  )
}

export default memo(Monitor)
