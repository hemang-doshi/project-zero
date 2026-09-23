/* eslint-disable react/no-unknown-property -- R3F three intrinsics (position, rotation, scale, args, geometry, material, color, emissive, …) that the DOM property allowlist cannot know. Scoped to this model file only. */
/* eslint-disable react-refresh/only-export-components -- binding scene-lane contract: MODEL_FOOTPRINT lives beside the component. */
import { memo } from 'react'
import * as THREE from 'three'

export type SkillVialPlugin = {
  id: string
  name: string
  color: string
}

export type SkillVialProps = {
  plugin: SkillVialPlugin
  dimmed?: boolean
  scale?: number
}

// Bounding size in scene units of the unscaled model.
// Narrow powerup vial on a display base: the floating icon chip crown (~1.59)
// sets the height, the base disc (0.68 wide) dominates width/depth.
export const MODEL_FOOTPRINT = { w: 0.9, h: 1.6, d: 0.9 }

// Display base: 0.06 thick standing on y=0, so the vial assembly rests on it.
export const BASE_H = 0.06
export const BASE_Y = BASE_H / 2
// Lowest point of the model: the base disc sits flush on the y=0 desk plane.
export const MODEL_BASE_BOTTOM = 0

// Neutral/glass hexes echo src/shared/tokens.ts (no new tokens):
// BASE/CHIP --z-ink #191C20, GLASS --z-card-white #FFFFFF,
// CAP --z-secondary-ink #5C4038, RIM --z-nav-border #DED7CA.
const BASE = '#191C20'
const CHIP = '#191C20'
const GLASS = '#FFFFFF'
const CAP = '#5C4038'
const RIM = '#DED7CA'

// DNA double-helix bounds inside the glass (radius 0.22 tube).
const HELIX_Y0 = 0.42
const HELIX_H = 0.62
const HELIX_R = 0.105
const HELIX_TURNS = 2
const HELIX_POINTS = 48
const HELIX_TUBE_R = 0.022

function helixPoints(phase: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= HELIX_POINTS; i++) {
    const t = (i / HELIX_POINTS) * Math.PI * 2 * HELIX_TURNS + phase
    pts.push(
      new THREE.Vector3(
        Math.cos(t) * HELIX_R,
        HELIX_Y0 + (i / HELIX_POINTS) * HELIX_H,
        Math.sin(t) * HELIX_R
      )
    )
  }
  return pts
}

const strandAGeometry = new THREE.TubeGeometry(
  new THREE.CatmullRomCurve3(helixPoints(0)),
  64,
  HELIX_TUBE_R,
  8,
  false
)
const strandBGeometry = new THREE.TubeGeometry(
  new THREE.CatmullRomCurve3(helixPoints(Math.PI)),
  64,
  HELIX_TUBE_R,
  8,
  false
)

// Rung bars bridging the two strands at even height fractions. Each rung is a
// diameter through the helix axis, so its Y-rotation is the negated phase.
const RUNGS: Array<{ y: number; rotY: number }> = [0.1, 0.3, 0.5, 0.7, 0.9].map(
  (f) => ({
    y: HELIX_Y0 + f * HELIX_H,
    rotY: -(f * Math.PI * 2 * HELIX_TURNS)
  })
)

const RUNG_LEN = HELIX_R * 2

function SkillVialInner({
  plugin,
  dimmed
}: {
  plugin: SkillVialPlugin
  dimmed: boolean
}): React.JSX.Element {
  const glassOpacity = dimmed ? 0.12 : 0.28
  const bodyOpacity = dimmed ? 0.35 : 1
  const liquidOpacity = dimmed ? 0.15 : 0.35
  const helixGlow = dimmed ? 0.25 : 1.8
  const rungGlow = dimmed ? 0.2 : 1.2
  const chipGlow = dimmed ? 0.2 : 1.2

  return (
    <group position={[0, 0, 0]}>
      {/* display base disc: bottom face flush on y=0 */}
      <mesh name="base" data-testid="skillvial-base" position={[0, BASE_Y, 0]}>
        <cylinderGeometry args={[0.3, 0.34, BASE_H, 24]} />
        <meshStandardMaterial
          color={BASE}
          roughness={0.6}
          metalness={0.3}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>

      {/* glass vial body: transparent tube holding the helix */}
      <mesh name="glass" data-testid="skillvial-glass" position={[0, 0.75, 0]}>
        <cylinderGeometry args={[0.22, 0.22, 0.9, 28, 1, true]} />
        <meshStandardMaterial
          data-testid="skillvial-glass-material"
          color={GLASS}
          roughness={0.1}
          metalness={0}
          transparent
          opacity={glassOpacity}
        />
      </mesh>

      {/* rounded vial bottom: hemisphere dome under the tube */}
      <mesh name="dome" position={[0, 0.3, 0]} rotation-x={Math.PI}>
        <sphereGeometry args={[0.22, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial
          color={GLASS}
          roughness={0.1}
          metalness={0}
          transparent
          opacity={glassOpacity}
        />
      </mesh>

      {/* glowing serum inside the vial, tinted by the plugin color */}
      <mesh name="liquid" position={[0, 0.6, 0]}>
        <cylinderGeometry args={[0.17, 0.15, 0.5, 20]} />
        <meshStandardMaterial
          data-testid="skillvial-liquid-material"
          color={plugin.color}
          emissive={plugin.color}
          emissiveIntensity={rungGlow}
          roughness={0.3}
          metalness={0}
          transparent
          opacity={liquidOpacity}
        />
      </mesh>

      {/* DNA strand A */}
      <mesh name="strand-a" data-testid="skillvial-strand-a" geometry={strandAGeometry}>
        <meshStandardMaterial
          data-testid="skillvial-helix-material"
          color={plugin.color}
          emissive={plugin.color}
          emissiveIntensity={helixGlow}
          roughness={0.3}
          metalness={0.1}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>

      {/* DNA strand B (phase-offset twin) */}
      <mesh name="strand-b" data-testid="skillvial-strand-b" geometry={strandBGeometry}>
        <meshStandardMaterial
          data-testid="skillvial-helix-material"
          color={plugin.color}
          emissive={plugin.color}
          emissiveIntensity={helixGlow}
          roughness={0.3}
          metalness={0.1}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>

      {/* helix rung bars bridging the strands */}
      {RUNGS.map((rung, i) => (
        <mesh
          key={i}
          name={`rung-${i}`}
          position={[0, rung.y, 0]}
          rotation-y={rung.rotY}
        >
          <boxGeometry args={[RUNG_LEN, 0.018, 0.018]} />
          <meshStandardMaterial
            data-testid="skillvial-rung-material"
            color={plugin.color}
            emissive={plugin.color}
            emissiveIntensity={rungGlow}
            roughness={0.35}
            metalness={0.1}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>
      ))}

      {/* cap sealing the vial */}
      <mesh name="cap" position={[0, 1.24, 0]}>
        <cylinderGeometry args={[0.24, 0.24, 0.08, 24]} />
        <meshStandardMaterial
          color={CAP}
          roughness={0.55}
          metalness={0.25}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>

      {/* rim ring under the cap */}
      <mesh name="rim" position={[0, 1.2, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.22, 0.025, 10, 28]} />
        <meshStandardMaterial
          color={RIM}
          roughness={0.4}
          metalness={0.4}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>

      {/* floating icon chip above the vial */}
      <mesh name="chip" data-testid="skillvial-chip" position={[0, 1.45, 0]}>
        <boxGeometry args={[0.34, 0.22, 0.04]} />
        <meshStandardMaterial
          data-testid="skillvial-chip-material"
          color={CHIP}
          emissive={plugin.color}
          emissiveIntensity={chipGlow}
          roughness={0.5}
          metalness={0.3}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>

    </group>
  )
}

// DNA/powerup superhero vial for one installed plugin: a glass tube on a
// display base with a glowing plugin-colored double-helix inside and the
// plugin's geometric mark floating on a chip above. Centered at the origin,
// standing on y=0. No lights, no textures, no frame loop of its own — the
// integration lane owns the Canvas, lights and frameloop="demand".
function SkillVial({ plugin, dimmed = false, scale = 1 }: SkillVialProps): React.JSX.Element {
  return (
    <group data-testid="skillvial" name={`vial-${plugin.id}`} scale={scale}>
      <SkillVialInner plugin={plugin} dimmed={dimmed} />
    </group>
  )
}

export default memo(SkillVial)
