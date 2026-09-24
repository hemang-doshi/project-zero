/* eslint-disable react/no-unknown-property -- R3F three intrinsics (position, rotation, scale, args, geometry, material, color, emissive, …) that the DOM property allowlist cannot know. Scoped to this model file only. */
/* eslint-disable react-refresh/only-export-components -- binding model-lane contract: MODEL_FOOTPRINT + STATUS_HEX must live beside the component. */
import { invalidate } from '@react-three/fiber'
import { memo, useLayoutEffect, useMemo, useRef } from 'react'
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
// Antenna dielectric inlay + lock-screen time glyph: --z-line, --z-card-white.
const ANTENNA = '#DED7CA'
const TIME_GLOW = '#FFFFFF'

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

// Detail-pass instancing budgets (all single-draw instancedMesh fills):
// bottom-edge perforations, sapphire rings + pupils, icon dots, knurls.
const ANTENNA_X = 0.22
const SPEAKER_N = 6
const SPEAKER_X0 = -0.33
const SPEAKER_PITCH = 0.032
const MIC_N = 3
const MIC_X0 = 0.17
const MIC_PITCH = 0.032
const BOTTOM_HOLE_Y = 0.002
const ICON_COLS = 4
const ICON_ROWS = 3
const ICON_COUNT = ICON_COLS * ICON_ROWS
const ICON_X0 = -0.21
const ICON_PITCH_X = 0.14
const ICON_Y0 = 0.72
const ICON_PITCH_Y = -0.15
const KNURL_N = 3

function IPhoneInner({
  status,
  dimmed
}: {
  status: IPhoneStatus
  dimmed: boolean
}): React.JSX.Element {
  // Instanced repeated parts (bottom-edge holes, sapphire rings + inner
  // pupils, app-icon dots, action-button knurls). Same harness as the
  // MacBook lane: the `typeof setMatrixAt` guard no-ops under the mock-DOM
  // unit render, where refs are plain elements instead of THREE objects.
  // useLayoutEffect + demand invalidate() (T29a follow-up): matrices fill
  // before paint, and the global invalidate() no-ops when no Canvas is
  // mounted, so the jsdom render stays side-effect free.
  const speakerRef = useRef<THREE.InstancedMesh | null>(null)
  const micRef = useRef<THREE.InstancedMesh | null>(null)
  const ringRef = useRef<THREE.InstancedMesh | null>(null)
  const innerRef = useRef<THREE.InstancedMesh | null>(null)
  const iconsRef = useRef<THREE.InstancedMesh | null>(null)
  const knurlRef = useRef<THREE.InstancedMesh | null>(null)

  useLayoutEffect(() => {
    const dummy = new THREE.Object3D()
    const fill = (
      mesh: THREE.InstancedMesh | null,
      positions: Array<[number, number, number]>,
      rotationY = 0
    ): void => {
      if (mesh === null || typeof mesh.setMatrixAt !== 'function') return
      positions.forEach(([x, y, z], i) => {
        dummy.position.set(x, y, z)
        dummy.rotation.set(0, rotationY, 0)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
      })
      mesh.instanceMatrix.needsUpdate = true
    }
    fill(
      speakerRef.current,
      Array.from(
        { length: SPEAKER_N },
        (_, i) => [SPEAKER_X0 + i * SPEAKER_PITCH, BOTTOM_HOLE_Y, 0] as [number, number, number]
      )
    )
    fill(
      micRef.current,
      Array.from(
        { length: MIC_N },
        (_, i) => [MIC_X0 + i * MIC_PITCH, BOTTOM_HOLE_Y, 0] as [number, number, number]
      )
    )
    fill(
      ringRef.current,
      LENS_POS.map(([lx, ly]) => [lx, ly, PLATEAU_BACK_Z - 0.028] as [number, number, number])
    )
    fill(
      innerRef.current,
      LENS_POS.map(([lx, ly]) => [lx, ly, PLATEAU_BACK_Z - 0.029] as [number, number, number]),
      Math.PI
    )
    const icons: Array<[number, number, number]> = []
    for (let r = 0; r < ICON_ROWS; r++) {
      for (let c = 0; c < ICON_COLS; c += 1) {
        icons.push([ICON_X0 + c * ICON_PITCH_X, ICON_Y0 + r * ICON_PITCH_Y, FRONT_Z + 0.01])
      }
    }
    fill(iconsRef.current, icons)
    fill(
      knurlRef.current,
      [-0.02, 0, 0.02].map(
        (dy) => [-PHONE_W / 2 - 0.0145, CENTER_Y + 0.5 + dy, 0] as [number, number, number]
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

  const backGlassGeo = useMemo(() => {
    const shape = roundedRectShape(PHONE_W - 0.03, PHONE_H - 0.03, CORNER_R - 0.015)
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

      {/* lock-screen time + date hints over the wallpaper gradient */}
      <mesh name="screen-time" position={[0, CENTER_Y + 0.32, FRONT_Z + 0.01]}>
        <planeGeometry args={[0.24, 0.08]} />
        <meshStandardMaterial
          data-testid="iphone-time-material"
          color={SCREEN_BASE}
          emissive={TIME_GLOW}
          emissiveIntensity={dimmed ? 0.05 : 0.9}
          transparent
          opacity={dimmed ? 0.3 : 0.9}
        />
      </mesh>
      <mesh name="screen-date" position={[0, CENTER_Y + 0.23, FRONT_Z + 0.01]}>
        <planeGeometry args={[0.16, 0.03]} />
        <meshStandardMaterial
          color={SCREEN_BASE}
          emissive={WALLPAPER_BAND}
          emissiveIntensity={dimmed ? 0.03 : 0.5}
          transparent
          opacity={dimmed ? 0.25 : 0.8}
        />
      </mesh>
      {/* app-icon dot grid hint: 12 instanced cream glyphs + 1 orange accent */}
      <instancedMesh
        name="app-icons"
        data-testid="iphone-app-icons"
        ref={iconsRef}
        args={[undefined, undefined, ICON_COUNT]}
        frustumCulled={false}
      >
        <planeGeometry args={[0.075, 0.075]} />
        <meshStandardMaterial
          color={SCREEN_BASE}
          emissive={WALLPAPER_BAND}
          emissiveIntensity={dimmed ? 0.03 : 0.55}
          transparent
          opacity={dimmed ? 0.25 : 0.85}
        />
      </instancedMesh>
      <mesh name="app-icon-accent" position={[ICON_X0, ICON_Y0 + 3 * ICON_PITCH_Y, FRONT_Z + 0.01]}>
        <planeGeometry args={[0.075, 0.075]} />
        <meshStandardMaterial
          color={SCREEN_BASE}
          emissive={WALLPAPER_ACCENT}
          emissiveIntensity={dimmed ? 0.04 : 0.6}
          transparent
          opacity={dimmed ? 0.25 : 0.85}
        />
      </mesh>

      {/* Dynamic Island: horizontal pill (rotation-z lays the capsule flat),
          squashed in depth so it reads as a cutout, not a bar */}
      <mesh
        name="island"
        data-testid="iphone-island"
        position={[0, CENTER_Y + 0.62, FRONT_Z + 0.01]}
        rotation-z={Math.PI / 2}
        scale={[1, 1, 0.4]}
      >
        <capsuleGeometry args={[0.032, 0.15, 8, 16]} />
        <meshStandardMaterial color={NEAR_BLACK} roughness={0.4} metalness={0.4} />
      </mesh>
      {/* earpiece slit tucked inside the island, left of the camera */}
      <mesh name="island-speaker" position={[-0.03, CENTER_Y + 0.62, FRONT_Z + 0.0235]}>
        <boxGeometry args={[0.055, 0.008, 0.004]} />
        <meshStandardMaterial color={TITANIUM_DARK} roughness={0.6} metalness={0.5} />
      </mesh>
      <mesh name="island-camera" position={[0.07, CENTER_Y + 0.62, FRONT_Z + 0.024]}>
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
        {/* sapphire trim rings around each lens (1 draw) + dark inner pupils
            floating just proud of the glass so the depth reads (1 draw) */}
        <instancedMesh
          name="lens-rings"
          data-testid="iphone-lens-rings"
          ref={ringRef}
          args={[undefined, undefined, LENS_POS.length]}
          frustumCulled={false}
        >
          <torusGeometry args={[0.052, 0.009, 10, 32]} />
          <meshStandardMaterial
            color={TITANIUM}
            metalness={1}
            roughness={0.15}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </instancedMesh>
        <instancedMesh
          name="lens-inners"
          data-testid="iphone-lens-inners"
          ref={innerRef}
          args={[undefined, undefined, LENS_POS.length]}
          frustumCulled={false}
        >
          <circleGeometry args={[0.02, 20]} />
          <meshStandardMaterial
            color={NEAR_BLACK}
            emissive={LENS_GLASS}
            emissiveIntensity={dimmed ? 0.1 : 0.9}
          />
        </instancedMesh>
        {/* rear mic pinhole above the flash, completing the plateau cluster */}
        <mesh
          name="camera-mic"
          position={[0.11, 0.12, PLATEAU_BACK_Z - 0.004]}
          rotation-y={Math.PI}
        >
          <circleGeometry args={[0.008, 12]} />
          <meshStandardMaterial color={NEAR_BLACK} roughness={0.7} metalness={0.2} />
        </mesh>
      </group>

      {/* frosted back-glass inset: the glass/titanium material split */}
      <mesh
        name="back-glass"
        position={[0, CENTER_Y, BACK_Z - 0.001]}
        rotation-y={Math.PI}
        geometry={backGlassGeo}
      >
        <meshStandardMaterial
          color={TITANIUM_DARK}
          metalness={0.25}
          roughness={0.55}
          transparent={dimmed}
          opacity={bodyOpacity}
        />
      </mesh>

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
      {/* button travel gaps: dark recesses outlining each key */}
      <group name="button-gaps">
        {(
          [
            ['button-gap-action', CENTER_Y + 0.5, 0.07, -1],
            ['button-gap-volume-up', CENTER_Y + 0.32, 0.12, -1],
            ['button-gap-volume-down', CENTER_Y + 0.17, 0.12, -1],
            ['button-gap-power', CENTER_Y + 0.28, 0.16, 1]
          ] as Array<[string, number, number, number]>
        ).map(([name, y, len, side]) => (
          <mesh key={name} name={name} position={[(PHONE_W / 2 + 0.0015) * side, y, 0]}>
            <boxGeometry args={[0.006, len + 0.016, 0.044]} />
            <meshStandardMaterial color={NEAR_BLACK} roughness={0.7} metalness={0.2} />
          </mesh>
        ))}
      </group>
      {/* action-button knurling: three grooves on the outer face (1 draw) */}
      <instancedMesh
        name="action-knurls"
        ref={knurlRef}
        args={[undefined, undefined, KNURL_N]}
        frustumCulled={false}
      >
        <boxGeometry args={[0.004, 0.008, 0.032]} />
        <meshStandardMaterial color={NEAR_BLACK} roughness={0.7} metalness={0.2} />
      </instancedMesh>

      {/* antenna dielectric bands breaking the titanium frame, top + bottom */}
      {(
        [
          ['antenna-top-left', -ANTENNA_X, PHONE_H],
          ['antenna-top-right', ANTENNA_X, PHONE_H],
          ['antenna-bottom-left', -ANTENNA_X, 0.004],
          ['antenna-bottom-right', ANTENNA_X, 0.004]
        ] as Array<[string, number, number]>
      ).map(([name, x, y]) => (
        <mesh key={name} name={name} position={[x, y, 0]}>
          <boxGeometry args={[0.025, 0.008, 0.1]} />
          <meshStandardMaterial color={ANTENNA} roughness={0.6} metalness={0.1} />
        </mesh>
      ))}

      {/* bottom edge: USB-C recess + tongue, speaker + mic perforations */}
      <mesh name="bottom-usbc" position={[0, 0.008, 0]}>
        <boxGeometry args={[0.14, 0.02, 0.045]} />
        <meshStandardMaterial color={NEAR_BLACK} roughness={0.7} metalness={0.2} />
      </mesh>
      <mesh name="bottom-usbc-tongue" position={[0, 0.008, 0.004]}>
        <boxGeometry args={[0.1, 0.008, 0.02]} />
        <meshStandardMaterial color={TITANIUM_DARK} roughness={0.5} metalness={0.6} />
      </mesh>
      <instancedMesh
        name="bottom-speaker-holes"
        data-testid="iphone-speaker-holes"
        ref={speakerRef}
        args={[undefined, undefined, SPEAKER_N]}
        frustumCulled={false}
      >
        <cylinderGeometry args={[0.008, 0.008, 0.004, 10]} />
        <meshStandardMaterial color={NEAR_BLACK} roughness={0.7} metalness={0.2} />
      </instancedMesh>
      <instancedMesh
        name="bottom-mic-holes"
        data-testid="iphone-mic-holes"
        ref={micRef}
        args={[undefined, undefined, MIC_N]}
        frustumCulled={false}
      >
        <cylinderGeometry args={[0.008, 0.008, 0.004, 10]} />
        <meshStandardMaterial color={NEAR_BLACK} roughness={0.7} metalness={0.2} />
      </instancedMesh>

      {/* SIM tray seam + eject pinhole on the lower-left edge */}
      <mesh name="sim-tray" position={[-PHONE_W / 2 - 0.004, 0.45, 0]}>
        <boxGeometry args={[0.01, 0.2, 0.05]} />
        <meshStandardMaterial color={TITANIUM_DARK} metalness={0.9} roughness={0.35} />
      </mesh>
      <mesh name="sim-pinhole" position={[-PHONE_W / 2 - 0.012, 0.52, 0]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.005, 0.005, 0.012, 10]} />
        <meshStandardMaterial color={NEAR_BLACK} roughness={0.7} metalness={0.2} />
      </mesh>
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
