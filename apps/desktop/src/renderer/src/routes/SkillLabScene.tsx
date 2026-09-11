/* eslint-disable react/no-unknown-property -- R3F three intrinsics (position, rotation, scale, args, geometry, material, …) that the DOM property allowlist cannot know. Scoped to this scene file only. */
/* eslint-disable react-refresh/only-export-components -- scene-owned pure layout helpers (grid math, standalone split, overview fit) live beside the component so the scene stays a single-file lane. */
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Html, OrbitControls } from '@react-three/drei'
import { ZERO_TOKENS, ZERO_TYPE } from '../../../shared/tokens'
import {
  FOCUS_TWEEN_MS,
  SCENE_FRAMELOOP,
  easeInOutCubic,
  focusCameraFor,
  focusReduce,
  isWebGL2Available,
  type FocusState
} from './topology.model'
import SkillVial, { MODEL_FOOTPRINT as VIAL_FOOTPRINT } from './models/SkillVial'
import type { PluginGroup, SkillSummary } from './skillPlugins'

// Lab-shelf scene for the Skill Lab route: one vial per installed plugin on a
// dark shelf, standalone skills as smaller vials in their own row, and a
// self-learning list beside the grid. Data arrives fully via props (the route
// wires discovery with an honestly-guarded IPC op); this scene never touches
// window.zero, sockets, or the filesystem.

// Gaps between neighbouring vials, in scene units (footprint comes from the
// sibling vial model: { w: 0.9, h: 1.6, d: 0.9 }).
export const VIAL_GAP_X = 0.7
export const VIAL_GAP_Z = 1.1
export const VIAL_STEP_X = VIAL_FOOTPRINT.w + VIAL_GAP_X
export const VIAL_STEP_Z = VIAL_FOOTPRINT.d + VIAL_GAP_Z
export const STANDALONE_SCALE = 0.7
export const STANDALONE_ROW_DZ = 1.4

// Grid columns derive from the group count (row-major fill); the tests pin
// the exact shapes so a layout move cannot silently reflow the shelf.
export function layoutVialGrid(count: number): { cols: number; rows: number } {
  if (count <= 0) return { cols: 0, rows: 0 }
  const cols = Math.ceil(Math.sqrt(count))
  return { cols, rows: Math.ceil(count / cols) }
}

// Local grid coordinates for the nth plugin vial (row-major). The scene
// centers the whole arrangement by shifting the parent group.
export function vialPosition(index: number, cols: number): [number, number, number] {
  const safeCols = Math.max(1, cols)
  const col = index % safeCols
  const row = Math.floor(index / safeCols)
  return [col * VIAL_STEP_X, 0, row * VIAL_STEP_Z]
}

// Installed skills with no owning plugin render as smaller vials in their own
// row (deduped by id; first occurrence wins).
export function standaloneSkills(groups: PluginGroup[]): SkillSummary[] {
  const seen = new Set<string>()
  const out: SkillSummary[] = []
  for (const g of groups) {
    for (const s of g.skills) {
      if (s.pluginId !== null && s.pluginId !== undefined) continue
      if (seen.has(s.id)) continue
      seen.add(s.id)
      out.push(s)
    }
  }
  return out
}

// Overview camera fit for a shelf of the given width (the close-up endpoints
// reuse the shared focusCameraFor so the tween feel matches the desk scene).
export function labOverviewFor(shelfW: number): {
  position: [number, number, number]
  target: [number, number, number]
} {
  return {
    position: [0, 4.6, 7.6 + shelfW * 0.4],
    target: [0, 0.7, 0.4]
  }
}

const pluginFocusId = (id: string): string => `plugin:${id}`
const skillFocusId = (id: string): string => `skill:${id}`

const vialRadius = (scale: number): number =>
  (Math.max(VIAL_FOOTPRINT.w, VIAL_FOOTPRINT.h, VIAL_FOOTPRINT.d) / 2) * scale

// Bounded camera tween for click-to-focus (same convention as TopologyScene:
// a short-lived ~60fps interval exists ONLY for the tween lifetime so
// frameloop="demand" stands; restarts on viewKey change, cancels on unmount).
type Flight = {
  fromPos: THREE.Vector3
  toPos: THREE.Vector3
  fromTg: THREE.Vector3
  toTg: THREE.Vector3
  t0: number
  interval: number | null
}

function stopFlight(f: Flight | null): void {
  if (f?.interval !== null && f?.interval !== undefined) {
    window.clearInterval(f.interval)
    f.interval = null
  }
}

function FocusController({
  viewKey,
  view
}: {
  viewKey: string
  view: { position: [number, number, number]; target: [number, number, number] }
}): null {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as {
    target: THREE.Vector3
    update: () => void
  } | null
  const invalidate = useThree((s) => s.invalidate)
  const viewRef = useRef(view)
  useEffect(() => {
    viewRef.current = view
  })
  const flight = useRef<Flight | null>(null)
  const mounted = useRef(false)
  useEffect(() => {
    // Mount renders the overview camera already; only viewKey CHANGES fly.
    if (!mounted.current) {
      mounted.current = true
      return
    }
    const v = viewRef.current
    stopFlight(flight.current)
    const next: Flight = {
      fromPos: camera.position.clone(),
      toPos: new THREE.Vector3(v.position[0], v.position[1], v.position[2]),
      fromTg: controls?.target.clone() ?? new THREE.Vector3(0, 0.7, 0.4),
      toTg: new THREE.Vector3(v.target[0], v.target[1], v.target[2]),
      t0: performance.now(),
      interval: window.setInterval(() => invalidate(), 16)
    }
    flight.current = next
    return () => {
      stopFlight(next)
      if (flight.current === next) flight.current = null
    }
    // viewKey is the tween trigger; view itself rides viewRef so inline
    // object identity never restarts the flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey])
  useEffect(
    () => () => {
      stopFlight(flight.current)
      flight.current = null
    },
    []
  )
  useFrame(() => {
    const f = flight.current
    if (f === null) return
    const t = Math.min(1, (performance.now() - f.t0) / FOCUS_TWEEN_MS)
    const e = easeInOutCubic(t)
    camera.position.lerpVectors(f.fromPos, f.toPos, e)
    if (controls !== null && controls !== undefined) {
      controls.target.lerpVectors(f.fromTg, f.toTg, e)
      controls.update()
    } else {
      camera.lookAt(f.toTg)
    }
    if (t >= 1) {
      stopFlight(f)
      if (flight.current === f) flight.current = null
    }
  })
  return null
}

// Re-renders one frame when the typed data, the hover, or the focus changes.
function Invalidator({
  groups,
  selfLearnt,
  hoveredId,
  focusedId
}: {
  groups: PluginGroup[]
  selfLearnt: SkillSummary[]
  hoveredId: string | null
  focusedId: string | null
}): null {
  const invalidate = useThree((s) => s.invalidate)
  const seen = useRef(false)
  const sig = useRef({ groups, selfLearnt, hoveredId, focusedId })
  useEffect(() => {
    if (!seen.current) {
      seen.current = true
    } else if (
      sig.current.groups !== groups ||
      sig.current.selfLearnt !== selfLearnt ||
      sig.current.hoveredId !== hoveredId ||
      sig.current.focusedId !== focusedId
    ) {
      invalidate()
    }
    sig.current = { groups, selfLearnt, hoveredId, focusedId }
  }, [groups, selfLearnt, hoveredId, focusedId, invalidate])
  return null
}

const labelStyle: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 8,
  fontWeight: 700,
  letterSpacing: '0.06em',
  color: 'var(--z-ink)',
  background: 'var(--z-card-cream)',
  border: '1px solid var(--z-line)',
  borderRadius: 5,
  padding: '3px 7px',
  whiteSpace: 'nowrap'
}

const sceneWrap: React.CSSProperties = {
  position: 'relative',
  height: 320,
  borderRadius: 10,
  overflow: 'hidden',
  background: 'var(--z-card-cream)',
  border: '1px solid var(--z-line)'
}

const vignetteStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  background: 'radial-gradient(ellipse at center, transparent 55%, rgba(92, 64, 56, 0.14) 100%)'
}

const captionStyle: React.CSSProperties = {
  position: 'absolute',
  left: 10,
  bottom: 8,
  fontFamily: ZERO_TYPE.mono,
  fontSize: 9,
  letterSpacing: '0.08em',
  color: 'var(--z-secondary-ink)',
  pointerEvents: 'none'
}

const detailStyle: React.CSSProperties = {
  position: 'absolute',
  top: 10,
  right: 10,
  width: 248,
  maxHeight: 'calc(100% - 32px)',
  overflowY: 'auto',
  background: 'var(--z-card-cream)',
  border: '1px solid var(--z-line)',
  borderRadius: 8,
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  fontFamily: ZERO_TYPE.mono
}

const detailName: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--z-ink)'
}

const detailRow: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--z-secondary-ink)',
  lineHeight: 1.5
}

const backStyle: React.CSSProperties = {
  marginTop: 2,
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  color: 'var(--z-ink)',
  background: 'transparent',
  border: '1px solid var(--z-line)',
  borderRadius: 5,
  padding: '5px 8px',
  cursor: 'pointer'
}

const selfLearnWrap: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  marginBottom: 10
}

const selfLearnRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 9,
  background: 'var(--z-card-cream)',
  border: '1px solid var(--z-line)',
  borderRadius: 8,
  padding: '8px 11px'
}

const initialChip = (background: string): React.CSSProperties => ({
  width: 20,
  height: 20,
  borderRadius: 10,
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: ZERO_TYPE.mono,
  fontSize: 11,
  fontWeight: 700,
  color: '#FFFFFF',
  background
})

const skillNameStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--z-ink)'
}

const skillDescStyle: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10.5,
  color: 'var(--z-secondary-ink)',
  lineHeight: 1.5,
  margin: '2px 0 0'
}

const skillMetaStyle: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 9,
  letterSpacing: '0.06em',
  color: 'var(--z-secondary-ink)',
  margin: '3px 0 0'
}

const microStyle: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.14em',
  color: 'var(--z-secondary-ink)'
}

const emptyStyle: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10.5,
  color: 'var(--z-secondary-ink)',
  lineHeight: 1.6,
  margin: 0
}

// One skill row: token-colored initial chip (first letter, plugin color) plus
// the plugin glyph name as text — no new icon assets.
function SkillRow({
  skill,
  color,
  glyphLabel
}: {
  skill: SkillSummary
  color: string
  glyphLabel: string
}): React.JSX.Element {
  const initial = skill.name.trim().charAt(0).toUpperCase() || '?'
  return (
    <div data-testid={`vial-skill-${skill.id}`} style={{ display: 'flex', gap: 8 }}>
      <span title={skill.icon ?? 'initial'} style={initialChip(color)}>
        {initial}
      </span>
      <div style={{ minWidth: 0 }}>
        <span style={skillNameStyle}>{skill.name}</span>
        <p style={skillDescStyle}>
          {skill.description?.trim() ? skill.description : 'No description.'}
        </p>
        <p style={skillMetaStyle}>
          {skill.source.toUpperCase()} · glyph {glyphLabel}
        </p>
      </div>
    </div>
  )
}

function SelfLearningSection({ selfLearnt }: { selfLearnt: SkillSummary[] }): React.JSX.Element {
  return (
    <div style={selfLearnWrap}>
      <span style={microStyle}>SELF-LEARNING</span>
      {selfLearnt.length > 0 ? (
        selfLearnt.map((s) => (
          <div key={s.id} data-testid={`scene-selflearn-row-${s.id}`} style={selfLearnRow}>
            <span title={s.icon ?? 'initial'} style={initialChip(ZERO_TOKENS.secondaryInk)}>
              {s.name.trim().charAt(0).toUpperCase() || '?'}
            </span>
            <div style={{ minWidth: 0 }}>
              <span style={skillNameStyle}>{s.name}</span>
              <p style={skillDescStyle}>
                {s.description?.trim() ? s.description : 'No description.'}
              </p>
              <p style={skillMetaStyle}>{s.source.toUpperCase()}</p>
            </div>
          </div>
        ))
      ) : (
        <p data-testid="scene-selflearn-empty" style={emptyStyle}>
          No self-learnt skills yet.
        </p>
      )}
    </div>
  )
}

type VialMeshProps = {
  focusId: string
  testId: string
  label: string
  dimmed: boolean
  scale: number
  focused: boolean
  labelsHidden: boolean
  plugin: { id: string; name: string; color: string; glyph: PluginGroup['glyph'] }
  onHover: (id: string | null) => void
  onFocus: (id: string) => void
}

function VialMesh({
  focusId,
  testId,
  label,
  dimmed,
  scale,
  focused,
  labelsHidden,
  plugin,
  onHover,
  onFocus
}: VialMeshProps): React.JSX.Element {
  const ringR = (Math.max(VIAL_FOOTPRINT.w, VIAL_FOOTPRINT.d) / 2 + 0.3) * scale
  return (
    <group
      data-testid={testId}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation()
        onHover(focusId)
      }}
      onPointerOut={() => onHover(null)}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation()
        onFocus(focusId)
      }}
    >
      <SkillVial
        plugin={{ id: plugin.id, name: plugin.name, color: plugin.color, glyph: plugin.glyph }}
        dimmed={dimmed}
        scale={scale}
      />
      {focused ? (
        <mesh data-testid={`vial-focus-ring-${focusId}`} position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[ringR, 0.03, 8, 64]} />
          <meshStandardMaterial
            color={plugin.color}
            emissive={plugin.color}
            emissiveIntensity={0.9}
          />
        </mesh>
      ) : null}
      {labelsHidden ? null : (
        <group position={[0, VIAL_FOOTPRINT.h * scale + 0.35, 0]}>
          <Html center distanceFactor={9}>
            <div style={labelStyle}>{label}</div>
          </Html>
        </group>
      )}
    </group>
  )
}

export type SkillLabSceneProps = {
  groups: PluginGroup[]
  selfLearnt: SkillSummary[]
}

export const SkillLabScene = memo(function SkillLabScene({
  groups,
  selfLearnt
}: SkillLabSceneProps): React.JSX.Element {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [focus, setFocus] = useState<FocusState>({ focusedId: null })
  const available = useMemo(() => isWebGL2Available(), [])

  const { cols, rows } = useMemo(() => layoutVialGrid(groups.length), [groups.length])
  const standalone = useMemo(() => standaloneSkills(groups), [groups])
  const byGroupId = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups])
  const standaloneById = useMemo(() => new Map(standalone.map((s) => [s.id, s])), [standalone])

  // Row-major grid coordinates, then the standalone row behind it; the whole
  // arrangement is recentered so the shelf sits under the overview target.
  const gridPositions = useMemo(
    () => groups.map((_, i) => vialPosition(i, cols)),
    [groups, cols]
  )
  const gridSpanZ = rows > 0 ? (rows - 1) * VIAL_STEP_Z : 0
  const standaloneZ = rows > 0 ? rows * VIAL_STEP_Z + STANDALONE_ROW_DZ : STANDALONE_ROW_DZ
  const spanMaxZ = standalone.length > 0 ? standaloneZ : gridSpanZ
  const originX = cols > 0 ? -((cols - 1) * VIAL_STEP_X) / 2 : 0
  const originZ = -spanMaxZ / 2
  const shelfW = Math.max(cols > 0 ? cols * VIAL_STEP_X + 1.4 : 4, 4)
  const shelfD = spanMaxZ + 2.4

  const isSelectable = useMemo(() => {
    const ids = new Set<string>()
    for (const g of groups) ids.add(pluginFocusId(g.id))
    for (const s of standalone) ids.add(skillFocusId(s.id))
    return (id: string): boolean => ids.has(id)
  }, [groups, standalone])

  const focusedGroup =
    focus.focusedId !== null && focus.focusedId.startsWith('plugin:')
      ? (byGroupId.get(focus.focusedId.slice('plugin:'.length)) ?? null)
      : null
  const focusedSkill =
    focus.focusedId !== null && focus.focusedId.startsWith('skill:')
      ? (standaloneById.get(focus.focusedId.slice('skill:'.length)) ?? null)
      : null
  // A focused entry that left the props releases focus instead of pointing at
  // stale data (same honesty rule as the desk scene).
  const activeGroup = focusedGroup !== null && isSelectable(pluginFocusId(focusedGroup.id)) ? focusedGroup : null
  const activeSkill = focusedSkill !== null && isSelectable(skillFocusId(focusedSkill.id)) ? focusedSkill : null
  const hasFocus = activeGroup !== null || activeSkill !== null

  const overview = useMemo(() => labOverviewFor(shelfW), [shelfW])
  const view = useMemo(() => {
    if (activeGroup !== null) {
      const i = groups.findIndex((g) => g.id === activeGroup.id)
      const p = gridPositions[i] ?? [0, 0, 0]
      return focusCameraFor(
        [p[0] + originX, p[1] + VIAL_FOOTPRINT.h / 2, p[2] + originZ],
        vialRadius(1)
      )
    }
    if (activeSkill !== null) {
      const i = standalone.findIndex((s) => s.id === activeSkill.id)
      const x = originX + (i >= 0 ? i * VIAL_STEP_X * STANDALONE_SCALE : 0)
      return focusCameraFor(
        [x, (VIAL_FOOTPRINT.h * STANDALONE_SCALE) / 2, standaloneZ + originZ],
        vialRadius(STANDALONE_SCALE)
      )
    }
    return overview
  }, [activeGroup, activeSkill, groups, gridPositions, originX, originZ, overview, standalone, standaloneZ])
  const viewKey = focus.focusedId ?? '__overview__'

  const exitFocus = (): void => {
    setFocus((s) => focusReduce(s, { type: 'empty' }, isSelectable))
  }
  const requestFocus = (id: string): void => {
    setFocus((s) => focusReduce(s, { type: 'focus', id }, isSelectable))
  }

  useEffect(() => {
    if (!hasFocus) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') exitFocus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // isSelectable is props-derived; exitFocus is stable logic.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFocus])

  if (!available) {
    return (
      <div>
        <SelfLearningSection selfLearnt={selfLearnt} />
        <div data-testid="skilllab-fallback" style={{ ...sceneWrap, height: 'auto', padding: 14 }}>
          <span style={captionStyle}>
            3D unavailable (no WebGL2) — the plugin list below is the source.
          </span>
          {groups.length === 0 ? (
            <p data-testid="vial-grid-empty" style={emptyStyle}>
              No plugin vials — discovery returned empty.
            </p>
          ) : (
            groups.map((g) => (
              <p key={g.id} style={emptyStyle}>
                {g.name} · {g.skills.length} skill{g.skills.length === 1 ? '' : 's'}
              </p>
            ))
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <SelfLearningSection selfLearnt={selfLearnt} />
      <div data-testid="skilllab-scene" style={sceneWrap}>
        <Canvas
          frameloop={SCENE_FRAMELOOP}
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          camera={{
            position: [overview.position[0], overview.position[1], overview.position[2]],
            fov: 42
          }}
          onPointerMissed={() => exitFocus()}
        >
          <ambientLight intensity={0.85} />
          <directionalLight position={[4, 6, 6]} intensity={1.1} />
          <directionalLight position={[-5, 3, -2]} intensity={0.25} />
          <Invalidator
            groups={groups}
            selfLearnt={selfLearnt}
            hoveredId={hoveredId}
            focusedId={focus.focusedId}
          />
          <FocusController viewKey={viewKey} view={view} />
          {/* Dark lab shelf slab plus a low back panel (furniture, not data). */}
          <mesh name="lab-shelf" data-testid="lab-shelf" position={[0, -0.09, 0]}>
            <boxGeometry args={[shelfW, 0.18, shelfD]} />
            <meshStandardMaterial color={ZERO_TOKENS.ink} roughness={0.85} metalness={0} />
          </mesh>
          <mesh
            name="lab-shelf-back"
            data-testid="lab-shelf-back"
            position={[0, 1.1, -shelfD / 2 + 0.08]}
          >
            <boxGeometry args={[shelfW, 2.4, 0.16]} />
            <meshStandardMaterial color={ZERO_TOKENS.secondaryInk} roughness={0.9} metalness={0} />
          </mesh>
          <group position={[originX, 0, originZ]}>
            {groups.length === 0 ? (
              <group position={[-originX, 0.8, spanMaxZ / 2]}>
                <Html center distanceFactor={9}>
                  <div data-testid="vial-grid-empty" style={labelStyle}>
                    No plugin vials — discovery returned empty.
                  </div>
                </Html>
              </group>
            ) : (
              groups.map((g, i) => {
                const p = gridPositions[i] ?? [0, 0, 0]
                const fid = pluginFocusId(g.id)
                return (
                  <group key={g.id} position={p}>
                    <VialMesh
                      focusId={fid}
                      testId={`vial-${g.id}`}
                      label={g.name}
                      dimmed={hasFocus && activeGroup?.id !== g.id}
                      scale={1}
                      focused={activeGroup?.id === g.id}
                      labelsHidden={hasFocus}
                      plugin={{ id: g.id, name: g.name, color: g.color, glyph: g.glyph }}
                      onHover={setHoveredId}
                      onFocus={requestFocus}
                    />
                  </group>
                )
              })
            )}
            {standalone.length > 0 ? (
              <group position={[0, 0, standaloneZ]}>
                <group position={[0, 0.05, -0.75]}>
                  <Html center distanceFactor={9}>
                    <div data-testid="standalone-row-label" style={labelStyle}>
                      STANDALONE
                    </div>
                  </Html>
                </group>
                {standalone.map((s, i) => {
                  const fid = skillFocusId(s.id)
                  return (
                    <group key={s.id} position={[i * VIAL_STEP_X * STANDALONE_SCALE, 0, 0]}>
                      <VialMesh
                        focusId={fid}
                        testId={`vial-standalone-${s.id}`}
                        label={s.name}
                        dimmed={hasFocus && activeSkill?.id !== s.id}
                        scale={STANDALONE_SCALE}
                        focused={activeSkill?.id === s.id}
                        labelsHidden={hasFocus}
                        plugin={{ id: s.id, name: s.name, color: ZERO_TOKENS.secondaryInk, glyph: 'orb' }}
                        onHover={setHoveredId}
                        onFocus={requestFocus}
                      />
                    </group>
                  )
                })}
              </group>
            ) : (
              <group position={[0, 0.05, standaloneZ]}>
                <Html center distanceFactor={9}>
                  <div data-testid="standalone-row-empty" style={labelStyle}>
                    STANDALONE · none
                  </div>
                </Html>
              </group>
            )}
          </group>
          <OrbitControls
            enableDamping
            dampingFactor={0.12}
            autoRotate={false}
            enablePan
            enableZoom
            enableRotate
            minDistance={2}
            maxDistance={22}
            maxPolarAngle={Math.PI / 2 - 0.06}
            makeDefault
          />
        </Canvas>
        <div style={vignetteStyle} />
        {activeGroup !== null ? (
          <div data-testid="vial-detail" style={detailStyle}>
            <span style={detailName}>{activeGroup.name}</span>
            <span style={detailRow}>
              PLUGIN {activeGroup.id} · glyph {activeGroup.glyph} · {activeGroup.skills.length}{' '}
              skill{activeGroup.skills.length === 1 ? '' : 's'}
            </span>
            {activeGroup.skills.length > 0 ? (
              activeGroup.skills.map((s) => (
                <SkillRow key={s.id} skill={s} color={activeGroup.color} glyphLabel={activeGroup.glyph} />
              ))
            ) : (
              <span style={detailRow}>No skills in this plugin.</span>
            )}
            <button type="button" data-testid="vial-back" style={backStyle} onClick={exitFocus}>
              ← BACK TO SHELF
            </button>
          </div>
        ) : null}
        {activeSkill !== null ? (
          <div data-testid="vial-detail" style={detailStyle}>
            <span style={detailName}>{activeSkill.name}</span>
            <span style={detailRow}>STANDALONE SKILL</span>
            <SkillRow skill={activeSkill} color={ZERO_TOKENS.secondaryInk} glyphLabel="orb" />
            <button type="button" data-testid="vial-back" style={backStyle} onClick={exitFocus}>
              ← BACK TO SHELF
            </button>
          </div>
        ) : null}
        <span style={captionStyle}>
          SKILLS LAB SHELF · DRAG ORBIT · RIGHT-DRAG PAN · SCROLL ZOOM · CLICK A VIAL TO FOCUS
        </span>
      </div>
    </div>
  )
})
