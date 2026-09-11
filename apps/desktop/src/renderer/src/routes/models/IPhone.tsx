/* eslint-disable react/no-unknown-property -- R3F three intrinsics (position, rotation, scale, args, geometry, material, color, emissive, …) that the DOM property allowlist cannot know. Scoped to this model file only. */
/* eslint-disable react-refresh/only-export-components -- binding model-lane contract: MODEL_FOOTPRINT + STATUS_HEX must live beside the component. */
import { memo, useMemo } from 'react'
import * as THREE from 'three'

export type IPhoneStatus = 'online' | 'suspect' | 'offline' | 'gated'

export type IPhoneProps = {
  status: IPhoneStatus
  dimmed?: boolean
  scale?: number
}

// Status light colors. Stitch token hexes hardcoded per the model-lane rule
// (no new tokens): --z-status-green, --z-marker-yellow, --z-secondary-ink
// (offline gray-brown), --z-error-red.
export const STATUS_HEX: Record<IPhoneStatus, string> = {
  online: '#10B981',
  suspect: '#F7DF94',
  offline: '#5C4038',
  gated: '#DC2626'
}

// Bounding size in scene units of the unscaled model.
// Proportions follow a modern Pro-style iPhone (147.5 × 71.5 × 8.25 mm):
// width 0.78, height 1.6, depth 0.13 (body 0.09 + camera plateau 0.04).
export const MODEL_FOOTPRINT = { w: 0.78, h: 1.6, d: 0.13 }

// Natural titanium gray (no token silver exists — hardcoded, not a token).
const TITANIUM = '#8E9399'
const TITANIUM_DARK = '#6E7379'
const NEAR_BLACK = '#101216'
// Screen tints from Stitch tokens: --z-ink base, --z-highlight-blue glow,
// --z-card-cream wallpaper band, --z-brand-orange wallpaper accent.
const SCREEN_BASE = '#191C20'
const SCREEN_GLOW = '#3B82F6'
const WALLPAPER_BAND = '#FAF8F5'
const WALLPAPER_ACCENT = '#F54E00'
const LENS_GLASS = '#1B3A5C'

const PHONE_W = 0.78
const PHONE_H = 1.6
const PHONE_D = 0.09
const CORNER_R = 0.12
const FRONT_Z = PHONE_D / 2
const BACK_Z = -PHONE_D / 2
const CENTER_Y = PHONE_H / 2
// Camera plateau protrudes past the back face; d in MODEL_FOOTPRINT covers it.
const PLATEAU_T = 0.035
const PLATEAU_BACK_Z = BACK_Z - PLATEAU_T

function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r)
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h)
  s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  return s
}

const LENS_POS: Array<[number, number]> = [
  [-0.1, 0.1],
  [0.1, 0.1],
  [0.0, -0.1]
]

function IPhoneInner({
  status,
  dimmed
}: {
  status: IPhoneStatus
  dimmed: boolean
}): React.JSX.Element {
  const bodyGeo = useMemo(() => {
    const shape = roundedRectShape(PHONE_W, PHONE_H, CORNER_R)
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: PHONE_D,
      bevelEnabled: true,
      bevelThickness: 0.008,
      bevelSize: 0.008,
      bevelSegments: 2,
      curveSegments: 24
    })
    geo.translate(0, 0, -PHONE_D / 2)
    return geo
  }, [])

  const screenGeo = useMemo(() => {
    const shape = roundedRectShape(PHONE_W - 0.06, PHONE_H - 0.06, CORNER_R - 0.03)
    return new THREE.ShapeGeometry(shape, 24)
  }, [])

  const bezelGeo = useMemo(() => {
    const shape = roundedRectShape(PHONE_W - 0.02, PHONE_H - 0.02, CORNER_R - 0.01)
    return new THREE.ShapeGeometry(shape, 24)
  }, [])

  const bodyOpacity = dimmed ? 0.35 : 1
  const screenGlow = dimmed ? 0.05 : 0.7
  const wallpaperGlow = dimmed ? 0.03 : 0.45
  const statusGlow = dimmed ? 0.15 : 1.6

  return (
    <group position={[0, 0, 0]}>
      {/* soft fake contact shadow — the integration lane owns real lights */}
      <mesh
        name="base-shadow"
        rotation-x={-Math.PI / 2}
        position={[0, 0.002, 0]}
        scale={[0.65, 0.9, 1]}
      >
        <circleGeometry args={[1, 40]} />
        <meshBasicMaterial color={SCREEN_BASE} transparent opacity={0.22} depthWrite={false} />
      </mesh>

      {/* titanium unibody slab, rounded rectangle, standing on y=0 */}
      <mesh name="body" data-testid="iphone-body" position={[0, CENTER_Y, 0]} geometry={bodyGeo}>
        <meshStandardMaterial
          data-testid="iphone-body-material"
          color={TITANIUM}
          metalness={0.9}
          roughness={0.35}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>

      {/* thin black bezel framing the display */}
      <mesh name="bezel" position={[0, CENTER_Y, FRONT_Z + 0.004]} geometry={bezelGeo}>
        <meshStandardMaterial
          color={NEAR_BLACK}
          roughness={0.5}
          metalness={0.3}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>

      {/* edge-to-edge display: dark glass with a subtle wallpaper tint */}
      <mesh
        name="screen"
        data-testid="iphone-screen"
        position={[0, CENTER_Y, FRONT_Z + 0.006]}
        geometry={screenGeo}
      >
        <meshStandardMaterial
          data-testid="iphone-screen-material"
          color={SCREEN_BASE}
          emissive={SCREEN_GLOW}
          emissiveIntensity={screenGlow}
        />
      </mesh>
      {/* wallpaper bands: soft cream sweep + warm accent dot */}
      <mesh name="screen-wallpaper-a" position={[-0.08, CENTER_Y + 0.25, FRONT_Z + 0.008]}>
        <planeGeometry args={[0.5, 0.34]} />
        <meshStandardMaterial
          color={SCREEN_BASE}
          emissive={WALLPAPER_BAND}
          emissiveIntensity={wallpaperGlow}
          transparent
          opacity={dimmed ? 0.25 : 0.75}
        />
      </mesh>
      <mesh name="screen-wallpaper-b" position={[0.14, CENTER_Y - 0.3, FRONT_Z + 0.008]}>
        <planeGeometry args={[0.22, 0.22]} />
        <meshStandardMaterial
          color={SCREEN_BASE}
          emissive={WALLPAPER_ACCENT}
          emissiveIntensity={dimmed ? 0.04 : 0.5}
          transparent
          opacity={dimmed ? 0.25 : 0.7}
        />
      </mesh>

      {/* Dynamic Island pill cutout + front camera dot, floating above the glass */}
      <mesh
        name="island"
        data-testid="iphone-island"
        position={[0, CENTER_Y + 0.62, FRONT_Z + 0.01]}
      >
        <capsuleGeometry args={[0.032, 0.15, 8, 16]} />
        <meshStandardMaterial color={NEAR_BLACK} roughness={0.4} metalness={0.4} />
      </mesh>
      <mesh name="island-camera" position={[0.07, CENTER_Y + 0.62, FRONT_Z + 0.016]}>
        <circleGeometry args={[0.014, 20]} />
        <meshStandardMaterial
          color={NEAR_BLACK}
          emissive={LENS_GLASS}
          emissiveIntensity={dimmed ? 0.1 : 0.9}
        />
      </mesh>

      {/* home-indicator bar doubling as the connection status light */}
      <mesh
        name="status-light"
        data-testid="iphone-status-light"
        position={[0, 0.1, FRONT_Z + 0.01]}
      >
        <boxGeometry args={[0.2, 0.022, 0.012]} />
        <meshStandardMaterial
          data-testid="iphone-status-material"
          color={NEAR_BLACK}
          emissive={STATUS_HEX[status]}
          emissiveIntensity={statusGlow}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>

      {/* triple-camera module on the back, top-left */}
      <group name="cameras" data-testid="iphone-cameras" position={[-0.17, CENTER_Y + 0.48, 0]}>
        {/* raised rounded-square plateau */}
        <mesh name="camera-plateau" position={[0, 0, BACK_Z - PLATEAU_T / 2]}>
          <boxGeometry args={[0.36, 0.36, PLATEAU_T]} />
          <meshStandardMaterial
            color={TITANIUM_DARK}
            metalness={0.9}
            roughness={0.35}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>
        {/* three lens barrels with glass faces */}
        {LENS_POS.map(([lx, ly], i) => (
          <group key={i} position={[lx, ly, 0]}>
            <mesh
              name={`camera-lens-${i}`}
              rotation-x={Math.PI / 2}
              position={[0, 0, PLATEAU_BACK_Z - 0.012]}
            >
              <cylinderGeometry args={[0.062, 0.066, 0.03, 28]} />
              <meshStandardMaterial
                color={TITANIUM_DARK}
                metalness={0.9}
                roughness={0.3}
                transparent={dimmed}
                opacity={bodyOpacity}
              />
            </mesh>
            <mesh
              name={`camera-glass-${i}`}
              position={[0, 0, PLATEAU_BACK_Z - 0.028]}
              rotation-y={Math.PI}
            >
              <circleGeometry args={[0.048, 28]} />
              <meshStandardMaterial
                color={NEAR_BLACK}
                emissive={LENS_GLASS}
                emissiveIntensity={dimmed ? 0.1 : 0.8}
              />
            </mesh>
          </group>
        ))}
        {/* LiDAR dot + flash */}
        <mesh
          name="camera-lidar"
          position={[0.11, -0.1, PLATEAU_BACK_Z - 0.004]}
          rotation-y={Math.PI}
        >
          <circleGeometry args={[0.022, 20]} />
          <meshStandardMaterial color={NEAR_BLACK} roughness={0.4} metalness={0.5} />
        </mesh>
        <mesh
          name="camera-flash"
          position={[0.11, 0.02, PLATEAU_BACK_Z - 0.004]}
          rotation-y={Math.PI}
        >
          <circleGeometry args={[0.026, 20]} />
          <meshStandardMaterial
            color={WALLPAPER_BAND}
            emissive={WALLPAPER_BAND}
            emissiveIntensity={dimmed ? 0.02 : 0.25}
          />
        </mesh>
      </group>

      {/* neutral etched circle hint on the back — no trademark logos */}
      <mesh name="back-mark" position={[0, CENTER_Y - 0.05, BACK_Z - 0.002]} rotation-y={Math.PI}>
        <ringGeometry args={[0.07, 0.078, 40]} />
        <meshStandardMaterial
          color={TITANIUM_DARK}
          metalness={0.8}
          roughness={0.5}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>

      {/* side buttons: action + volume ×2 on the left, power on the right */}
      <group name="buttons" data-testid="iphone-buttons">
        <mesh name="button-action" position={[-PHONE_W / 2 - 0.006, CENTER_Y + 0.5, 0]}>
          <boxGeometry args={[0.014, 0.07, 0.03]} />
          <meshStandardMaterial color={TITANIUM_DARK} metalness={0.9} roughness={0.35} />
        </mesh>
        <mesh name="button-volume-up" position={[-PHONE_W / 2 - 0.006, CENTER_Y + 0.32, 0]}>
          <boxGeometry args={[0.014, 0.12, 0.03]} />
          <meshStandardMaterial color={TITANIUM_DARK} metalness={0.9} roughness={0.35} />
        </mesh>
        <mesh name="button-volume-down" position={[-PHONE_W / 2 - 0.006, CENTER_Y + 0.17, 0]}>
          <boxGeometry args={[0.014, 0.12, 0.03]} />
          <meshStandardMaterial color={TITANIUM_DARK} metalness={0.9} roughness={0.35} />
        </mesh>
        <mesh name="button-power" position={[PHONE_W / 2 + 0.006, CENTER_Y + 0.28, 0]}>
          <boxGeometry args={[0.014, 0.16, 0.03]} />
          <meshStandardMaterial color={TITANIUM_DARK} metalness={0.9} roughness={0.35} />
        </mesh>
      </group>
    </group>
  )
}

// Modern Pro-style iPhone, centered at the origin, front facing +Z,
// standing on y=0. No lights, no textures, no frame loop of its own —
// the integration lane owns the Canvas, lights and frameloop="demand".
function IPhone({ status, dimmed = false, scale = 1 }: IPhoneProps): React.JSX.Element {
  return (
    <group data-testid="iphone" scale={scale}>
      <IPhoneInner status={status} dimmed={dimmed} />
    </group>
  )
}

export default memo(IPhone)
