/* eslint-disable react/no-unknown-property -- R3F three intrinsics (position, rotation, scale, args, geometry, material, color, emissive, …) that the DOM property allowlist cannot know. Scoped to this model file only. */
/* eslint-disable react-refresh/only-export-components -- binding model-lane contract: MODEL_FOOTPRINT + STATUS_HEX must live beside the component. */
import { memo } from 'react'
import * as THREE from 'three'

export type MousePadStatus = 'online' | 'suspect' | 'offline' | 'gated'

export type MousePadProps = {
  status: MousePadStatus
  dimmed?: boolean
  scale?: number
}

// Status LED colors. Stitch token hexes hardcoded per the model-lane rule
// (no new tokens): --z-status-green, --z-marker-yellow, --z-secondary-ink
// (offline gray-brown), --z-error-red.
export const STATUS_HEX: Record<MousePadStatus, string> = {
  online: '#10B981',
  suspect: '#F7DF94',
  offline: '#5C4038',
  gated: '#DC2626'
}

// Bounding size in scene units of the unscaled model.
// XXL desk mat + gaming mouse riding on it: width 2.6 and depth 1.35 are the
// pad (dominates every axis but height), height 0.5 is the mouse crown.
export const MODEL_FOOTPRINT = { w: 2.6, h: 0.5, d: 1.35 }

// Thin-mat pad: 0.03 thick standing on y=0, so the rolling surface is ~0.02 up.
export const PAD_H = 0.03
export const PAD_TOP = PAD_H
// Mouse base-plate center: half its thickness above the pad surface (resting).
export const MOUSE_BASE_Y = PAD_TOP + 0.0175

// Dark Stitch-ink-family plastics (hardcoded, not tokens — same lane rule as
// the keyboard chassis). Red accents echo --z-error-red #DC2626.
const PAD = '#23262B'
const PAD_EDGE = '#31363D'
const BODY = '#1B1E23'
const BUTTON = '#262A31'
const NEAR_BLACK = '#101216'
const RIB = '#2A2E35'
const HUB = '#3A4048'
const ACCENT = '#DC2626'

const MOUSE_X = 0.55
const MOUSE_Z = 0.05

// USB cable stub: leaves the mouse nose (-Z, toward the monitor side) and
// ends mid-air at the pad edge. The integration lane hooks the full cable here.
const cableCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(MOUSE_X, 0.16, MOUSE_Z - 0.49),
  new THREE.Vector3(MOUSE_X, 0.13, MOUSE_Z - 0.6),
  new THREE.Vector3(MOUSE_X - 0.02, 0.09, MOUSE_Z - 0.69),
  new THREE.Vector3(MOUSE_X - 0.05, 0.07, MOUSE_Z - 0.77)
])
const cableGeometry = new THREE.TubeGeometry(cableCurve, 32, 0.02, 8, false)

// Scroll-wheel rubber ribs: three thin bars tangent to the tread, tilted
// around the wheel (X) axis so they read as grip ridges.
const RIBS: Array<{ y: number; z: number; rot: number }> = [
  { y: 0.462, z: MOUSE_Z - 0.35, rot: 0 },
  { y: 0.451, z: MOUSE_Z - 0.386, rot: 0.6 },
  { y: 0.451, z: MOUSE_Z - 0.314, rot: -0.6 }
]

function MousePadInner({
  status,
  dimmed
}: {
  status: MousePadStatus
  dimmed: boolean
}): React.JSX.Element {
  const bodyOpacity = dimmed ? 0.35 : 1
  const padOpacity = dimmed ? 0.6 : 1
  const statusGlow = dimmed ? 0.15 : 1.6
  const accentGlow = dimmed ? 0.1 : 0.7

  return (
    <group position={[0, 0, 0]}>
      {/* XXL desk mat: thin charcoal slab standing on y=0 */}
      <mesh name="pad" data-testid="mousepad-pad" position={[0, PAD_H / 2, 0]}>
        <boxGeometry args={[2.6, PAD_H, 1.35]} />
        <meshStandardMaterial
          data-testid="mousepad-pad-material"
          color={PAD}
          roughness={0.9}
          metalness={0}
          transparent={dimmed}
          opacity={padOpacity}
        />
      </mesh>

      {/* stitched-edge hint: a slightly larger, lighter frame peeking out */}
      <mesh name="pad-edge" position={[0, 0.009, 0]}>
        <boxGeometry args={[2.68, 0.018, 1.43]} />
        <meshStandardMaterial
          color={PAD_EDGE}
          roughness={0.85}
          metalness={0}
          transparent={dimmed}
          opacity={padOpacity}
        />
      </mesh>

      {/* flat mouse base plate resting on the pad surface */}
      <mesh name="mouse-base" position={[MOUSE_X, MOUSE_BASE_Y, MOUSE_Z]} scale={[1, 1, 1.55]}>
        <cylinderGeometry args={[0.3, 0.32, 0.035, 24]} />
        <meshStandardMaterial
          color={NEAR_BLACK}
          roughness={0.7}
          metalness={0.1}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>

      {/* ergonomic rounded body: unit sphere scaled to a mouse shell */}
      <mesh
        name="mouse-body"
        data-testid="mousepad-body"
        position={[MOUSE_X, 0.22, MOUSE_Z]}
        scale={[0.32, 0.24, 0.5]}
      >
        <sphereGeometry args={[1, 28, 20]} />
        <meshStandardMaterial
          data-testid="mousepad-body-material"
          color={BODY}
          roughness={0.45}
          metalness={0.3}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>

      {/* split left/right click buttons with a seam gap */}
      <mesh
        name="button-left"
        position={[MOUSE_X - 0.1425, 0.385, MOUSE_Z - 0.24]}
        rotation-x={-0.08}
      >
        <boxGeometry args={[0.27, 0.055, 0.4]} />
        <meshStandardMaterial
          color={BUTTON}
          roughness={0.5}
          metalness={0.2}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>
      <mesh
        name="button-right"
        position={[MOUSE_X + 0.1425, 0.385, MOUSE_Z - 0.24]}
        rotation-x={-0.08}
      >
        <boxGeometry args={[0.27, 0.055, 0.4]} />
        <meshStandardMaterial
          color={BUTTON}
          roughness={0.5}
          metalness={0.2}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>
      <mesh name="button-seam" position={[MOUSE_X, 0.383, MOUSE_Z - 0.24]}>
        <boxGeometry args={[0.03, 0.06, 0.4]} />
        <meshStandardMaterial
          color={NEAR_BLACK}
          roughness={0.7}
          metalness={0.1}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>

      {/* scroll wheel: rubber tire + hub, axis along X */}
      <mesh name="wheel" position={[MOUSE_X, 0.4, MOUSE_Z - 0.35]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.062, 0.062, 0.055, 20]} />
        <meshStandardMaterial
          color={NEAR_BLACK}
          roughness={0.8}
          metalness={0.1}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>
      <mesh name="wheel-hub" position={[MOUSE_X, 0.4, MOUSE_Z - 0.35]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.028, 0.028, 0.06, 12]} />
        <meshStandardMaterial
          color={HUB}
          roughness={0.5}
          metalness={0.4}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>
      {RIBS.map((rib, i) => (
        <mesh key={i} name={`rib-${i}`} position={[MOUSE_X, rib.y, rib.z]} rotation-x={rib.rot}>
          <boxGeometry args={[0.06, 0.014, 0.03]} />
          <meshStandardMaterial
            color={RIB}
            roughness={0.8}
            metalness={0.1}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>
      ))}

      {/* two thumb buttons on the left flank */}
      <mesh name="side-button-0" position={[MOUSE_X - 0.305, 0.26, MOUSE_Z + 0.03]}>
        <boxGeometry args={[0.05, 0.05, 0.13]} />
        <meshStandardMaterial
          color={BUTTON}
          roughness={0.5}
          metalness={0.2}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>
      <mesh name="side-button-1" position={[MOUSE_X - 0.305, 0.26, MOUSE_Z + 0.19]}>
        <boxGeometry args={[0.05, 0.05, 0.13]} />
        <meshStandardMaterial
          color={BUTTON}
          roughness={0.5}
          metalness={0.2}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>

      {/* subtle red accent lines along both lower flanks (owner photo) */}
      <mesh name="accent-left" position={[MOUSE_X - 0.298, 0.15, MOUSE_Z]}>
        <boxGeometry args={[0.025, 0.035, 0.6]} />
        <meshStandardMaterial
          data-testid="mousepad-accent-material"
          color={ACCENT}
          emissive={ACCENT}
          emissiveIntensity={accentGlow}
          roughness={0.4}
          metalness={0.2}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>
      <mesh name="accent-right" position={[MOUSE_X + 0.298, 0.15, MOUSE_Z]}>
        <boxGeometry args={[0.025, 0.035, 0.6]} />
        <meshStandardMaterial
          data-testid="mousepad-accent-material"
          color={ACCENT}
          emissive={ACCENT}
          emissiveIntensity={accentGlow}
          roughness={0.4}
          metalness={0.2}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>

      {/* short USB cable stub curving from the nose */}
      <mesh name="cable-stub" data-testid="mousepad-cable-stub" geometry={cableGeometry}>
        <meshStandardMaterial
          color={NEAR_BLACK}
          roughness={0.6}
          metalness={0.2}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>

      {/* small status LED on the rear crown, driven by node status */}
      <mesh
        name="status-light"
        data-testid="mousepad-status-light"
        position={[MOUSE_X, 0.35, MOUSE_Z + 0.41]}
      >
        <boxGeometry args={[0.1, 0.025, 0.035]} />
        <meshStandardMaterial
          data-testid="mousepad-status-material"
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

// Gaming mouse riding on an XXL desk mat, centered at the origin, front (+Z)
// facing the viewer, pad standing on y=0. No lights, no textures, no frame
// loop of its own — the integration lane owns the Canvas, lights and
// frameloop="demand".
function MousePad({ status, dimmed = false, scale = 1 }: MousePadProps): React.JSX.Element {
  return (
    <group data-testid="mousepad" scale={scale}>
      <MousePadInner status={status} dimmed={dimmed} />
    </group>
  )
}

export default memo(MousePad)
