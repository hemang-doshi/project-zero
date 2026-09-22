import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { elapsed } from '../../../shared/format'
import { ZERO_TYPE } from '../../../shared/tokens'
import { useCockpit } from '../store/cockpit'
import { Chip } from './Chip'
import {
  agentRuns,
  bassPolyline,
  initBass,
  pushBass,
  type AgentRun,
  type BassTrace,
  type BridgeStatePair
} from './desk.model'
import type { RuntimeConnState } from '../../../shared/protocol'
import {
  activeProjectLabel,
  connectivity,
  displayNodes,
  extrapolate,
  gitLine,
  nodeTone,
  parseSnapshot,
  selectSession,
  selectSpotify,
  sessionChipTone,
  type CockpitAudio,
  type CockpitNode,
  type SpotifyMedia,
  type Tone
} from './runtime.types'
import type { BridgeEvent, Harness } from './runtime.types'

const routeStyle: React.CSSProperties = {
  height: '100%',
  overflowY: 'auto',
  padding: '20px 22px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14
}

const microStyle: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.14em',
  color: 'var(--z-secondary-ink)'
}

const headerRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 12
}

const projectStyle: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 800,
  color: 'var(--z-ink)',
  lineHeight: 1.2
}

const elapsedStyle: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 30,
  fontWeight: 800,
  color: 'var(--z-ink)',
  lineHeight: 1.1,
  fontVariantNumeric: 'tabular-nums'
}

const detailStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: 'var(--z-secondary-ink)',
  lineHeight: 1.5
}

const gitStyle: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 11.5,
  color: 'var(--z-ink)',
  borderTop: '1px solid var(--z-line)',
  paddingTop: 12
}

const cardStyle: React.CSSProperties = {
  background: 'var(--z-card-cream)',
  border: '1px solid var(--z-line)',
  borderRadius: 8,
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  minWidth: 0
}

const datumLabel: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 8.5,
  fontWeight: 700,
  letterSpacing: '0.12em',
  color: 'var(--z-secondary-ink)'
}

const noticeStyle: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10.5,
  color: 'var(--z-secondary-ink)',
  lineHeight: 1.6,
  margin: 0
}

const mediaTitleStyle: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 12.5,
  fontWeight: 700,
  color: 'var(--z-ink)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const mediaArtistStyle: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10.5,
  color: 'var(--z-secondary-ink)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const coverStyle: React.CSSProperties = {
  width: 56,
  height: 56,
  borderRadius: 6,
  border: '1px solid var(--z-line)',
  imageRendering: 'pixelated',
  flexShrink: 0,
  display: 'block'
}

const coverPlaceholderStyle: React.CSSProperties = {
  ...coverStyle,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--z-canvas-tan)'
}

const waveformBox: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  borderTop: '1px solid var(--z-line)',
  paddingTop: 8
}

const nodeRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 10,
  minWidth: 0
}

const nodeIdStyle: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--z-ink)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const nodeDetailStyle: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10.5,
  color: 'var(--z-secondary-ink)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const runRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 10,
  padding: '4px 0',
  borderBottom: '1px solid color-mix(in srgb, var(--z-line) 70%, transparent)',
  minWidth: 0
}

const clockStamp = (iso: string | null): string =>
  iso !== null && iso.length >= 19 ? iso.slice(11, 19) : '—'

const WAVE_W = 220
const WAVE_H = 44

function BassWaveform({
  audio,
  live,
  playing
}: {
  audio: CockpitAudio | null
  live: boolean
  playing: boolean
}): React.JSX.Element {
  // Rolling trace without effects: the parent re-renders on every cockpit
  // push, so the next point is folded in during render (the documented
  // adjust-state-when-props-change pattern — no ref reads, no effect setState).
  const bass = audio?.bass ?? null
  const status = audio?.status ?? 'DISABLED'
  const sequence = audio?.sequence ?? -1
  const [trace, setTrace] = useState<BassTrace>(() => initBass())
  const [prevKey, setPrevKey] = useState<string | null>(null)
  const key = `${sequence}:${bass ?? 'x'}:${status}:${live}:${playing}`
  if (prevKey !== key) {
    setPrevKey(key)
    setTrace(pushBass(trace, { bass, status }, live, playing))
  }
  const baseline = bassPolyline([0, 0], WAVE_W, WAVE_H)
  const points = bassPolyline(trace.points, WAVE_W, WAVE_H)
  const activeStroke =
    live && playing && status.toUpperCase() === 'ACTIVE'
      ? 'var(--z-status-green)'
      : 'var(--z-secondary-ink)'
  return (
    <svg
      width={WAVE_W}
      height={WAVE_H}
      viewBox={`0 0 ${WAVE_W} ${WAVE_H}`}
      role="img"
      aria-label="Bass waveform"
    >
      <polyline points={baseline} fill="none" stroke="var(--z-line)" strokeWidth={1} />
      <polyline
        points={points}
        fill="none"
        stroke={activeStroke}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

function parseDataUrl(value: unknown): string | null {
  const url =
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)['dataUrl']
      : null
  return typeof url === 'string' && url.startsWith('data:image/') ? url : null
}

function ArtworkCover({ artworkId }: { artworkId: string | null }): React.JSX.Element {
  // Remounted by the parent keyed on artworkId, so a null id starts with a
  // null url and the effect below never sets state synchronously: it only
  // resolves the async daemon fetch (fail-soft to the honest placeholder).
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (artworkId === null) return
    if (typeof window === 'undefined' || !window.zero) return
    let alive = true
    window.zero
      .invoke('artwork.fetch', { id: artworkId })
      .then((v) => {
        if (alive) setUrl(parseDataUrl(v))
      })
      .catch(() => {
        if (alive) setUrl(null)
      })
    return () => {
      alive = false
    }
  }, [artworkId])
  if (url !== null) {
    return <img src={url} alt="Album artwork" width={56} height={56} style={coverStyle} />
  }
  return (
    <div style={coverPlaceholderStyle}>
      <span style={{ ...datumLabel, letterSpacing: '0.08em' }}>NO ARTWORK</span>
    </div>
  )
}

function mediaChip(
  spotify: SpotifyMedia | null,
  conn: RuntimeConnState
): { label: string; tone: Tone } {
  if (spotify === null) return { label: 'NO MEDIA', tone: 'neutral' }
  if (conn !== 'live') return { label: 'RETAINED MEDIA', tone: 'neutral' }
  if (spotify.status !== 'ONLINE') return { label: 'MEDIA UNAVAILABLE', tone: 'neutral' }
  return { label: 'LIVE MEDIA', tone: 'healthy' }
}

function playChip(
  spotify: SpotifyMedia | null,
  conn: RuntimeConnState
): { label: string; tone: Tone } {
  const state = (spotify?.state ?? '').toUpperCase()
  const label = state === '' ? 'NO PLAY STATE' : state
  if (conn !== 'live') return { label, tone: 'neutral' }
  if (state === 'PLAYING') return { label, tone: 'healthy' }
  if (state === 'PAUSED') return { label, tone: 'attention' }
  return { label, tone: 'neutral' }
}

const asBridgeState = (v: unknown): BridgeStatePair[Harness] => {
  const state = typeof v === 'object' && v !== null ? (v as Record<string, unknown>)['state'] : null
  if (state === 'live' || state === 'connecting') return state
  return 'disconnected'
}

const MAX_BRIDGE_EVENTS = 64

function AgentRunsCard(): React.JSX.Element {
  const [runs, setRuns] = useState<AgentRun[]>([])
  const eventsRef = useRef<BridgeEvent[]>([])
  const statesRef = useRef<BridgeStatePair>({ codex: 'unknown', opencode: 'unknown' })
  useEffect(() => {
    if (typeof window === 'undefined' || !window.zero) return
    let alive = true
    const compute = (): void => {
      if (alive) setRuns(agentRuns(eventsRef.current, statesRef.current))
    }
    const refreshStates = (): void => {
      const apply =
        (harness: Harness): ((v: unknown) => void) =>
        (v) => {
          statesRef.current = { ...statesRef.current, [harness]: asBridgeState(v) }
          compute()
        }
      window.zero
        .invoke('codex.state')
        .then(apply('codex'))
        .catch(() => {
          statesRef.current = { ...statesRef.current, codex: 'disconnected' }
          compute()
        })
      window.zero
        .invoke('ocp.state')
        .then(apply('opencode'))
        .catch(() => {
          statesRef.current = { ...statesRef.current, opencode: 'disconnected' }
          compute()
        })
    }
    const unsubscribe = window.zero.subscribe('bridge', (u) => {
      const push = u as { harness?: unknown; event?: { method?: unknown; params?: unknown } }
      const harness = push.harness === 'codex' || push.harness === 'opencode' ? push.harness : null
      const method = typeof push.event?.method === 'string' ? push.event.method : null
      if (harness === null || method === null) return
      eventsRef.current = [
        ...eventsRef.current.slice(-(MAX_BRIDGE_EVENTS - 1)),
        { harness, method, params: push.event?.params }
      ]
      refreshStates()
      compute()
    })
    refreshStates()
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])
  return (
    <div style={cardStyle}>
      <div style={headerRow}>
        <span style={datumLabel}>AGENT RUNS · HARNESS BRIDGES</span>
        <span style={datumLabel}>{runs.length > 0 ? `${runs.length} ACTIVE` : 'IDLE'}</span>
      </div>
      {runs.length === 0 ? (
        <span style={noticeStyle}>NO ACTIVE AGENT RUNS</span>
      ) : (
        runs.map((run) => (
          <div key={run.id} style={runRow}>
            <span style={{ ...mediaTitleStyle, fontFamily: ZERO_TYPE.mono, fontSize: 11 }}>
              {run.harness === 'codex' ? 'CODEX' : 'OPENCODE'}
            </span>
            <span style={{ ...nodeDetailStyle, flex: 1 }}>{run.label}</span>
            <Chip label={run.state} tone="healthy" />
          </div>
        ))
      )}
      <span style={noticeStyle}>
        Runs derive from streamed bridge events while the harness bridge is live; retained evidence
        never renders as an active run.
      </span>
    </div>
  )
}

function ElapsedClock({
  baseMs,
  ticking,
  receivedAt
}: {
  baseMs: number | null
  ticking: boolean
  receivedAt: number | null
}): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(t)
  }, [])
  const ms = extrapolate(baseMs, ticking, receivedAt, now)
  return <span style={elapsedStyle}>{ms === null ? '—' : elapsed(ms)}</span>
}

export const DeskRoute = memo(function DeskRoute(): React.JSX.Element {
  const conn = useCockpit((s) => s.state)
  const refreshAt = useCockpit((s) => s.refreshAt)
  const snapshot = useCockpit((s) => s.snapshot)
  const project = useCockpit((s) => selectSession(s.snapshot)?.project ?? '')
  const sessionState = useCockpit((s) => selectSession(s.snapshot)?.state ?? null)
  const elapsedMs = useCockpit((s) => selectSession(s.snapshot)?.elapsed_ms ?? null)
  const connLabel = useCockpit((s) => connectivity(s.state, s.snapshot).label)
  const connDetail = useCockpit((s) => connectivity(s.state, s.snapshot).detail)
  const connTone = useCockpit((s) => connectivity(s.state, s.snapshot).tone)
  const branch = useCockpit((s) => gitLine(s.snapshot)?.branch ?? null)
  const dirty = useCockpit((s) => gitLine(s.snapshot)?.dirty ?? null)

  const spotify = useMemo(() => selectSpotify(snapshot), [snapshot])
  const audio = useMemo(() => parseSnapshot(snapshot)?.audio ?? null, [snapshot])
  const nodes = useMemo(() => displayNodes(snapshot), [snapshot])

  const activeProject = activeProjectLabel(conn, project)
  const gitParts: string[] = []
  if (branch !== null) gitParts.push(`branch ${branch}`)
  if (dirty !== null) gitParts.push(`dirty ${dirty === 'true' ? 'yes' : 'no'}`)

  const media = mediaChip(spotify, conn)
  const play = playChip(spotify, conn)
  const playing = (spotify?.state ?? '').toLowerCase() === 'playing'
  const track = spotify?.track !== '' && spotify !== null ? spotify.track : '—'
  const artist = spotify?.artist !== '' && spotify !== null ? spotify.artist : '—'

  return (
    <div className="zw-route" style={routeStyle}>
      <span style={microStyle}>PROJECT ZERO — DESK</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={headerRow}>
          <span style={projectStyle}>{activeProject}</span>
          <Chip label={sessionState ?? 'UNAVAILABLE'} tone={sessionChipTone(conn, sessionState)} />
        </div>
        <ElapsedClock
          baseMs={elapsedMs}
          ticking={conn === 'live' && sessionState === 'RUNNING'}
          receivedAt={refreshAt}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Chip label={connLabel} tone={connTone} />
          <span style={detailStyle}>{connDetail}</span>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={headerRow}>
          <span style={datumLabel}>SPOTIFY · NOW PLAYING</span>
          <Chip label={media.label} tone={media.tone} />
        </div>
        {spotify === null ? (
          <span style={noticeStyle}>No spotify integration is projected by the runtime.</span>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <ArtworkCover key={spotify.artworkId ?? 'none'} artworkId={spotify.artworkId} />
              <div
                style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}
              >
                <span style={mediaTitleStyle}>{track}</span>
                <span style={mediaArtistStyle}>{artist}</span>
                <div>
                  <Chip label={play.label} tone={play.tone} />
                </div>
              </div>
            </div>
            <div style={waveformBox}>
              <span style={datumLabel}>BASS · {spotify.audioCapture || 'NO CAPTURE'}</span>
              <BassWaveform audio={audio} live={conn === 'live'} playing={playing} />
            </div>
          </>
        )}
      </div>

      <div style={cardStyle}>
        <div style={headerRow}>
          <span style={datumLabel}>DESK DISPLAY</span>
          <span style={datumLabel}>{nodes.length > 0 ? `${nodes.length} REGISTERED` : '—'}</span>
        </div>
        {nodes.length === 0 ? (
          <>
            <span style={noticeStyle}>No display node registered. This is a software preview, not a connected device.</span>
            <div
              role="img"
              aria-label="Virtual desk display preview"
              style={{
                width: 'min(100%, 256px)',
                minHeight: 320,
                background: '#111820',
                color: '#f8f5ef',
                border: '7px solid #252a30',
                borderRadius: 10,
                padding: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                fontFamily: ZERO_TYPE.mono,
                overflow: 'hidden'
              }}
            >
              <span style={{ fontSize: 10, color: '#f7df94' }}>PREVIEW · NO HARDWARE</span>
              <span style={{ fontSize: 17, fontWeight: 700, overflowWrap: 'anywhere' }}>{project || 'No active project'}</span>
              <span style={{ fontSize: 13 }}>{sessionState ?? 'UNAVAILABLE'} · {elapsedMs === null ? '—' : elapsed(elapsedMs)}</span>
              <span style={{ borderTop: '1px solid #45505a', paddingTop: 8, fontSize: 10 }}>SPOTIFY</span>
              <span style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{spotify?.track || 'No media'}</span>
              <span style={{ fontSize: 10, color: '#b7c3cc', overflowWrap: 'anywhere' }}>{spotify?.artist || 'Not connected'}</span>
              <span style={{ marginTop: 'auto', fontSize: 9, color: '#8b9aa6' }}>ZERO · OFFLINE DISPLAY</span>
            </div>
          </>
        ) : (
          nodes.map((node: CockpitNode) => (
            <div key={node.id} style={nodeRow}>
              <span style={{ ...nodeIdStyle, flex: 1 }}>{node.id}</span>
              <span style={nodeDetailStyle}>last seen {clockStamp(node.last_seen)}</span>
              <Chip label={node.status} tone={nodeTone(conn, node.status)} />
            </div>
          ))
        )}
      </div>

      <AgentRunsCard />

      {gitParts.length > 0 ? <span style={gitStyle}>git · {gitParts.join(' · ')}</span> : null}
    </div>
  )
})
