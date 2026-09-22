/* eslint-disable react/no-unknown-property -- R3F three intrinsics (position, rotation, scale, args, geometry, material, color, emissive, …) that the DOM property allowlist cannot know. Scoped to this model file only. */
/* eslint-disable react-refresh/only-export-components -- binding model-lane contract: MODEL_FOOTPRINT + STATUS_HEX must live beside the component. */
import { invalidate } from '@react-three/fiber'
import { memo, useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'

export type Esp32Status = 'online' | 'suspect' | 'offline' | 'gated'

export type Esp32DeskDisplayProps = {
  status: Esp32Status
  dimmed?: boolean
  scale?: number
}

// Status light colors. Stitch token hexes hardcoded per the model-lane rule
// (no new tokens): --z-status-green, --z-marker-yellow, --z-secondary-ink
// (offline gray-brown), --z-error-red.
export const STATUS_HEX: Record<Esp32Status, string> = {
  online: '#10B981',
  suspect: '#F7DF94',
  offline: '#5C4038',
  gated: '#DC2626'
}

// Bounding size in scene units of the unscaled model.
// Proportions follow a classic ESP32 dev board (~52 × 28 mm) driving a 1.8"
// 128×160 TFT, held upright in a small desk stand: width 0.9 (stand foot),
// standing height 1.1 (micro-USB top), depth 0.5 (foot front lip to back).
// Smaller than the laptop (3.0×2.13×2.5) and monitor (3.2×2.6×0.75) in every
// dimension; bulkier than the phone (0.78×1.6×0.13) in width and depth.
export const MODEL_FOOTPRINT = { w: 0.9, h: 1.1, d: 0.5 }

// Dark solder-mask PCB blue-slate (no token navy exists — hardcoded, not a token).
const PCB = '#1E2A38'
const PCB_EDGE = '#141C26'
const NEAR_BLACK = '#101216'
// Gold pin-header contacts (no token gold exists — hardcoded, not a token).
const PIN_GOLD = '#C9A227'
// Brushed silver for the ESP32 shield can + micro-USB shell
// (no token silver exists — hardcoded, not a token).
const SHIELD = '#C0C5CC'
const SHIELD_ETCH = '#9AA0A8'
const USB_SHELL = '#A8ADB3'
// Screen tints from Stitch tokens: --z-ink base, --z-highlight-blue glow,
// --z-card-cream timer digits, --z-status-green waveform trace.
const SCREEN_BASE = '#191C20'
const SCREEN_GLOW = '#3B82F6'
const TIMER_DIGITS = '#FAF8F5'
const WAVE_TRACE = '#10B981'
// Matte black plastic for the stand + TFT bezel + tactile buttons.
const PLASTIC = '#23262B'
// Polyimide amber for the TFT flex ribbon (hardcoded, not a token).
const FLEX = '#B5732A'
// Solder fillets (hardcoded silver, not a token).
const SOLDER = '#9AA0A8'
// Resettable-fuse yellow: --z-marker-yellow (same hex as STATUS_HEX.suspect).
const FUSE_YELLOW = '#F7DF94'
// Power-LED red: --z-error-red (same hex as STATUS_HEX.gated).
const POWER_RED = '#DC2626'

// Assembly leans back slightly so the TFT face reads from a seated eye line.
const TILT = THREE.MathUtils.degToRad(8)
const ASSEMBLY_Y = 0.06
const ASSEMBLY_Z = 0.03

const PCB_W = 0.56
const PCB_H = 1.0
const PCB_T = 0.035
const PCB_CENTER_Y = PCB_H / 2

const PIN_SIDES = [-1, 1] as const
const PIN_COUNT = 12
const PIN_Y0 = 0.1
const PIN_Y1 = 0.9
const PIN_X = 0.295

const TFT_W = 0.46
const TFT_H = 0.58
const TFT_CENTER_Y = 0.3
// 128:160 portrait face (0.8 aspect): 0.368 × 0.46.
const SCREEN_W = 0.368
const SCREEN_H = 0.46
const TFT_FRONT_Z = 0.0725
const UI_Z = 0.0745

// Detail-pass instancing budgets (each instancedMesh = 1 draw call):
// pin solder joints, silkscreen text hints, electrolytic caps, PCB mounting
// holes, TFT bezel screws, TFT standoff spacers, BOOT/EN legends.
const SOLDER_N = PIN_SIDES.length * PIN_COUNT
const SOLDER_Z = 0.046
// Silkscreen text hints: two pin-label columns + two title lines by the USB
// end (tiny emissive rectangles suggesting print, no textures).
const SILK_LINES: Array<[number, number]> = [
  [-0.235, 0.7],
  [-0.235, 0.73],
  [-0.235, 0.76],
  [-0.235, 0.79],
  [0.235, 0.7],
  [0.235, 0.73],
  [0.235, 0.76],
  [0.235, 0.79],
  [-0.13, 0.99],
  [0.13, 0.99]
]
const SILK_Z = 0.0185
// Electrolytic cans in the free middle band between bezel top (0.59) and
// module bottom (0.67), clear of the regulator (-0.185..-0.095) and the
// status LED (0.165..0.215).
const CAP_SPOTS: Array<[number, number]> = [
  [-0.05, 0.615],
  [0.03, 0.615],
  [0.11, 0.615],
  [-0.01, 0.65],
  [0.07, 0.65]
]
const CAP_Z = 0.0325
const MOUNT_SPOTS: Array<[number, number]> = [
  [-0.24, 0.045],
  [0.24, 0.045],
  [-0.24, 0.955],
  [0.24, 0.955]
]
// Bezel screws ring the TFT glass (glass spans x ±0.184, y 0.07..0.53);
// standoffs share the same XY behind the bezel, spacing it off the PCB.
const BEZEL_SCREW_SPOTS: Array<[number, number]> = [
  [-0.2, 0.05],
  [0.2, 0.05],
  [-0.2, 0.55],
  [0.2, 0.55]
]
const BEZEL_SCREW_Z = 0.0735
const STANDOFF_Z = 0.0275
const LEGEND_X: Array<number> = [-0.225, 0.225]
const LEGEND_Y = 0.925

function Esp32DeskDisplayInner({
  status,
  dimmed
}: {
  status: Esp32Status
  dimmed: boolean
}): React.JSX.Element {
  const bodyOpacity = dimmed ? 0.35 : 1
  const screenGlow = dimmed ? 0.05 : 0.7
  const uiGlow = dimmed ? 0.04 : 0.55
  const headerGlow = dimmed ? 0.08 : 0.9
  const statusGlow = dimmed ? 0.15 : 1.6

  // Instanced repeated parts (solder joints, silkscreen hints, caps, mounting
  // holes, bezel screws, standoffs, button legends). Same harness as the
  // monitor lane: the `typeof setMatrixAt` guard no-ops under the mock-DOM
  // unit render, where refs are plain elements instead of THREE objects.
  // useLayoutEffect + demand invalidate() (T29b ruling): matrices fill before
  // paint, and the global invalidate() no-ops when no Canvas is mounted, so
  // the jsdom render stays side-effect free.
  const solderRef = useRef<THREE.InstancedMesh | null>(null)
  const silkRef = useRef<THREE.InstancedMesh | null>(null)
  const capsRef = useRef<THREE.InstancedMesh | null>(null)
  const mountsRef = useRef<THREE.InstancedMesh | null>(null)
  const screwsRef = useRef<THREE.InstancedMesh | null>(null)
  const standoffsRef = useRef<THREE.InstancedMesh | null>(null)
  const legendsRef = useRef<THREE.InstancedMesh | null>(null)

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
    const pinRows: Array<[number, number, number]> = []
    for (const side of PIN_SIDES) {
      for (let i = 0; i < PIN_COUNT; i += 1) {
        pinRows.push([side * PIN_X, PIN_Y0 + (i * (PIN_Y1 - PIN_Y0)) / (PIN_COUNT - 1), SOLDER_Z])
      }
    }
    fill(solderRef.current, pinRows, [Math.PI / 2, 0, 0])
    fill(
      silkRef.current,
      SILK_LINES.map(([x, y]) => [x, y, SILK_Z] as [number, number, number])
    )
    fill(
      capsRef.current,
      CAP_SPOTS.map(([x, y]) => [x, y, CAP_Z] as [number, number, number]),
      [Math.PI / 2, 0, 0]
    )
    fill(
      mountsRef.current,
      MOUNT_SPOTS.map(([x, y]) => [x, y, 0] as [number, number, number]),
      [Math.PI / 2, 0, 0]
    )
    fill(
      screwsRef.current,
      BEZEL_SCREW_SPOTS.map(([x, y]) => [x, y, BEZEL_SCREW_Z] as [number, number, number]),
      [Math.PI / 2, 0, 0]
    )
    fill(
      standoffsRef.current,
      BEZEL_SCREW_SPOTS.map(([x, y]) => [x, y, STANDOFF_Z] as [number, number, number]),
      [Math.PI / 2, 0, 0]
    )
    fill(
      legendsRef.current,
      LEGEND_X.map((x) => [x, LEGEND_Y, SILK_Z] as [number, number, number])
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
        scale={[0.7, 0.55, 1]}
      >
        <circleGeometry args={[1, 40]} />
        <meshBasicMaterial color={SCREEN_BASE} transparent opacity={0.22} depthWrite={false} />
      </mesh>

      {/* desk stand: weighted foot + tilted back arm + front lip */}
      <group name="stand" data-testid="esp32-stand">
        <mesh name="stand-foot" data-testid="esp32-stand-foot" position={[0, 0.025, 0]}>
          <boxGeometry args={[0.9, 0.05, 0.5]} />
          <meshStandardMaterial
            color={PLASTIC}
            metalness={0.3}
            roughness={0.6}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>
        <mesh name="stand-arm" position={[0, 0.32, -0.045]} rotation-x={-TILT}>
          <boxGeometry args={[0.34, 0.6, 0.045]} />
          <meshStandardMaterial
            color={PLASTIC}
            metalness={0.3}
            roughness={0.6}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>
        <mesh name="stand-lip" position={[0, 0.045, 0.05]}>
          <boxGeometry args={[0.5, 0.05, 0.12]} />
          <meshStandardMaterial
            color={PLASTIC}
            metalness={0.3}
            roughness={0.6}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>
      </group>

      {/* dev-board assembly, upright with a slight backward tilt, front facing +Z */}
      <group position={[0, ASSEMBLY_Y, ASSEMBLY_Z]} rotation-x={-TILT}>
        {/* dark PCB rectangle */}
        <mesh name="pcb" data-testid="esp32-pcb" position={[0, PCB_CENTER_Y, 0]}>
          <boxGeometry args={[PCB_W, PCB_H, PCB_T]} />
          <meshStandardMaterial
            data-testid="esp32-pcb-material"
            color={PCB}
            roughness={0.55}
            metalness={0.25}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>
        {/* PCB edge hint along the bottom short edge */}
        <mesh name="pcb-edge" position={[0, 0.012, 0]}>
          <boxGeometry args={[PCB_W, 0.024, PCB_T]} />
          <meshStandardMaterial color={PCB_EDGE} roughness={0.6} metalness={0.2} />
        </mesh>
        {/* mounting holes in the PCB corners (dark through-hole cylinders) */}
        <instancedMesh
          name="mounting-holes"
          data-testid="esp32-mounting-holes"
          ref={mountsRef}
          args={[undefined, undefined, MOUNT_SPOTS.length]}
          frustumCulled={false}
        >
          <cylinderGeometry args={[0.022, 0.022, 0.04, 16]} />
          <meshStandardMaterial color={PCB_EDGE} roughness={0.7} metalness={0.2} />
        </instancedMesh>

        {/* pin-header rows along both long edges */}
        <group name="pins" data-testid="esp32-pins">
          {PIN_SIDES.map((side) => (
            <group
              key={side}
              name={side < 0 ? 'pins-left' : 'pins-right'}
              data-testid={side < 0 ? 'esp32-pins-left' : 'esp32-pins-right'}
            >
              <mesh
                name={side < 0 ? 'pin-strip-left' : 'pin-strip-right'}
                position={[side * PIN_X, 0.5, 0.02]}
              >
                <boxGeometry args={[0.055, 0.86, 0.05]} />
                <meshStandardMaterial
                  color={NEAR_BLACK}
                  roughness={0.6}
                  metalness={0.2}
                  transparent={dimmed}
                  opacity={bodyOpacity}
                />
              </mesh>
              {Array.from({ length: PIN_COUNT }, (_, i) => (
                <mesh
                  key={i}
                  name={side < 0 ? `pin-l-${i}` : `pin-r-${i}`}
                  position={[
                    side * PIN_X,
                    PIN_Y0 + (i * (PIN_Y1 - PIN_Y0)) / (PIN_COUNT - 1),
                    0.055
                  ]}
                >
                  <boxGeometry args={[0.028, 0.04, 0.028]} />
                  <meshStandardMaterial
                    color={PIN_GOLD}
                    metalness={0.9}
                    roughness={0.3}
                    transparent={dimmed}
                    opacity={bodyOpacity}
                  />
                </mesh>
              ))}
            </group>
          ))}
        </group>

        {/* pin-header solder fillets ringing each pin base (1 draw, instanced) */}
        <instancedMesh
          name="solder-joints"
          data-testid="esp32-solder-joints"
          ref={solderRef}
          args={[undefined, undefined, SOLDER_N]}
          frustumCulled={false}
        >
          <cylinderGeometry args={[0.022, 0.026, 0.012, 12]} />
          <meshStandardMaterial
            color={SOLDER}
            metalness={0.9}
            roughness={0.35}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </instancedMesh>

        {/* ESP32 module: silver shield can with an etched marking hint */}
        <mesh name="module" data-testid="esp32-module" position={[0, 0.8, 0.032]}>
          <boxGeometry args={[0.34, 0.26, 0.028]} />
          <meshStandardMaterial
            color={SHIELD}
            metalness={0.95}
            roughness={0.25}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>
        <mesh name="module-etch" position={[0, 0.8, 0.047]}>
          <planeGeometry args={[0.2, 0.05]} />
          <meshStandardMaterial
            color={SHIELD_ETCH}
            metalness={0.9}
            roughness={0.4}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>

        {/* voltage regulator with its tab sunk toward the PCB */}
        <mesh name="regulator" data-testid="esp32-regulator" position={[-0.14, 0.63, 0.0285]}>
          <boxGeometry args={[0.09, 0.06, 0.022]} />
          <meshStandardMaterial
            color={NEAR_BLACK}
            metalness={0.6}
            roughness={0.45}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>
        {/* electrolytic cans around the regulator (1 draw, instanced) */}
        <instancedMesh
          name="capacitors"
          data-testid="esp32-capacitors"
          ref={capsRef}
          args={[undefined, undefined, CAP_SPOTS.length]}
          frustumCulled={false}
        >
          <cylinderGeometry args={[0.018, 0.018, 0.03, 12]} />
          <meshStandardMaterial
            color={NEAR_BLACK}
            metalness={0.4}
            roughness={0.45}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </instancedMesh>

        {/* crystal oscillator can on the USB end of the board */}
        <mesh name="crystal" data-testid="esp32-crystal" position={[0, 0.955, 0.0265]}>
          <boxGeometry args={[0.1, 0.035, 0.018]} />
          <meshStandardMaterial
            color={SHIELD}
            metalness={0.95}
            roughness={0.25}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>
        {/* series diode with its cathode band */}
        <mesh
          name="diode"
          data-testid="esp32-diode"
          position={[-0.095, 0.96, 0.028]}
          rotation-z={Math.PI / 2}
        >
          <cylinderGeometry args={[0.011, 0.011, 0.06, 12]} />
          <meshStandardMaterial
            color={NEAR_BLACK}
            roughness={0.5}
            metalness={0.3}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>
        <mesh name="diode-band" position={[-0.075, 0.96, 0.028]} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.012, 0.012, 0.008, 12]} />
          <meshStandardMaterial color={SOLDER} metalness={0.9} roughness={0.35} />
        </mesh>
        {/* resettable fuse */}
        <mesh name="fuse" data-testid="esp32-fuse" position={[0.1, 0.96, 0.028]}>
          <boxGeometry args={[0.05, 0.04, 0.02]} />
          <meshStandardMaterial
            color={FUSE_YELLOW}
            roughness={0.55}
            metalness={0.1}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>

        {/* power LED (red) + RGB LED (blue) tucked between crystal and USB */}
        <mesh name="power-led" data-testid="esp32-power-led" position={[-0.03, 0.981, 0.026]}>
          <boxGeometry args={[0.03, 0.012, 0.015]} />
          <meshStandardMaterial
            data-testid="esp32-power-material"
            color={NEAR_BLACK}
            emissive={POWER_RED}
            emissiveIntensity={dimmed ? 0.12 : 1.4}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>
        <mesh name="rgb-led" data-testid="esp32-rgb-led" position={[0.03, 0.981, 0.026]}>
          <boxGeometry args={[0.03, 0.012, 0.015]} />
          <meshStandardMaterial
            data-testid="esp32-rgb-material"
            color={NEAR_BLACK}
            emissive={SCREEN_GLOW}
            emissiveIntensity={dimmed ? 0.1 : 1.0}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>

        {/* silkscreen label hints: pin columns + USB-end titles (1 draw) */}
        <instancedMesh
          name="silkscreen"
          data-testid="esp32-silkscreen"
          ref={silkRef}
          args={[undefined, undefined, SILK_LINES.length]}
          frustumCulled={false}
        >
          <planeGeometry args={[0.05, 0.011]} />
          <meshStandardMaterial
            color={SCREEN_BASE}
            emissive={TIMER_DIGITS}
            emissiveIntensity={dimmed ? 0.05 : 0.6}
          />
        </instancedMesh>

        {/* TFT flex ribbon running up the left edge into its PCB connector */}
        <mesh name="flex-ribbon" data-testid="esp32-flex-ribbon" position={[-0.245, 0.575, 0.025]}>
          <boxGeometry args={[0.03, 0.17, 0.006]} />
          <meshStandardMaterial
            color={FLEX}
            roughness={0.6}
            metalness={0.2}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>
        <mesh
          name="flex-connector"
          data-testid="esp32-flex-connector"
          position={[-0.245, 0.648, 0.032]}
        >
          <boxGeometry args={[0.04, 0.03, 0.02]} />
          <meshStandardMaterial
            color={NEAR_BLACK}
            roughness={0.5}
            metalness={0.3}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>

        {/* TFT display module mounted forward over the lower PCB */}
        <mesh name="bezel" data-testid="esp32-bezel" position={[0, TFT_CENTER_Y, 0.055]}>
          <boxGeometry args={[TFT_W, TFT_H, 0.035]} />
          <meshStandardMaterial
            color={NEAR_BLACK}
            roughness={0.5}
            metalness={0.3}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>
        {/* SD-card slot recess on the bezel edge + card hint half-inserted */}
        <mesh name="sd-slot" data-testid="esp32-sd-slot" position={[-0.23, 0.25, 0.055]}>
          <boxGeometry args={[0.016, 0.18, 0.024]} />
          <meshStandardMaterial color={PCB_EDGE} roughness={0.7} metalness={0.2} />
        </mesh>
        <mesh name="sd-card" data-testid="esp32-sd-card" position={[-0.243, 0.25, 0.055]}>
          <boxGeometry args={[0.024, 0.12, 0.012]} />
          <meshStandardMaterial
            color={SHIELD}
            metalness={0.8}
            roughness={0.4}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>
        {/* bezel screws ringing the TFT glass (1 draw, instanced) */}
        <instancedMesh
          name="bezel-screws"
          data-testid="esp32-bezel-screws"
          ref={screwsRef}
          args={[undefined, undefined, BEZEL_SCREW_SPOTS.length]}
          frustumCulled={false}
        >
          <cylinderGeometry args={[0.012, 0.012, 0.01, 12]} />
          <meshStandardMaterial color={NEAR_BLACK} roughness={0.5} metalness={0.5} />
        </instancedMesh>
        {/* brass standoff spacers mounting the TFT off the PCB (1 draw) */}
        <instancedMesh
          name="standoffs"
          data-testid="esp32-standoffs"
          ref={standoffsRef}
          args={[undefined, undefined, BEZEL_SCREW_SPOTS.length]}
          frustumCulled={false}
        >
          <cylinderGeometry args={[0.016, 0.016, 0.02, 12]} />
          <meshStandardMaterial color={PIN_GOLD} metalness={0.9} roughness={0.35} />
        </instancedMesh>
        {/* glowing 128:160 portrait screen face */}
        <mesh name="screen" data-testid="esp32-screen" position={[0, TFT_CENTER_Y, TFT_FRONT_Z]}>
          <planeGeometry args={[SCREEN_W, SCREEN_H]} />
          <meshStandardMaterial
            data-testid="esp32-screen-material"
            color={SCREEN_BASE}
            emissive={SCREEN_GLOW}
            emissiveIntensity={screenGlow}
          />
        </mesh>
        {/* mini UI: project header bar */}
        <mesh name="screen-header" position={[0, 0.4875, UI_Z]}>
          <planeGeometry args={[SCREEN_W, 0.075]} />
          <meshStandardMaterial
            color={SCREEN_BASE}
            emissive={SCREEN_GLOW}
            emissiveIntensity={headerGlow}
          />
        </mesh>
        {/* mini UI: focus timer digit hints */}
        {[-0.105, 0, 0.105].map((x, i) => (
          <mesh key={i} name={`screen-timer-${i}`} position={[x, 0.355, UI_Z]}>
            <boxGeometry args={[0.075, 0.105, 0.006]} />
            <meshStandardMaterial
              color={SCREEN_BASE}
              emissive={TIMER_DIGITS}
              emissiveIntensity={uiGlow}
            />
          </mesh>
        ))}
        {/* mini UI: tiny waveform trace */}
        {[
          { x: -0.12, dy: 0, r: 0.6 },
          { x: -0.06, dy: 0.02, r: -0.6 },
          { x: 0, dy: -0.01, r: 0.6 },
          { x: 0.06, dy: 0.02, r: -0.6 },
          { x: 0.12, dy: 0, r: 0 }
        ].map((seg, i) => (
          <mesh
            key={i}
            name={`screen-wave-${i}`}
            position={[seg.x, 0.18 + seg.dy, UI_Z]}
            rotation-z={seg.r}
          >
            <boxGeometry args={[0.07, 0.012, 0.005]} />
            <meshStandardMaterial
              color={SCREEN_BASE}
              emissive={WAVE_TRACE}
              emissiveIntensity={dimmed ? 0.05 : 0.8}
            />
          </mesh>
        ))}

        {/* micro-USB port on the top short edge */}
        <mesh name="usb" data-testid="esp32-usb" position={[0, 1.02, 0]}>
          <boxGeometry args={[0.13, 0.06, 0.1]} />
          <meshStandardMaterial
            color={USB_SHELL}
            metalness={0.95}
            roughness={0.3}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>
        <mesh name="usb-slot" position={[0, 1.02, 0.051]}>
          <planeGeometry args={[0.09, 0.025]} />
          <meshStandardMaterial color={NEAR_BLACK} roughness={0.7} metalness={0.2} />
        </mesh>

        {/* BOOT + EN tactile buttons flanking the module */}
        <mesh
          name="boot"
          data-testid="esp32-boot"
          position={[-0.17, 0.925, 0.03]}
          rotation-x={Math.PI / 2}
        >
          <cylinderGeometry args={[0.032, 0.032, 0.025, 16]} />
          <meshStandardMaterial
            color={NEAR_BLACK}
            roughness={0.5}
            metalness={0.3}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>
        <mesh
          name="en"
          data-testid="esp32-en"
          position={[0.17, 0.925, 0.03]}
          rotation-x={Math.PI / 2}
        >
          <cylinderGeometry args={[0.032, 0.032, 0.025, 16]} />
          <meshStandardMaterial
            color={NEAR_BLACK}
            roughness={0.5}
            metalness={0.3}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>
        {/* BOOT/EN button caps standing proud of the tactile bases */}
        <mesh
          name="boot-cap"
          data-testid="esp32-boot-cap"
          position={[-0.17, 0.925, 0.046]}
          rotation-x={Math.PI / 2}
        >
          <cylinderGeometry args={[0.02, 0.02, 0.012, 16]} />
          <meshStandardMaterial
            color={PLASTIC}
            roughness={0.5}
            metalness={0.3}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>
        <mesh
          name="en-cap"
          data-testid="esp32-en-cap"
          position={[0.17, 0.925, 0.046]}
          rotation-x={Math.PI / 2}
        >
          <cylinderGeometry args={[0.02, 0.02, 0.012, 16]} />
          <meshStandardMaterial
            color={PLASTIC}
            roughness={0.5}
            metalness={0.3}
            transparent={dimmed}
            opacity={bodyOpacity}
          />
        </mesh>
        {/* BOOT/EN silkscreen legends outboard of the buttons (1 draw) */}
        <instancedMesh
          name="button-legends"
          data-testid="esp32-button-legends"
          ref={legendsRef}
          args={[undefined, undefined, LEGEND_X.length]}
          frustumCulled={false}
        >
          <planeGeometry args={[0.07, 0.014]} />
          <meshStandardMaterial
            color={SCREEN_BASE}
            emissive={TIMER_DIGITS}
            emissiveIntensity={dimmed ? 0.05 : 0.6}
          />
        </instancedMesh>

        {/* PCB status LED driven by the node status */}
        <mesh name="status-light" data-testid="esp32-status-light" position={[0.19, 0.63, 0.028]}>
          <boxGeometry args={[0.05, 0.03, 0.02]} />
          <meshStandardMaterial
            data-testid="esp32-status-material"
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

// ESP32 desk display, centered at the origin, front facing +Z, standing on
// y=0 via its desk stand. No lights, no textures, no frame loop of its own —
// the integration lane owns the Canvas, lights and frameloop="demand".
function Esp32DeskDisplay({
  status,
  dimmed = false,
  scale = 1
}: Esp32DeskDisplayProps): React.JSX.Element {
  return (
    <group data-testid="esp32-desk-display" scale={scale}>
      <Esp32DeskDisplayInner status={status} dimmed={dimmed} />
    </group>
  )
}

export default memo(Esp32DeskDisplay)
