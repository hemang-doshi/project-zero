/* eslint-disable react/no-unknown-property -- R3F three intrinsics (position, rotation, scale, args, geometry, material, color, emissive, …) that the DOM property allowlist cannot know. Scoped to this model file only. */
/* eslint-disable react-refresh/only-export-components -- binding model-lane contract: MODEL_FOOTPRINT + STATUS_HEX must live beside the component. */
import { memo } from 'react'

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
// Screen tints from Stitch tokens: --z-ink base, --z-highlight-blue glow,
// --z-card-cream / --z-nav-cream desktop windows, --z-brand-orange dock dot.
const SCREEN_BASE = '#191C20'
const SCREEN_GLOW = '#3B82F6'
const WINDOW_A = '#FAF8F5'
const WINDOW_B = '#F3ECDF'
const DOCK_DOT = '#F54E00'

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

function MonitorInner({
  status,
  dimmed
}: {
  status: MonitorStatus
  dimmed: boolean
}): React.JSX.Element {
  const bodyOpacity = dimmed ? 0.35 : 1
  const screenGlow = dimmed ? 0.05 : 0.7
  const desktopGlow = dimmed ? 0.03 : 0.5
  const statusGlow = dimmed ? 0.15 : 1.6

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

      {/* VESA-mount hint plate on the back with four screw dots */}
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
      {[
        [-0.18, 1.13],
        [0.18, 1.13],
        [-0.18, 0.77],
        [0.18, 0.77]
      ].map(([x, y], i) => (
        <mesh key={i} name={`vesa-screw-${i}`} rotation-x={Math.PI / 2} position={[x, y, -0.158]}>
          <cylinderGeometry args={[0.02, 0.02, 0.012, 12]} />
          <meshStandardMaterial color={NEAR_BLACK} roughness={0.6} metalness={0.4} />
        </mesh>
      ))}

      {/* port hints along the lower back edge: HDMI + DisplayPort + USB-C */}
      <mesh name="port-hdmi" position={[-0.85, 0.7, -0.125]}>
        <boxGeometry args={[0.28, 0.06, 0.04]} />
        <meshStandardMaterial color={NEAR_BLACK} roughness={0.7} metalness={0.2} />
      </mesh>
      <mesh name="port-dp" position={[-0.5, 0.7, -0.125]}>
        <boxGeometry args={[0.24, 0.06, 0.04]} />
        <meshStandardMaterial color={NEAR_BLACK} roughness={0.7} metalness={0.2} />
      </mesh>
      <mesh name="port-usbc" position={[-0.2, 0.7, -0.125]}>
        <boxGeometry args={[0.14, 0.05, 0.04]} />
        <meshStandardMaterial color={NEAR_BLACK} roughness={0.7} metalness={0.2} />
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
      {/* desktop hints: menu bar, two windows, dock + dock dot */}
      <mesh name="screen-menubar" position={[0, SCREEN_CENTER_Y + 0.79, FRONT_Z + 0.006]}>
        <planeGeometry args={[SCREEN_W, 0.1]} />
        <meshStandardMaterial
          color={SCREEN_BASE}
          emissive={SCREEN_GLOW}
          emissiveIntensity={dimmed ? 0.08 : 0.9}
        />
      </mesh>
      <mesh name="screen-window-a" position={[-0.65, SCREEN_CENTER_Y + 0.06, FRONT_Z + 0.006]}>
        <planeGeometry args={[1.35, 0.95]} />
        <meshStandardMaterial
          color={SCREEN_BASE}
          emissive={WINDOW_A}
          emissiveIntensity={desktopGlow}
        />
      </mesh>
      <mesh name="screen-window-b" position={[0.9, SCREEN_CENTER_Y - 0.14, FRONT_Z + 0.006]}>
        <planeGeometry args={[0.95, 0.75]} />
        <meshStandardMaterial
          color={SCREEN_BASE}
          emissive={WINDOW_B}
          emissiveIntensity={desktopGlow}
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
      <mesh name="screen-dock-dot" position={[-0.55, SCREEN_CENTER_Y - 0.71, FRONT_Z + 0.008]}>
        <planeGeometry args={[0.06, 0.06]} />
        <meshStandardMaterial
          color={SCREEN_BASE}
          emissive={DOCK_DOT}
          emissiveIntensity={dimmed ? 0.05 : 0.8}
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
