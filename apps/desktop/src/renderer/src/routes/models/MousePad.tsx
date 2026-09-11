/* eslint-disable react/no-unknown-property -- R3F three intrinsics (position, rotation, scale, args, geometry, material, color, emissive, …) that the DOM property allowlist cannot know. Scoped to this model file only. */
/* eslint-disable react-refresh/only-export-components -- binding model-lane contract: MODEL_FOOTPRINT + STATUS_HEX must live beside the component. */
import { memo, useLayoutEffect, useRef } from 'react'
import { invalidate } from '@react-three/fiber'
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

// Detail pass 2 (Task 29f) accent colors (hardcoded, not tokens — the
// model-lane rule forbids new tokens; nearest-token kin noted where one
// exists).
const PTFE = '#C9CDD2' // dry-glide feet (no token off-white exists)
const GRIP = '#14161A' // flank rubber (near-black family)
const STITCH = '#6B7280' // stitch thread gray (no token exists)
const LOGO = '#9AA0A8' // badge metal (no token aluminum exists)
const UNDERGLOW = '#7C3AED' // base wash, echoes the keyboard underglow hex
const BRAID = '#23262C' // braided sleeve (same hex as the keyboard braid)

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

// Detail pass 2 (Task 29f) instancing budgets — 8 new draws (18 → 26, cap
// 120): wheel ribs, PTFE feet, side-grip dots, cable braid rings, pad
// stitches (one instancedMesh each) + dpi button/led, grip panels, logo
// plate, underglow strip (one mesh each). Deliberately skipped: mouse bungee
// (out of footprint — would float off-pad with nothing anchoring it), pad
// weave micro-texture (no texture/map support in the lane; a flat
// translucent plane over the whole mat would read as a smudge, not cloth).
type FillItem = {
  p: [number, number, number]
  rx?: number
  ry?: number
  rz?: number
  sx?: number
}

// Scroll-wheel rubber grip: a full ring of ribs tangent to the tread (wheel
// axis along X, so the ring lives in the Y-Z plane; rib faces point radially
// outward via rotation-x = angle). Lower ribs sink into the shell — hidden,
// harmless, still one draw call.
export const WHEEL_RIB_COUNT = 10
const WHEEL_Y = 0.4
const WHEEL_Z = MOUSE_Z - 0.35
const WHEEL_R = 0.06
const wheelRibItems: FillItem[] = Array.from({ length: WHEEL_RIB_COUNT }, (_, i) => {
  const a = (i / WHEEL_RIB_COUNT) * Math.PI * 2
  return {
    p: [MOUSE_X, WHEEL_Y + WHEEL_R * Math.cos(a), WHEEL_Z + WHEEL_R * Math.sin(a)],
    rx: a
  }
})

// PTFE glide feet: four discs tucked under the base plate, centers just
// inside the plate ellipse so only crescent slivers peek out.
export const FEET_COUNT = 4
const footItems: FillItem[] = [
  [-0.2, -0.3],
  [0.2, -0.3],
  [-0.2, 0.3],
  [0.2, 0.3]
].map(([dx, dz]) => ({ p: [MOUSE_X + dx, PAD_TOP + 0.0055, MOUSE_Z + dz] }))

// Body shell ellipsoid radii (mouse-body sphere scaled [0.32, 0.24, 0.5]).
const SHELL_RX = 0.32
const SHELL_RY = 0.24
const SHELL_RZ = 0.5
const SHELL_Y = 0.22
// Side-grip dot field: two shallow rows BELOW the thumb buttons (button
// bottoms sit at y=0.235, so rows at 0.16/0.20 stay clear), rear-biased
// columns. Each dot hugs max(shell surface, grip-panel outer face) so none
// ever float: dots read as texture on the shell where the panel is buried
// and as nubs on the raised panel toward the rear.
const GRIP_DYS = [-0.06, -0.02]
const GRIP_DZS = [0.0, 0.05, 0.1, 0.15, 0.2]
const PANEL_OUTER = 0.31
function flankX(dy: number, dz: number): number {
  const q = 1 - (dy / SHELL_RY) * (dy / SHELL_RY) - (dz / SHELL_RZ) * (dz / SHELL_RZ)
  return SHELL_RX * Math.sqrt(Math.max(0, q))
}
export const GRIP_DOT_COUNT = 2 * GRIP_DYS.length * GRIP_DZS.length
const gripDotItems: FillItem[] = []
for (const s of [-1, 1]) {
  for (const dy of GRIP_DYS) {
    for (const dz of GRIP_DZS) {
      gripDotItems.push({
        p: [
          MOUSE_X + s * (Math.max(flankX(dy, dz), PANEL_OUTER) + 0.004),
          SHELL_Y + dy,
          MOUSE_Z + dz
        ]
      })
    }
  }
}

// Cable braid rings: torus ridges sampled along the stub curve, axes aligned
// to the local tangent (euler extracted at module scope — pure THREE math).
export const BRAID_N = 6
const braidItems: FillItem[] = Array.from({ length: BRAID_N }, (_, i) => {
  const t = 0.12 + (i / (BRAID_N - 1)) * 0.74
  const pt = cableCurve.getPointAt(t)
  const tan = cableCurve.getTangentAt(t).normalize()
  const e = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan)
  )
  return { p: [pt.x, pt.y, pt.z], rx: e.x, ry: e.y, rz: e.z }
})

// Pad stitched edge: thread dashes inset from the mat rim on the rolling
// surface (nominal 0.115 pitch stretched to fill each span edge-to-edge).
const STITCH_IN = 0.07
const STITCH_P = 0.115
function stitchRun(count: number, span: number): number[] {
  const pitch = span / count
  return Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * pitch)
}
const STITCH_LONG_N = Math.floor((2.6 - STITCH_IN * 2) / STITCH_P)
const STITCH_SHORT_N = Math.floor((1.35 - STITCH_IN * 2) / STITCH_P)
export const STITCH_COUNT = STITCH_LONG_N * 2 + STITCH_SHORT_N * 2
const STITCH_Y = PAD_TOP + 0.001
const stitchItems: FillItem[] = [
  ...stitchRun(STITCH_LONG_N, 2.6 - STITCH_IN * 2).flatMap((x): FillItem[] => [
    { p: [x, STITCH_Y, 1.35 / 2 - STITCH_IN] },
    { p: [x, STITCH_Y, -(1.35 / 2 - STITCH_IN)] }
  ]),
  ...stitchRun(STITCH_SHORT_N, 1.35 - STITCH_IN * 2).flatMap((z): FillItem[] => [
    { p: [2.6 / 2 - STITCH_IN, STITCH_Y, z], ry: Math.PI / 2 },
    { p: [-(2.6 / 2 - STITCH_IN), STITCH_Y, z], ry: Math.PI / 2 }
  ])
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
  const underglowOpacity = dimmed ? 0.1 : 0.5

  // Instanced repeated parts (wheel ribs, PTFE feet, grip dots, braid rings,
  // stitches). Same harness as the keyboard lane: the `typeof setMatrixAt`
  // guard no-ops under the mock-DOM unit render, where refs are plain
  // elements instead of THREE objects. useLayoutEffect + demand
  // invalidate(): matrices fill before paint, and the global invalidate()
  // no-ops when no Canvas is mounted.
  const ribsRef = useRef<THREE.InstancedMesh | null>(null)
  const feetRef = useRef<THREE.InstancedMesh | null>(null)
  const gripRef = useRef<THREE.InstancedMesh | null>(null)
  const braidRef = useRef<THREE.InstancedMesh | null>(null)
  const stitchRef = useRef<THREE.InstancedMesh | null>(null)

  useLayoutEffect(() => {
    const dummy = new THREE.Object3D()
    const fill = (mesh: THREE.InstancedMesh | null, items: FillItem[]): void => {
      if (mesh === null || typeof mesh.setMatrixAt !== 'function') return
      items.forEach((item, i) => {
        dummy.position.set(item.p[0], item.p[1], item.p[2])
        dummy.rotation.set(item.rx ?? 0, item.ry ?? 0, item.rz ?? 0)
        dummy.scale.set(item.sx ?? 1, 1, 1)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
      })
      mesh.instanceMatrix.needsUpdate = true
    }
    fill(ribsRef.current, wheelRibItems)
    fill(feetRef.current, footItems)
    fill(gripRef.current, gripDotItems)
    fill(braidRef.current, braidItems)
    fill(stitchRef.current, stitchItems)
    // Demand-frameloop nudge: the one-shot fills above land before paint, so
    // request the frame. Guarded — the mock-DOM unit render has no Canvas,
    // and some test mocks of @react-three/fiber omit invalidate entirely.
    try {
      invalidate()
    } catch {
      // No live Canvas to nudge; the initial mount frame already covers it.
    }
  }, [])

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

      {/* pad stitching: instanced thread dashes around the rim (one draw) */}
      <instancedMesh
        name="stitches"
        data-testid="mousepad-stitches"
        data-count={STITCH_COUNT}
        ref={stitchRef}
        args={[undefined, undefined, STITCH_COUNT]}
        frustumCulled={false}
      >
        <boxGeometry args={[0.05, 0.006, 0.014]} />
        <meshStandardMaterial
          color={STITCH}
          roughness={0.9}
          metalness={0}
          transparent={dimmed}
          opacity={padOpacity}
        />
      </instancedMesh>

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

      {/* RGB underglow seam peeking from under the base plate (keyboard's
          glow language: same violet wash hex, wash-like opacity) */}
      <mesh
        name="underglow"
        data-testid="mousepad-underglow"
        position={[MOUSE_X, PAD_TOP + 0.005, MOUSE_Z]}
        rotation-x={-Math.PI / 2}
        scale={[1, 1.55, 1]}
      >
        <torusGeometry args={[0.328, 0.014, 8, 48]} />
        <meshBasicMaterial
          data-testid="mousepad-underglow-material"
          color={UNDERGLOW}
          transparent
          opacity={underglowOpacity}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* PTFE glide feet: instanced discs tucked under the base (one draw) */}
      <instancedMesh
        name="ptfe-feet"
        data-testid="mousepad-ptfe-feet"
        data-count={FEET_COUNT}
        ref={feetRef}
        args={[undefined, undefined, FEET_COUNT]}
        frustumCulled={false}
      >
        <cylinderGeometry args={[0.06, 0.06, 0.01, 16]} />
        <meshStandardMaterial
          color={PTFE}
          roughness={0.35}
          metalness={0}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </instancedMesh>

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

      {/* brand-free logo badge inlaid on the palm hump (no text, no marks) */}
      <mesh name="logo-plate" position={[MOUSE_X, 0.4265, MOUSE_Z + 0.25]} rotation-x={-0.27}>
        <boxGeometry args={[0.12, 0.008, 0.06]} />
        <meshStandardMaterial
          data-testid="mousepad-logo-material"
          color={LOGO}
          roughness={0.35}
          metalness={0.7}
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
      {/* wheel rubber grip: full ring of instanced tread ribs (one draw) */}
      <instancedMesh
        name="wheel-ribs"
        data-testid="mousepad-wheel-ribs"
        data-count={WHEEL_RIB_COUNT}
        ref={ribsRef}
        args={[undefined, undefined, WHEEL_RIB_COUNT]}
        frustumCulled={false}
      >
        <boxGeometry args={[0.058, 0.012, 0.026]} />
        <meshStandardMaterial
          color={RIB}
          roughness={0.8}
          metalness={0.1}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </instancedMesh>

      {/* DPI cycle button on the hump behind the wheel + status-driven LED */}
      <mesh name="dpi-button" position={[MOUSE_X, 0.455, MOUSE_Z + 0.02]}>
        <boxGeometry args={[0.09, 0.025, 0.11]} />
        <meshStandardMaterial
          color={BUTTON}
          roughness={0.5}
          metalness={0.2}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>
      <mesh name="dpi-led" position={[MOUSE_X, 0.456, MOUSE_Z + 0.1]}>
        <boxGeometry args={[0.035, 0.014, 0.014]} />
        <meshStandardMaterial
          data-testid="mousepad-dpi-material"
          color={NEAR_BLACK}
          emissive={STATUS_HEX[status]}
          emissiveIntensity={statusGlow}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>

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

      {/* side grip texture: rubber panels emerging from the shell toward the
          rear (front ends buried = molded look, rear reads as raised grip) */}
      <mesh name="grip-left" position={[MOUSE_X - 0.295, 0.18, MOUSE_Z + 0.09]}>
        <boxGeometry args={[0.03, 0.09, 0.3]} />
        <meshStandardMaterial
          color={GRIP}
          roughness={0.85}
          metalness={0.05}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>
      <mesh name="grip-right" position={[MOUSE_X + 0.295, 0.18, MOUSE_Z + 0.09]}>
        <boxGeometry args={[0.03, 0.09, 0.3]} />
        <meshStandardMaterial
          color={GRIP}
          roughness={0.85}
          metalness={0.05}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>
      {/* grip nubs hugging shell/panel surfaces (one instanced draw) */}
      <instancedMesh
        name="grip-dots"
        data-testid="mousepad-grip-dots"
        data-count={GRIP_DOT_COUNT}
        ref={gripRef}
        args={[undefined, undefined, GRIP_DOT_COUNT]}
        frustumCulled={false}
      >
        <boxGeometry args={[0.014, 0.02, 0.045]} />
        <meshStandardMaterial
          color={GRIP}
          roughness={0.85}
          metalness={0.05}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </instancedMesh>

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

      {/* braided-sleeve hint: instanced rings around the stub (one draw) */}
      <instancedMesh
        name="braid-rings"
        data-testid="mousepad-braid-rings"
        data-count={BRAID_N}
        ref={braidRef}
        args={[undefined, undefined, BRAID_N]}
        frustumCulled={false}
      >
        <torusGeometry args={[0.021, 0.005, 6, 20]} />
        <meshStandardMaterial
          color={BRAID}
          roughness={0.7}
          metalness={0.2}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </instancedMesh>

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
