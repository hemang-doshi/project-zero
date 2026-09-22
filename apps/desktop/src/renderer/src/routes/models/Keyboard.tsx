/* eslint-disable react/no-unknown-property -- R3F three intrinsics (position, rotation, scale, args, geometry, material, color, emissive, …) that the DOM property allowlist cannot know. Scoped to this model file only. */
/* eslint-disable react-refresh/only-export-components -- binding model-lane contract: MODEL_FOOTPRINT + STATUS_HEX must live beside the component. */
import { memo, useLayoutEffect, useRef } from 'react'
import { invalidate } from '@react-three/fiber'
import * as THREE from 'three'

export type KeyboardStatus = 'online' | 'suspect' | 'offline' | 'gated'

export type KeyboardProps = {
  status: KeyboardStatus
  dimmed?: boolean
  scale?: number
}

// Status LED colors. Stitch token hexes hardcoded per the model-lane rule
// (no new tokens): --z-status-green, --z-marker-yellow, --z-secondary-ink
// (offline gray-brown), --z-error-red.
export const STATUS_HEX: Record<KeyboardStatus, string> = {
  online: '#10B981',
  suspect: '#F7DF94',
  offline: '#5C4038',
  gated: '#DC2626'
}

// Bounding size in scene units of the unscaled model.
// 75%-ish tenkeyless RGB board: width 2.8 (sits believably in front of the
// 3.0-wide MacBook Air), low height 0.38 (raised function row + rear cable
// pigtail after tilt), depth 1.16 (chassis + cable stub overhang). w >> d.
export const MODEL_FOOTPRINT = { w: 2.8, h: 0.38, d: 1.16 }

// Dark chassis slab + pudding-cap charcoal (hardcoded, not tokens).
const CHASSIS = '#1B1E23'
const CAP = '#262A31'
const NEAR_BLACK = '#101216'
// Violet under-glow wash (hardcoded, not a token).
const UNDERGLOW = '#7C3AED'
// Per-key RGB gradient: violet-purple → --z-highlight-blue → pink
// (ends hardcoded — no token purple/pink exists).
const GRAD_A = '#8B5CF6'
const GRAD_B = '#3B82F6'
const GRAD_C = '#EC4899'

// Board tilts like a real desk board: front edge (+Z, typist side) lower.
const TILT = THREE.MathUtils.degToRad(3.2)

const PX = 0.172
const GRID_UNITS = 15
const GAP = 0.014
const CAP_H = 0.085
const CAP_Y = 0.21
const GLOW_H = 0.05
const GLOW_Y = 0.165
const STD_D = 0.134
const FN_D = 0.08

function ones(n: number): number[] {
  return Array<number>(n).fill(1)
}

// Six rows on a 15-unit grid: raised function row, four staggered alpha rows,
// and a short bottom row with a wide 6.5u spacebar.
const KEY_ROWS: Array<{ z: number; lift: number; fn: boolean; widths: number[] }> = [
  { z: -0.375, lift: 0.035, fn: true, widths: ones(15) },
  { z: -0.227, lift: 0, fn: false, widths: [...ones(13), 2] },
  { z: -0.079, lift: 0, fn: false, widths: [1.5, ...ones(12), 1.5] },
  { z: 0.069, lift: 0, fn: false, widths: [1.75, ...ones(11), 2.25] },
  { z: 0.217, lift: 0, fn: false, widths: [2.25, ...ones(10), 2.75] },
  { z: 0.365, lift: 0, fn: false, widths: [1.25, 1.25, 1.25, 6.5, 1, 1, 1, 1.75] }
]

export type PlacedKey = { x: number; z: number; w: number; d: number; lift: number; row: number }

const KEYS: PlacedKey[] = (() => {
  const out: PlacedKey[] = []
  for (let r = 0; r < KEY_ROWS.length; r += 1) {
    const row = KEY_ROWS[r]
    let cursor = (-GRID_UNITS * PX) / 2
    for (const u of row.widths) {
      const cx = cursor + (u * PX) / 2
      cursor += u * PX
      out.push({
        x: cx,
        z: row.z,
        w: u * PX - GAP,
        d: row.fn ? FN_D : STD_D,
        lift: row.lift,
        row: r
      })
    }
  }
  return out
})()

// 76 keys: 15 + 14 + 14 + 13 + 12 + 8.
export const KEY_COUNT = KEYS.length

const HALF_SPAN = (GRID_UNITS * PX) / 2

// Purple → blue → pink gradient across the board, slightly shaded toward the
// front rows so the function row reads brightest.
function glowColorFor(x: number, row: number): THREE.Color {
  const t = THREE.MathUtils.clamp((x + HALF_SPAN) / (HALF_SPAN * 2), 0, 1)
  const a = new THREE.Color(GRAD_A)
  const b = new THREE.Color(GRAD_B)
  const c = new THREE.Color(GRAD_C)
  const out = new THREE.Color()
  if (t < 0.5) out.lerpColors(a, b, t * 2)
  else out.lerpColors(b, c, (t - 0.5) * 2)
  return out.multiplyScalar(0.88 + 0.12 * (1 - row / (KEY_ROWS.length - 1)))
}

type BoxPart = {
  w: number
  h: number
  d: number
  x: number
  y: number
  z: number
  color: THREE.Color | null
}

// Merges axis-aligned box parts into ONE BufferGeometry (one draw call).
// Pure THREE math at module scope — no DOM, no frame loop, test-safe.
// (Hand-rolled so the lane needs no three/addons import surface.)
function mergeBoxes(parts: BoxPart[], withColor: boolean): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = []
  for (const p of parts) {
    const g = new THREE.BoxGeometry(p.w, p.h, p.d)
    g.translate(p.x, p.y, p.z)
    if (withColor && p.color) {
      const n = (g.attributes.position as THREE.BufferAttribute).count
      const arr = new Float32Array(n * 3)
      for (let i = 0; i < n; i += 1) {
        arr[i * 3] = p.color.r
        arr[i * 3 + 1] = p.color.g
        arr[i * 3 + 2] = p.color.b
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    }
    geos.push(g)
  }
  let vTotal = 0
  let iTotal = 0
  for (const g of geos) {
    vTotal += (g.attributes.position as THREE.BufferAttribute).count
    iTotal += g.index ? g.index.count : 0
  }
  const pos = new Float32Array(vTotal * 3)
  const nor = new Float32Array(vTotal * 3)
  const uv = new Float32Array(vTotal * 2)
  const col = withColor ? new Float32Array(vTotal * 3) : null
  const idx = new Uint32Array(iTotal)
  let vOff = 0
  let iOff = 0
  for (const g of geos) {
    const pPos = g.attributes.position as THREE.BufferAttribute
    const pNor = g.attributes.normal as THREE.BufferAttribute
    const pUv = g.attributes.uv as THREE.BufferAttribute
    pos.set(pPos.array as unknown as ArrayLike<number>, vOff * 3)
    nor.set(pNor.array as unknown as ArrayLike<number>, vOff * 3)
    uv.set(pUv.array as unknown as ArrayLike<number>, vOff * 2)
    if (col) {
      const pCol = g.attributes.color as THREE.BufferAttribute
      col.set(pCol.array as unknown as ArrayLike<number>, vOff * 3)
    }
    const gIndex = g.index
    if (gIndex) {
      const src = gIndex.array as unknown as ArrayLike<number>
      for (let i = 0; i < gIndex.count; i += 1) idx[iOff + i] = vOff + Number(src[i])
      iOff += gIndex.count
    }
    vOff += pPos.count
    g.dispose()
  }
  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  if (col) merged.setAttribute('color', new THREE.BufferAttribute(col, 3))
  merged.setIndex(new THREE.BufferAttribute(idx, 1))
  return merged
}

const CAP_COLOR = new THREE.Color(CAP)

// Detail-pass-2 accent colors (hardcoded, not tokens — the model-lane rule
// forbids new tokens; nearest-token kin noted where one exists).
const RIM_ALU = '#8E949D' // brushed aluminum (no token aluminum exists)
const STAB_BAR = '#4B5563' // stabilizer steel (no token exists)
const LEGEND_LIT = '#D7DBE0' // cap-legend silkscreen (no token exists)
const LEGEND_DIM = '#5B6068'
const MEDIA_LIT = '#BAE6FD' // media hints, near --z-highlight-blue
const MEDIA_DIM = '#3E4A5A'
const KNOB_NOTCH = '#E8EAED' // indicator notch (no token exists)
const USBC_TONGUE = '#9AA0A8' // connector tongue metal (no token exists)
const BRAID = '#23262C' // braided sleeve (no token exists)
// Per-zone RGB washes: function row ice-blue, WASD near --z-status-green,
// arrows near --z-marker-yellow.
const ZONE_FN = '#7DD3FC'
const ZONE_WASD = '#34D399'
const ZONE_ARROWS = '#FBBF24'

// Detail pass 2 (Task 29e) instancing budgets — 13 new draws (12 → 25, cap
// 120): legends, stabilizers, media hints, braid rings, tilt legs (one
// instancedMesh each), knob + notch, USB-C + tongue, rim (one merged mesh),
// three zone washes.
const LEGEND_SIZE = 0.032
const LEGEND_Y = CAP_Y + CAP_H / 2 + 0.002
const STAB_Y = CAP_Y - CAP_H / 2 - 0.009
// Alphanumeric 1u caps in the four staggered rows only: 13 + 12 + 11 + 10.
const LEGEND_KEYS = KEYS.filter(
  (k) => k.row >= 1 && k.row <= 4 && Math.abs(k.w - (PX - GAP)) < 1e-9
)
export const LEGEND_COUNT = LEGEND_KEYS.length
// Wide keys (≥2u): backspace, enter, both shifts, spacebar.
const STAB_KEYS = KEYS.filter((k) => k.w >= 2 * PX - GAP - 1e-9)
export const STAB_COUNT = STAB_KEYS.length
// First four function-row caps carry media-key hint bars.
const MEDIA_KEYS = KEYS.filter((k) => k.row === 0).slice(0, 4)
export const MEDIA_COUNT = MEDIA_KEYS.length
const BRAID_N = 8
const TILT_LEG_XS = [-0.9, 0.9]
export const TILT_LEG_COUNT = TILT_LEG_XS.length

// Aluminum top-frame rim: four rails merged into ONE geometry (one draw).
const RIM_Y = 0.16
const rimGeometry = mergeBoxes(
  [
    { w: 0.03, h: 0.02, d: 1.02, x: -1.385, y: RIM_Y, z: 0, color: null },
    { w: 0.03, h: 0.02, d: 1.02, x: 1.385, y: RIM_Y, z: 0, color: null },
    { w: 2.8, h: 0.02, d: 0.03, x: 0, y: RIM_Y, z: -0.495, color: null },
    { w: 2.8, h: 0.02, d: 0.03, x: 0, y: RIM_Y, z: 0.495, color: null }
  ],
  false
)

type FillItem = {
  p: [number, number, number]
  rx?: number
  sx?: number
}

// All 76 caps in one mesh; the function row rides 0.035 higher.
const capGeometry = mergeBoxes(
  KEYS.map((k) => ({
    w: k.w,
    h: CAP_H,
    d: k.d,
    x: k.x,
    y: CAP_Y + k.lift,
    z: k.z,
    color: CAP_COLOR
  })),
  false
)

// Translucent pudding skirts just below the caps, one vertex color per key.
const glowGeometry = mergeBoxes(
  KEYS.map((k) => ({
    w: k.w + 0.006,
    h: GLOW_H,
    d: k.d + 0.006,
    x: k.x,
    y: GLOW_Y + k.lift,
    z: k.z,
    color: glowColorFor(k.x, k.row)
  })),
  true
)

// Coiled-cable pigtail stub at the top edge: a short helix rising behind the
// chassis. The integration lane connects the full cable from here.
const cableCurve = (() => {
  const pts: THREE.Vector3[] = [new THREE.Vector3(-1.0, 0.1, -0.5)]
  const turns = 2.5
  const steps = 40
  for (let i = 0; i <= steps; i += 1) {
    const f = i / steps
    const a = f * turns * Math.PI * 2
    pts.push(
      new THREE.Vector3(-1.0 + 0.03 * Math.cos(a), 0.12 + f * 0.18, -0.515 + 0.03 * Math.sin(a))
    )
  }
  return new THREE.CatmullRomCurve3(pts)
})()
const cableGeometry = new THREE.TubeGeometry(cableCurve, 64, 0.011, 8, false)

const FEET: Array<[number, number]> = [
  [-1.25, -0.42],
  [1.25, -0.42],
  [-1.25, 0.42],
  [1.25, 0.42]
]

function KeyboardInner({
  status,
  dimmed
}: {
  status: KeyboardStatus
  dimmed: boolean
}): React.JSX.Element {
  const bodyOpacity = dimmed ? 0.35 : 1
  const statusGlow = dimmed ? 0.15 : 1.6
  const glowOpacity = dimmed ? 0.5 : 1
  const washOpacity = dimmed ? 0.06 : 0.3
  const legendOpacity = dimmed ? 0.5 : 1

  // Instanced repeated parts (legend quads, stabilizer bars, media hints,
  // braid rings, tilt legs). Same harness as the iPhone/ESP32 lanes: the
  // `typeof setMatrixAt` guard no-ops under the mock-DOM unit render, where
  // refs are plain elements instead of THREE objects. useLayoutEffect +
  // demand invalidate(): matrices fill before paint, and the global
  // invalidate() no-ops when no Canvas is mounted.
  const legendsRef = useRef<THREE.InstancedMesh | null>(null)
  const stabRef = useRef<THREE.InstancedMesh | null>(null)
  const mediaRef = useRef<THREE.InstancedMesh | null>(null)
  const braidRef = useRef<THREE.InstancedMesh | null>(null)
  const tiltRef = useRef<THREE.InstancedMesh | null>(null)

  useLayoutEffect(() => {
    const dummy = new THREE.Object3D()
    const fill = (mesh: THREE.InstancedMesh | null, items: FillItem[]): void => {
      if (mesh === null || typeof mesh.setMatrixAt !== 'function') return
      items.forEach((item, i) => {
        dummy.position.set(item.p[0], item.p[1], item.p[2])
        dummy.rotation.set(item.rx ?? 0, 0, 0)
        dummy.scale.set(item.sx ?? 1, 1, 1)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
      })
      mesh.instanceMatrix.needsUpdate = true
    }
    fill(
      legendsRef.current,
      LEGEND_KEYS.map((k) => ({ p: [k.x, LEGEND_Y + k.lift, k.z], rx: -Math.PI / 2 }))
    )
    fill(
      stabRef.current,
      STAB_KEYS.map((k) => ({ p: [k.x, STAB_Y + k.lift, k.z], sx: k.w * 0.72 }))
    )
    fill(
      mediaRef.current,
      MEDIA_KEYS.map((k) => ({ p: [k.x, LEGEND_Y + k.lift, k.z], rx: -Math.PI / 2 }))
    )
    fill(
      braidRef.current,
      Array.from(
        { length: BRAID_N },
        (_, i) => ({ p: [-1.0, 0.125 + i * 0.011, -0.513], rx: Math.PI / 2 }) as FillItem
      )
    )
    fill(
      tiltRef.current,
      TILT_LEG_XS.map((x) => ({ p: [x, 0.045, -0.36], rx: -0.45 }) as FillItem)
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

  return (
    <group position={[0, 0, 0]}>
      {/* soft fake contact shadow — the integration lane owns real lights */}
      <mesh
        name="base-shadow"
        rotation-x={-Math.PI / 2}
        position={[0, 0.002, 0]}
        scale={[1.6, 0.75, 1]}
      >
        <circleGeometry args={[1, 40]} />
        <meshBasicMaterial color={NEAR_BLACK} transparent opacity={0.22} depthWrite={false} />
      </mesh>

      {/* whole board tilts: front edge (+Z, typist side) lower */}
      <group name="board" rotation-x={TILT}>
        {/* low-profile dark chassis slab */}
        <mesh name="chassis" data-testid="keyboard-chassis" position={[0, 0.09, 0]}>
          <boxGeometry args={[2.8, 0.12, 1.02]} />
          <meshStandardMaterial
            data-testid="keyboard-chassis-material"
            color={CHASSIS}
            roughness={0.5}
            metalness={0.4}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>

        {/* rubber feet */}
        {FEET.map(([x, z], i) => (
          <mesh key={i} name={`foot-${i}`} position={[x, 0.015, z]}>
            <cylinderGeometry args={[0.045, 0.045, 0.03, 12]} />
            <meshStandardMaterial
              color={NEAR_BLACK}
              roughness={0.8}
              metalness={0.1}
              transparent={dimmed}
              opacity={bodyOpacity}
            />
          </mesh>
        ))}

        {/* flip-out tilt legs under the rear edge (one instanced draw) */}
        <instancedMesh
          name="tilt-legs"
          data-testid="keyboard-tilt-legs"
          data-count={TILT_LEG_COUNT}
          ref={tiltRef}
          args={[undefined, undefined, TILT_LEG_COUNT]}
          frustumCulled={false}
        >
          <boxGeometry args={[0.2, 0.022, 0.13]} />
          <meshStandardMaterial
            color={NEAR_BLACK}
            roughness={0.8}
            metalness={0.1}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </instancedMesh>

        {/* all 76 keycaps in a single draw call (KEY_COUNT exported beside the
            component; no data-key-count attribute — R3F pierces a second
            data-* prop on the same object into the first one's expando and
            throws, so each three object owns at most one data-* prop) */}
        <mesh name="keycaps" data-testid="keyboard-keycaps" geometry={capGeometry}>
          <meshStandardMaterial
            data-testid="keyboard-keycaps-material"
            color={CAP}
            roughness={0.55}
            metalness={0.15}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>

        {/* per-key RGB underglow skirts (vertex colors), one draw call */}
        <mesh name="keyglow" data-testid="keyboard-keyglow" geometry={glowGeometry}>
          <meshBasicMaterial
            data-testid="keyboard-keyglow-material"
            vertexColors
            color={dimmed ? '#575064' : '#FFFFFF'}
            transparent={dimmed}
            opacity={glowOpacity}
            toneMapped={false}
          />
        </mesh>

        {/* aluminum top-frame rim around the key field (one merged mesh) */}
        <mesh name="rim" data-testid="keyboard-rim" geometry={rimGeometry}>
          <meshStandardMaterial
            color={RIM_ALU}
            roughness={0.35}
            metalness={0.8}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>

        {/* per-key legend glyphs: tiny emissive quads on alphanumeric caps
            only (no textures; one instanced draw) */}
        <instancedMesh
          name="legends"
          data-testid="keyboard-legends"
          data-count={LEGEND_COUNT}
          ref={legendsRef}
          args={[undefined, undefined, LEGEND_COUNT]}
          frustumCulled={false}
        >
          <planeGeometry args={[LEGEND_SIZE, LEGEND_SIZE]} />
          <meshBasicMaterial
            data-testid="keyboard-legends-material"
            color={dimmed ? LEGEND_DIM : LEGEND_LIT}
            transparent={dimmed}
            opacity={legendOpacity}
            toneMapped={false}
          />
        </instancedMesh>

        {/* stabilizer hint bars under wide keys (one instanced draw) */}
        <instancedMesh
          name="stabilizers"
          data-testid="keyboard-stabilizers"
          data-count={STAB_COUNT}
          ref={stabRef}
          args={[undefined, undefined, STAB_COUNT]}
          frustumCulled={false}
        >
          <boxGeometry args={[1, 0.014, 0.014]} />
          <meshStandardMaterial
            color={STAB_BAR}
            roughness={0.6}
            metalness={0.3}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </instancedMesh>

        {/* media-key hint bars on the first four function-row caps */}
        <instancedMesh
          name="media-hints"
          data-testid="keyboard-media-hints"
          data-count={MEDIA_COUNT}
          ref={mediaRef}
          args={[undefined, undefined, MEDIA_COUNT]}
          frustumCulled={false}
        >
          <planeGeometry args={[0.05, 0.014]} />
          <meshBasicMaterial
            data-testid="keyboard-media-material"
            color={dimmed ? MEDIA_DIM : MEDIA_LIT}
            transparent={dimmed}
            opacity={legendOpacity}
            toneMapped={false}
          />
        </instancedMesh>

        {/* per-zone RGB washes: function row, WASD cluster, arrows */}
        <mesh
          name="zone-fn"
          data-testid="keyboard-zone-fn"
          rotation-x={-Math.PI / 2}
          position={[0, 0.1535, -0.375]}
        >
          <planeGeometry args={[2.58, 0.11]} />
          <meshBasicMaterial
            data-testid="keyboard-zone-fn-material"
            color={ZONE_FN}
            transparent
            opacity={washOpacity}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <mesh
          name="zone-wasd"
          data-testid="keyboard-zone-wasd"
          rotation-x={-Math.PI / 2}
          position={[-0.69, 0.154, -0.005]}
        >
          <planeGeometry args={[0.56, 0.34]} />
          <meshBasicMaterial
            data-testid="keyboard-zone-wasd-material"
            color={ZONE_WASD}
            transparent
            opacity={washOpacity}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <mesh
          name="zone-arrows"
          data-testid="keyboard-zone-arrows"
          rotation-x={-Math.PI / 2}
          position={[0.73, 0.1545, 0.29]}
        >
          <planeGeometry args={[0.56, 0.3]} />
          <meshBasicMaterial
            data-testid="keyboard-zone-arrows-material"
            color={ZONE_ARROWS}
            transparent
            opacity={washOpacity}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>

        {/* soft emissive wash beneath the key field */}
        <mesh name="underglow" rotation-x={-Math.PI / 2} position={[0, 0.152, -0.005]}>
          <planeGeometry args={[2.62, 0.88]} />
          <meshBasicMaterial
            data-testid="keyboard-underglow-material"
            color={UNDERGLOW}
            transparent
            opacity={washOpacity}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>

        {/* coiled-cable pigtail stub at the top edge */}
        <mesh name="cable-stub" data-testid="keyboard-cable-stub" geometry={cableGeometry}>
          <meshStandardMaterial
            color={NEAR_BLACK}
            roughness={0.6}
            metalness={0.2}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>
        <mesh name="cable-plug" position={[-1.0, 0.16, -0.5]}>
          <boxGeometry args={[0.08, 0.06, 0.1]} />
          <meshStandardMaterial
            color={NEAR_BLACK}
            roughness={0.6}
            metalness={0.2}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>

        {/* braided-sleeve hint: segmented rings around the rising coil */}
        <instancedMesh
          name="braid-rings"
          data-testid="keyboard-braid-rings"
          data-count={BRAID_N}
          ref={braidRef}
          args={[undefined, undefined, BRAID_N]}
          frustumCulled={false}
        >
          <torusGeometry args={[0.045, 0.004, 6, 20]} />
          <meshStandardMaterial
            color={BRAID}
            roughness={0.7}
            metalness={0.2}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </instancedMesh>

        {/* rotary volume knob on the top-right bezel + indicator notch */}
        <mesh name="knob" data-testid="keyboard-knob" position={[1.345, 0.1775, -0.28]}>
          <cylinderGeometry args={[0.045, 0.048, 0.055, 24]} />
          <meshStandardMaterial
            color={CAP}
            roughness={0.5}
            metalness={0.4}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>
        <mesh name="knob-notch" position={[1.345, 0.207, -0.26]}>
          <boxGeometry args={[0.01, 0.006, 0.03]} />
          <meshBasicMaterial
            color={KNOB_NOTCH}
            transparent={dimmed}
            opacity={legendOpacity}
            toneMapped={false}
          />
        </mesh>

        {/* USB-C port recess on the top edge + connector tongue */}
        <mesh name="usb-c" data-testid="keyboard-usb-c" position={[0.9, 0.09, -0.505]}>
          <boxGeometry args={[0.1, 0.035, 0.03]} />
          <meshStandardMaterial
            color={NEAR_BLACK}
            roughness={0.6}
            metalness={0.2}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>
        <mesh name="usb-c-tongue" position={[0.9, 0.09, -0.518]}>
          <boxGeometry args={[0.07, 0.012, 0.012]} />
          <meshStandardMaterial
            color={USBC_TONGUE}
            roughness={0.4}
            metalness={0.7}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>

        {/* small status LED on the top-right bezel, driven by node status */}
        <mesh
          name="status-light"
          data-testid="keyboard-status-light"
          position={[1.315, 0.1625, -0.44]}
        >
          <boxGeometry args={[0.07, 0.025, 0.035]} />
          <meshStandardMaterial
            data-testid="keyboard-status-material"
            color={NEAR_BLACK}
            emissive={STATUS_HEX[status]}
            emissiveIntensity={statusGlow}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>
      </group>
    </group>
  )
}

// RGB mechanical keyboard, centered at the origin, front (+Z, typist side)
// facing the viewer, standing on y=0. No lights, no textures, no frame loop
// of its own — the integration lane owns the Canvas, lights and
// frameloop="demand".
function Keyboard({ status, dimmed = false, scale = 1 }: KeyboardProps): React.JSX.Element {
  return (
    <group data-testid="keyboard" scale={scale}>
      <KeyboardInner status={status} dimmed={dimmed} />
    </group>
  )
}

export default memo(Keyboard)
