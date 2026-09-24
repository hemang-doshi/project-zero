/* eslint-disable react/no-unknown-property -- R3F three intrinsics (position, rotation, scale, args, geometry, material, color, emissive, …) that the DOM property allowlist cannot know. Scoped to this model file only. */
/* eslint-disable react-refresh/only-export-components -- binding model-lane contract: MODEL_FOOTPRINT + STATUS_HEX must live beside the component. */
import { memo, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

export type MacBookStatus = 'online' | 'suspect' | 'offline' | 'gated'

export type MacBookAirProps = {
  status: MacBookStatus
  dimmed?: boolean
  scale?: number
}

// Status light colors. Stitch token hexes hardcoded per the model-lane rule
// (no new tokens): --z-status-green, --z-marker-yellow, --z-secondary-ink
// (offline gray-brown), --z-error-red.
export const STATUS_HEX: Record<MacBookStatus, string> = {
  online: '#10B981',
  suspect: '#F7DF94',
  offline: '#5C4038',
  gated: '#DC2626'
}

// Bounding size in scene units of the unscaled model (lid open ~102°).
// Proportions follow the real M4 MacBook Air 13.6" (304.1 × 215 × 11.3 mm):
// width 3.0, open height ~2.13, open depth ~2.5 (lid leans back past the hinge).
export const MODEL_FOOTPRINT = { w: 3.0, h: 2.13, d: 2.5 }

// Plain aluminum silver-gray (no token silver exists — hardcoded, not a token).
const ALUMINUM = '#C6CACF'
const ALUMINUM_LIGHT = '#D4D8DD'
const DARK_TRIM = '#23262B'
const NEAR_BLACK = '#101216'
// Rubber display gasket gray (hardcoded, not a token).
const GASKET = '#2A2E34'
// Key backlight bleed, cool white (hardcoded, not a token).
const BACKLIGHT = '#C7D6F5'
// Camera lens glint, deep blue (hardcoded, not a token).
const LENS = '#1D4ED8'
// Screen tints from Stitch tokens: --z-ink base, --z-highlight-blue glow,
// --z-card-cream / --z-nav-cream desktop windows, --z-brand-orange dock dot.
const SCREEN_BASE = '#191C20'
const SCREEN_GLOW = '#3B82F6'
const WINDOW_A = '#FAF8F5'
const WINDOW_B = '#F3ECDF'
const DOCK_DOT = '#F54E00'

const DECK_W = 3.0
const DECK_D = 2.05
const DECK_HALF_D = DECK_D / 2
const FOOT_H = 0.03
const DECK_TOP_FRONT = 0.11
const DECK_TOP_BACK = 0.17
const HINGE_Z = -1.0
const LID_H = 2.0
const LID_T = 0.09
// Lid opened ~102° from the closed position = 12° back past vertical.
const LID_TILT = -THREE.MathUtils.degToRad(12)
// Deck top rises 0.06 over 2.05 of depth; furniture rides this slope.
const DECK_SLOPE = Math.atan2(DECK_TOP_BACK - DECK_TOP_FRONT, DECK_D)
// Recenters the open-laptop depth (front lip +1.025, lid top ≈ −1.46)
// so the model sits centered at the origin.
const CENTER_Z = 0.22

const KEY_COLS = 14
const KEY_ROWS = [-0.7, -0.51, -0.32, -0.13, 0.06]
const KEY_PITCH = 0.19
const KEY_X0 = -((KEY_COLS - 1) * KEY_PITCH) / 2
const KEY_COUNT = KEY_ROWS.length * KEY_COLS
const FN_KEYS = 12
const FN_PITCH = 0.215
const FN_X0 = -((FN_KEYS - 1) * FN_PITCH) / 2
const FN_Z = -0.88
// Touch ID sits one pitch past the last function key, like the real Air.
const TOUCH_ID_X = FN_X0 + FN_KEYS * FN_PITCH

// Speaker grilles flank the keyboard: dark recess strip + perforation dots.
const GRILLE_X = 1.4
const GRILLE_DOT_COLS = [-0.05, 0, 0.05]
const GRILLE_ROWS = 16
const GRILLE_Z0 = -0.72
const GRILLE_Z1 = 0.32
const GRILLE_DOTS = GRILLE_DOT_COLS.length * GRILLE_ROWS

// Bottom-case pentalobe screws around the perimeter (the M4 Air is fanless,
// so screws — not vent slots — are the correct bottom detail).
const SCREW_SPOTS: Array<[number, number]> = [
  [-1.35, -0.9],
  [1.35, -0.9],
  [-1.35, 0],
  [1.35, 0],
  [-1.35, 0.9],
  [1.35, 0.9],
  [-0.65, -0.9],
  [0.65, -0.9]
]

const DOCK_ICONS = 6
const MENUBAR_DOTS = 3

function MacBookAirInner({
  status,
  dimmed
}: {
  status: MacBookStatus
  dimmed: boolean
}): React.JSX.Element {
  const deckProfile = useMemo(() => {
    // Side profile (x = world depth, y = height): thin front lip, thick hinge.
    const s = new THREE.Shape()
    s.moveTo(DECK_HALF_D, FOOT_H)
    s.lineTo(-DECK_HALF_D, FOOT_H)
    s.lineTo(-DECK_HALF_D, DECK_TOP_BACK)
    s.lineTo(DECK_HALF_D, DECK_TOP_FRONT)
    s.closePath()
    return s
  }, [])

  // Instanced repeated parts (keycaps, grille dots, screws, screen glyphs).
  // Same harness as TopologyScene breadboard-dots: the `typeof setMatrixAt`
  // guard no-ops under the mock-DOM unit render, where refs are plain
  // elements instead of THREE objects.
  const keycapsRef = useRef<THREE.InstancedMesh | null>(null)
  const fnKeysRef = useRef<THREE.InstancedMesh | null>(null)
  const grilleLeftRef = useRef<THREE.InstancedMesh | null>(null)
  const grilleRightRef = useRef<THREE.InstancedMesh | null>(null)
  const screwsRef = useRef<THREE.InstancedMesh | null>(null)
  const dockIconsRef = useRef<THREE.InstancedMesh | null>(null)
  const menubarDotsRef = useRef<THREE.InstancedMesh | null>(null)

  useEffect(() => {
    const dummy = new THREE.Object3D()
    const fill = (
      mesh: THREE.InstancedMesh | null,
      positions: Array<[number, number, number]>
    ): void => {
      if (mesh === null || typeof mesh.setMatrixAt !== 'function') return
      positions.forEach(([x, y, z], i) => {
        dummy.position.set(x, y, z)
        dummy.rotation.set(0, 0, 0)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
      })
      mesh.instanceMatrix.needsUpdate = true
    }
    const keys: Array<[number, number, number]> = []
    for (const rz of KEY_ROWS) {
      for (let c = 0; c < KEY_COLS; c++) keys.push([KEY_X0 + c * KEY_PITCH, 0.022, rz])
    }
    fill(keycapsRef.current, keys)
    fill(
      fnKeysRef.current,
      Array.from(
        { length: FN_KEYS },
        (_, c) => [FN_X0 + c * FN_PITCH, 0.02, FN_Z] as [number, number, number]
      )
    )
    const grilleDots = (sx: number): Array<[number, number, number]> => {
      const dots: Array<[number, number, number]> = []
      for (let r = 0; r < GRILLE_ROWS; r++) {
        const z = GRILLE_Z0 + ((GRILLE_Z1 - GRILLE_Z0) * r) / (GRILLE_ROWS - 1)
        for (const dx of GRILLE_DOT_COLS) dots.push([sx + dx, 0.004, z])
      }
      return dots
    }
    fill(grilleLeftRef.current, grilleDots(-GRILLE_X))
    fill(grilleRightRef.current, grilleDots(GRILLE_X))
    fill(
      screwsRef.current,
      SCREW_SPOTS.map(([x, z]) => [x, 0.028, z] as [number, number, number])
    )
    fill(
      dockIconsRef.current,
      Array.from(
        { length: DOCK_ICONS },
        (_, i) => [-0.35 + i * 0.14, 0.24, 0.032] as [number, number, number]
      )
    )
    fill(
      menubarDotsRef.current,
      Array.from(
        { length: MENUBAR_DOTS },
        (_, i) => [1.08 + i * 0.11, 1.8, 0.032] as [number, number, number]
      )
    )
  }, [])

  const bodyOpacity = dimmed ? 0.35 : 1
  const screenGlow = dimmed ? 0.05 : 0.7
  const desktopGlow = dimmed ? 0.03 : 0.5
  const statusGlow = dimmed ? 0.15 : 1.6
  const backlightGlow = dimmed ? 0.02 : 0.35
  const glyphGlow = dimmed ? 0.04 : 0.75

  return (
    <group position={[0, 0, CENTER_Z]}>
      {/* soft fake contact shadow — the integration lane owns real lights */}
      <mesh
        name="base-shadow"
        rotation-x={-Math.PI / 2}
        position={[0, 0.002, -0.2]}
        scale={[1.9, 1.45, 1]}
      >
        <circleGeometry args={[1, 40]} />
        <meshBasicMaterial color={SCREEN_BASE} transparent opacity={0.22} depthWrite={false} />
      </mesh>

      {/* rubber feet */}
      {[
        [-1.2, -0.8],
        [1.2, -0.8],
        [-1.2, 0.8],
        [1.2, 0.8]
      ].map(([x, z], i) => (
        <mesh key={i} name={`foot-${i}`} position={[x, FOOT_H / 2, z]}>
          <cylinderGeometry args={[0.06, 0.06, FOOT_H, 12]} />
          <meshStandardMaterial color={NEAR_BLACK} roughness={0.8} metalness={0.1} />
        </mesh>
      ))}

      {/* tapered wedge chassis: thin front lip, thicker at the hinge */}
      <mesh
        name="deck"
        data-testid="macbook-deck"
        rotation-y={-Math.PI / 2}
        position={[DECK_W / 2, 0, 0]}
      >
        <extrudeGeometry args={[deckProfile, { depth: DECK_W, bevelEnabled: false }]} />
        <meshStandardMaterial
          data-testid="macbook-deck-material"
          color={ALUMINUM}
          metalness={0.9}
          roughness={0.35}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>

      {/* bottom-case screws (fanless Air: no vent slots to hint) */}
      <instancedMesh
        name="case-screws"
        data-testid="macbook-screws"
        ref={screwsRef}
        args={[undefined, undefined, SCREW_SPOTS.length]}
        frustumCulled={false}
      >
        <cylinderGeometry args={[0.022, 0.022, 0.01, 10]} />
        <meshStandardMaterial color={DARK_TRIM} roughness={0.5} metalness={0.6} />
      </instancedMesh>

      {/* deck furniture rides the wedge slope */}
      <group position={[0, 0.14, 0]} rotation-x={DECK_SLOPE}>
        {/* keyboard deck */}
        <group name="keyboard" data-testid="macbook-keyboard">
          {/* subtle backlight bleed between the caps */}
          <mesh name="keyboard-backlight" rotation-x={-Math.PI / 2} position={[0, 0.0025, -0.39]}>
            <planeGeometry args={[2.66, 1.1]} />
            <meshStandardMaterial
              data-testid="macbook-backlight-material"
              color={NEAR_BLACK}
              emissive={BACKLIGHT}
              emissiveIntensity={backlightGlow}
            />
          </mesh>
          {/* 70 main keycaps with real gaps (pitch 0.19 vs cap 0.16) */}
          <instancedMesh
            name="keycaps-main"
            data-testid="macbook-keycaps"
            ref={keycapsRef}
            args={[undefined, undefined, KEY_COUNT]}
            frustumCulled={false}
          >
            <boxGeometry args={[0.16, 0.035, 0.16]} />
            <meshStandardMaterial
              color={DARK_TRIM}
              roughness={0.6}
              metalness={0.4}
              transparent={dimmed}
              opacity={bodyOpacity}
            />
          </instancedMesh>
          {/* separated function-row caps (pitch 0.215 vs cap 0.175) */}
          <instancedMesh
            name="keycaps-fn"
            data-testid="macbook-fn-keys"
            ref={fnKeysRef}
            args={[undefined, undefined, FN_KEYS]}
            frustumCulled={false}
          >
            <boxGeometry args={[0.175, 0.03, 0.09]} />
            <meshStandardMaterial
              color={DARK_TRIM}
              roughness={0.6}
              metalness={0.4}
              transparent={dimmed}
              opacity={bodyOpacity}
            />
          </instancedMesh>
          {/* Touch ID key: sapphire cap + steel ring at the fn-row end */}
          <mesh name="touch-id" data-testid="macbook-touch-id" position={[TOUCH_ID_X, 0.02, FN_Z]}>
            <boxGeometry args={[0.16, 0.03, 0.12]} />
            <meshStandardMaterial
              color={DARK_TRIM}
              roughness={0.25}
              metalness={0.7}
              transparent={dimmed}
              opacity={bodyOpacity}
            />
          </mesh>
          <mesh name="touch-id-ring" rotation-x={-Math.PI / 2} position={[TOUCH_ID_X, 0.004, FN_Z]}>
            <torusGeometry args={[0.088, 0.005, 8, 24]} />
            <meshStandardMaterial
              color={ALUMINUM_LIGHT}
              roughness={0.3}
              metalness={0.9}
              transparent={dimmed}
              opacity={bodyOpacity}
            />
          </mesh>
        </group>

        {/* speaker grilles flanking the keyboard: recess + perforation dots */}
        {[-GRILLE_X, GRILLE_X].map((sx) => (
          <mesh
            key={sx}
            name={sx < 0 ? 'speaker-grille-left' : 'speaker-grille-right'}
            rotation-x={-Math.PI / 2}
            position={[sx, 0.002, -0.2]}
          >
            <planeGeometry args={[0.16, 1.1]} />
            <meshStandardMaterial
              color={NEAR_BLACK}
              roughness={0.7}
              metalness={0.2}
              transparent={dimmed}
              opacity={bodyOpacity}
            />
          </mesh>
        ))}
        <instancedMesh
          name="speaker-dots-left"
          data-testid="macbook-grille-left"
          ref={grilleLeftRef}
          args={[undefined, undefined, GRILLE_DOTS]}
          frustumCulled={false}
        >
          <cylinderGeometry args={[0.0085, 0.0085, 0.005, 8]} />
          <meshStandardMaterial color={DARK_TRIM} roughness={0.6} metalness={0.4} />
        </instancedMesh>
        <instancedMesh
          name="speaker-dots-right"
          data-testid="macbook-grille-right"
          ref={grilleRightRef}
          args={[undefined, undefined, GRILLE_DOTS]}
          frustumCulled={false}
        >
          <cylinderGeometry args={[0.0085, 0.0085, 0.005, 8]} />
          <meshStandardMaterial color={DARK_TRIM} roughness={0.6} metalness={0.4} />
        </instancedMesh>

        {/* trackpad border seam peeking around the pad */}
        <mesh name="trackpad-seam" rotation-x={-Math.PI / 2} position={[0, 0.001, 0.62]}>
          <planeGeometry args={[1.09, 0.72]} />
          <meshStandardMaterial
            color={NEAR_BLACK}
            roughness={0.7}
            metalness={0.2}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>
        {/* large trackpad */}
        <mesh name="trackpad" data-testid="macbook-trackpad" position={[0, 0.009, 0.62]}>
          <boxGeometry args={[1.05, 0.014, 0.68]} />
          <meshStandardMaterial
            color={ALUMINUM_LIGHT}
            metalness={0.85}
            roughness={0.4}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>

        {/* status light near the front-right corner */}
        <mesh name="status-light" data-testid="macbook-status-light" position={[1.32, 0.025, 0.88]}>
          <sphereGeometry args={[0.045, 16, 12]} />
          <meshStandardMaterial
            data-testid="macbook-status-material"
            color={NEAR_BLACK}
            emissive={STATUS_HEX[status]}
            emissiveIntensity={statusGlow}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>
      </group>

      {/* left edge, back to front: MagSafe 3 + 2× Thunderbolt/USB-C */}
      <mesh name="port-magsafe" position={[-DECK_W / 2 - 0.005, 0.1, -0.55]}>
        <boxGeometry args={[0.03, 0.05, 0.3]} />
        <meshStandardMaterial color={NEAR_BLACK} roughness={0.7} metalness={0.2} />
      </mesh>
      <mesh name="port-magsafe-insert" position={[-DECK_W / 2 - 0.021, 0.1, -0.55]}>
        <boxGeometry args={[0.008, 0.028, 0.2]} />
        <meshStandardMaterial color={ALUMINUM_LIGHT} roughness={0.4} metalness={0.7} />
      </mesh>
      {[-0.1, 0.3].map((z, i) => (
        <mesh key={i} name={`port-usbc-${i}`} position={[-DECK_W / 2 - 0.005, 0.1, z]}>
          <boxGeometry args={[0.03, 0.05, 0.18]} />
          <meshStandardMaterial color={NEAR_BLACK} roughness={0.7} metalness={0.2} />
        </mesh>
      ))}
      {/* right edge: 3.5 mm headphone jack */}
      <mesh name="port-headphone-right" position={[DECK_W / 2 + 0.005, 0.1, 0.45]}>
        <cylinderGeometry args={[0.032, 0.032, 0.025, 16]} />
        <meshStandardMaterial color={NEAR_BLACK} roughness={0.7} metalness={0.2} />
      </mesh>

      {/* hinge barrel along the back edge */}
      <mesh name="hinge-barrel" data-testid="macbook-hinge" position={[0, 0.145, -1.03]}>
        <cylinderGeometry args={[0.045, 0.045, 2.6, 16]} />
        <meshStandardMaterial
          color={ALUMINUM}
          metalness={0.9}
          roughness={0.35}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>

      {/* hinged lid opened ~102°, front facing +Z */}
      <group position={[0, DECK_TOP_BACK, HINGE_Z]} rotation-x={LID_TILT}>
        <mesh name="lid" data-testid="macbook-lid" position={[0, LID_H / 2, -0.02]}>
          <boxGeometry args={[DECK_W, LID_H, LID_T]} />
          <meshStandardMaterial
            color={ALUMINUM}
            metalness={0.9}
            roughness={0.35}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>
        {/* thin black bezel */}
        <mesh name="lid-bezel" position={[0, LID_H / 2, 0.026]}>
          <planeGeometry args={[2.94, 1.9]} />
          <meshStandardMaterial
            color={NEAR_BLACK}
            roughness={0.5}
            metalness={0.3}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>
        {/* rubber gasket ringing the display */}
        <mesh name="display-gasket" data-testid="macbook-gasket" position={[0, LID_H / 2, 0.027]}>
          <planeGeometry args={[2.9, 1.86]} />
          <meshStandardMaterial
            color={GASKET}
            roughness={0.8}
            metalness={0.1}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>
        {/* glowing 13.6" 16:10 screen face */}
        <mesh name="screen" data-testid="macbook-screen" position={[0, LID_H / 2, 0.028]}>
          <planeGeometry args={[2.86, 1.78]} />
          <meshStandardMaterial
            data-testid="macbook-screen-material"
            color={SCREEN_BASE}
            emissive={SCREEN_GLOW}
            emissiveIntensity={screenGlow}
          />
        </mesh>
        {/* desktop hints: menu bar, two windows, dock + dock dot */}
        <mesh name="screen-menubar" position={[0, 1.8, 0.03]}>
          <planeGeometry args={[2.86, 0.09]} />
          <meshStandardMaterial
            color={SCREEN_BASE}
            emissive={SCREEN_GLOW}
            emissiveIntensity={dimmed ? 0.08 : 0.9}
          />
        </mesh>
        {/* menu-bar status glyphs, top right */}
        <instancedMesh
          name="menubar-dots"
          data-testid="macbook-menubar-dots"
          ref={menubarDotsRef}
          args={[undefined, undefined, MENUBAR_DOTS]}
          frustumCulled={false}
        >
          <planeGeometry args={[0.045, 0.045]} />
          <meshStandardMaterial
            color={SCREEN_BASE}
            emissive={WINDOW_A}
            emissiveIntensity={glyphGlow}
          />
        </instancedMesh>
        <mesh name="screen-window-a" position={[-0.6, 1.25, 0.031]}>
          <planeGeometry args={[1.3, 0.9]} />
          <meshStandardMaterial
            color={SCREEN_BASE}
            emissive={WINDOW_A}
            emissiveIntensity={desktopGlow}
          />
        </mesh>
        <mesh name="screen-window-b" position={[0.85, 1.05, 0.031]}>
          <planeGeometry args={[0.9, 0.7]} />
          <meshStandardMaterial
            color={SCREEN_BASE}
            emissive={WINDOW_B}
            emissiveIntensity={desktopGlow}
          />
        </mesh>
        <mesh name="screen-dock" position={[0, 0.24, 0.031]}>
          <planeGeometry args={[1.6, 0.12]} />
          <meshStandardMaterial
            color={SCREEN_BASE}
            emissive={SCREEN_GLOW}
            emissiveIntensity={dimmed ? 0.06 : 0.65}
          />
        </mesh>
        {/* dock app glyphs */}
        <instancedMesh
          name="dock-icons"
          data-testid="macbook-dock-icons"
          ref={dockIconsRef}
          args={[undefined, undefined, DOCK_ICONS]}
          frustumCulled={false}
        >
          <planeGeometry args={[0.07, 0.07]} />
          <meshStandardMaterial
            color={SCREEN_BASE}
            emissive={SCREEN_GLOW}
            emissiveIntensity={glyphGlow}
          />
        </instancedMesh>
        <mesh name="screen-dock-dot" position={[-0.5, 0.24, 0.033]}>
          <planeGeometry args={[0.06, 0.06]} />
          <meshStandardMaterial
            color={SCREEN_BASE}
            emissive={DOCK_DOT}
            emissiveIntensity={dimmed ? 0.05 : 0.8}
          />
        </mesh>
        {/* camera notch intruding into the top bezel */}
        <mesh name="notch" data-testid="macbook-notch" position={[0, 1.86, 0.035]}>
          <boxGeometry args={[0.3, 0.08, 0.03]} />
          <meshStandardMaterial color={NEAR_BLACK} roughness={0.5} metalness={0.3} />
        </mesh>
        {/* camera lens glint on the notch face */}
        <mesh name="camera-lens" data-testid="macbook-camera" position={[0, 1.86, 0.051]}>
          <circleGeometry args={[0.016, 16]} />
          <meshStandardMaterial
            color={NEAR_BLACK}
            emissive={LENS}
            emissiveIntensity={dimmed ? 0.05 : 0.6}
          />
        </mesh>
      </group>
    </group>
  )
}

// M4 MacBook Air, centered at the origin, front facing +Z, standing on y=0.
// No lights, no textures, no frame loop of its own — the integration lane
// owns the Canvas, lights and frameloop="demand".
function MacBookAir({ status, dimmed = false, scale = 1 }: MacBookAirProps): React.JSX.Element {
  return (
    <group data-testid="macbook-air" scale={scale}>
      <MacBookAirInner status={status} dimmed={dimmed} />
    </group>
  )
}

export default memo(MacBookAir)
