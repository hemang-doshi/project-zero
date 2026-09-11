import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ZERO_TYPE } from '../../../shared/tokens'
import { Chip } from './Chip'
import { ChatRow, ThreadList } from './ZeroBotChat'
import type { Tone } from './runtime.types'
import {
  applyBridgeEvent,
  EMPTY_HARNESS_LOG,
  mergeTranscript,
  parseThreadRows,
  parseTranscript,
  pushHarnessEvent,
  threadTimestamp,
  threadTitle,
  type ChatItem,
  type HarnessEventLog,
  type ThreadRow
} from './chat.model'
import {
  HARNESS_DEFAULT_MODEL,
  HARNESS_MODELS,
  SEND_BLOCKED_NOTICE,
  VOICE_DISABLED_NOTICE,
  bridgeEventSummary,
  classifyBridgeEvent,
  harnessLockWarning,
  mirrorLabel,
  parseDiscovery,
  visibleBridgeEvents,
  type BridgeConnState,
  type BridgeEvent,
  type DiscoveryResult,
  type Harness,
  type OpenCodeFolderGroup
} from './runtime.types'
import {
  PROVIDER_DISPLAY,
  streamingLabel,
  summarizeExecItem,
  summarizeToolItem,
  turnItemCounts
} from './zeroBot.presentation'

// Layout: a real chat workspace (spec §25), not a card grid — left sidebar
// (provider sections with thread lists), main conversation canvas, bottom
// composer, collapsible right inspector. This is a recomposition of the
// existing data surfaces: every data path below (thread reads, bridge
// events, discovery ops, retention, honest blocks) is unchanged.

const workspaceStyle: React.CSSProperties = {
  height: '100%',
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'stretch',
  minHeight: 0,
  overflow: 'hidden'
}

const sidebarStyle: React.CSSProperties = {
  width: 264,
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '14px 12px',
  borderRight: '1px solid var(--z-line)',
  background: 'color-mix(in srgb, var(--z-card-cream) 45%, transparent)',
  overflowY: 'auto',
  minHeight: 0
}

const canvasStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0
}

const canvasHead: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 12,
  padding: '12px 16px 8px'
}

const transcriptStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '4px 16px 12px',
  overflowY: 'auto',
  minHeight: 60
}

const composerStyle: React.CSSProperties = {
  borderTop: '1px solid var(--z-line)',
  padding: '10px 16px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  background: 'var(--z-card-white)'
}

const inspectorStyle: React.CSSProperties = {
  width: 288,
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '14px 12px',
  borderLeft: '1px solid var(--z-line)',
  background: 'color-mix(in srgb, var(--z-card-cream) 45%, transparent)',
  overflowY: 'auto',
  minHeight: 0
}

// Human voice (spec §§6-7): system sans for UI labels, headings, chat.
const sectionLabel: React.CSSProperties = {
  fontFamily: ZERO_TYPE.body,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.1em',
  color: 'var(--z-secondary-ink)'
}

const bodyText: React.CSSProperties = {
  fontFamily: ZERO_TYPE.body,
  fontSize: 12.5,
  lineHeight: 1.55,
  color: 'var(--z-ink)',
  margin: 0
}

// Machine voice: mono reserved for ids, timestamps, model ids, commands.
const machineMeta: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10,
  color: 'var(--z-secondary-ink)',
  lineHeight: 1.6,
  margin: 0,
  overflowWrap: 'anywhere'
}

const warnNotice: React.CSSProperties = {
  fontFamily: ZERO_TYPE.body,
  fontSize: 12,
  color: 'var(--z-primary-authority)',
  lineHeight: 1.55,
  margin: 0
}

const providerHead: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  minWidth: 0
}

const providerButton: React.CSSProperties = {
  fontFamily: ZERO_TYPE.body,
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.06em',
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--z-ink)',
  cursor: 'pointer',
  textAlign: 'left'
}

const providerActive: React.CSSProperties = {
  ...providerButton,
  borderColor: 'var(--z-line)',
  background: 'var(--z-card-white)'
}

const actionButton: React.CSSProperties = {
  fontFamily: ZERO_TYPE.body,
  fontSize: 12,
  fontWeight: 600,
  padding: '5px 14px',
  borderRadius: 6,
  border: '1px solid var(--z-line)',
  background: 'transparent',
  color: 'var(--z-ink)',
  cursor: 'pointer'
}

const disabledAction: React.CSSProperties = {
  ...actionButton,
  opacity: 0.45,
  cursor: 'not-allowed'
}

const sendButton: React.CSSProperties = {
  ...actionButton,
  background: 'var(--z-orange)',
  borderColor: 'var(--z-orange)',
  color: 'var(--z-card-white)'
}

const disabledSend: React.CSSProperties = {
  ...sendButton,
  opacity: 0.45,
  cursor: 'not-allowed'
}

const modelChip: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: '0.04em',
  padding: '3px 9px',
  borderRadius: 999,
  border: '1px solid var(--z-line)',
  background: 'transparent',
  color: 'var(--z-ink)',
  cursor: 'pointer'
}

const modelSelected: React.CSSProperties = {
  ...modelChip,
  background: 'var(--z-marker-yellow)',
  borderColor: 'var(--z-secondary-ink)'
}

const eventRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '90px 120px 1fr',
  gap: 10,
  alignItems: 'baseline',
  padding: '4px 0',
  borderBottom: '1px solid color-mix(in srgb, var(--z-line) 70%, transparent)',
  minWidth: 0
}

const eventCell: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10,
  color: 'var(--z-ink)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const folderHead: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 8,
  minWidth: 0
}

const sessionRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  gap: 10,
  alignItems: 'baseline',
  padding: '4px 0',
  borderBottom: '1px solid color-mix(in srgb, var(--z-line) 70%, transparent)',
  minWidth: 0
}

const composerInput: React.CSSProperties = {
  fontFamily: ZERO_TYPE.body,
  fontSize: 13,
  lineHeight: 1.5,
  color: 'var(--z-ink)',
  background: 'transparent',
  border: '1px solid var(--z-line)',
  borderRadius: 8,
  padding: '8px 10px',
  resize: 'vertical',
  minHeight: 56,
  width: '100%',
  boxSizing: 'border-box'
}

type BridgeInfo = { state: BridgeConnState; lastDiagnostic: string | null }

const UNKNOWN_INFO: BridgeInfo = { state: 'unknown', lastDiagnostic: null }

const STATE_LABEL: Record<BridgeConnState, string> = {
  unknown: 'STATE UNKNOWN',
  disconnected: 'DISCONNECTED',
  connecting: 'CONNECTING',
  live: 'CONNECTED'
}

const STATE_TONE: Record<BridgeConnState, Tone> = {
  unknown: 'neutral',
  disconnected: 'neutral',
  connecting: 'attention',
  live: 'healthy'
}

const STATE_DETAIL: Record<BridgeConnState, string> = {
  unknown: 'Bridge state resolves on first check.',
  disconnected: 'Connect manually to the local harness bridge.',
  connecting: 'Negotiating the local bridge protocol.',
  live: 'Project Zero owns this harness session.'
}

const asBridgeState = (v: unknown): BridgeConnState =>
  v === 'live' || v === 'connecting' ? v : 'disconnected'

export function BridgeEventRow({ event }: { event: BridgeEvent }): React.JSX.Element {
  return (
    <div style={eventRow}>
      <span style={eventCell}>{classifyBridgeEvent(event.method)}</span>
      <span style={{ ...eventCell, color: 'var(--z-secondary-ink)' }}>{event.method}</span>
      <span style={eventCell}>{bridgeEventSummary(event)}</span>
    </div>
  )
}

const sessionTime = (ms: number): string => {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 16).replace('T', ' ')
}

const threadTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  const d = new Date(seconds * 1000)
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 16).replace('T', ' ')
}

export function FolderGroupList({ groups }: { groups: OpenCodeFolderGroup[] }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      {groups.map((g) => (
        <div key={g.path} style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <div style={folderHead}>
            <span data-voice="human" style={{ ...sectionLabel, fontSize: 10 }}>
              {g.folder.toUpperCase()} · {g.count}
            </span>
            <span data-voice="machine" style={{ ...machineMeta, textAlign: 'right' }}>
              {g.path}
            </span>
          </div>
          {g.sessions.map((s) => (
            <div key={s.id} style={sessionRow}>
              <span data-voice="human" style={{ ...bodyText, fontSize: 12 }}>
                {s.title === '' ? s.id : s.title}
              </span>
              <span data-voice="machine" style={{ ...machineMeta, textAlign: 'right' }}>
                {sessionTime(s.updatedAt)}
                {s.model !== null ? ` · ${s.model}` : ''}
                {s.agent !== null ? ` · ${s.agent}` : ''}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// Empty states answer human → explanation → technical (spec §85): what is
// missing, whether that is expected, and what to do. No backend jargon in
// the primary copy.
function EmptyState({
  title,
  explanation,
  technical = null
}: {
  title: string
  explanation: string
  technical?: string | null
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <p data-voice="human" style={{ ...bodyText, fontWeight: 700 }}>
        {title}
      </p>
      <p data-voice="human" style={bodyText}>
        {explanation}
      </p>
      {technical !== null ? (
        <p data-voice="machine" style={machineMeta}>
          {technical}
        </p>
      ) : null}
    </div>
  )
}

// Errors explain what failed, the source, and the action (spec §86): human
// line first, raw diagnostic as secondary technical detail.
function ErrorPanel({
  harness,
  message,
  canReconnect,
  onReconnect
}: {
  harness: Harness
  message: string
  canReconnect: boolean
  onReconnect: () => void
}): React.JSX.Element {
  const provider = PROVIDER_DISPLAY[harness]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <p data-voice="human" style={{ ...bodyText, fontWeight: 700 }}>
        {provider} hit a problem
      </p>
      <p data-voice="human" style={bodyText}>
        Zero could not finish that {provider} request. Nothing was sent or started.
        {canReconnect ? ' Reconnect and try again, or keep reading the retained view.' : ''}
      </p>
      <p data-voice="machine" style={machineMeta}>
        {message}
      </p>
      {canReconnect ? (
        <div>
          <button type="button" style={actionButton} onClick={onReconnect}>
            Reconnect
          </button>
        </div>
      ) : null}
    </div>
  )
}

type ThreadLane = {
  rows: ThreadRow[]
  items: ChatItem[]
  dropped: number
  threadId: string | null
}

const EMPTY_LANE: ThreadLane = { rows: [], items: [], dropped: 0, threadId: null }

type HarnessState = Record<Harness, ThreadLane>

const EMPTY_LANES: HarnessState = { codex: { ...EMPTY_LANE }, opencode: { ...EMPTY_LANE } }

export const ZeroBotRoute = memo(function ZeroBotRoute(): React.JSX.Element {
  const [harness, setHarness] = useState<Harness>('codex')
  const [states, setStates] = useState<Record<Harness, BridgeInfo>>({
    codex: { ...UNKNOWN_INFO },
    opencode: { ...UNKNOWN_INFO }
  })
  const [discovery, setDiscovery] = useState<Partial<Record<Harness, DiscoveryResult>>>({})
  const [models, setModels] = useState<Record<Harness, string>>({
    codex: HARNESS_DEFAULT_MODEL.codex,
    opencode: HARNESS_DEFAULT_MODEL.opencode
  })
  const [lanes, setLanes] = useState<HarnessState>(EMPTY_LANES)
  const [logs, setLogs] = useState<Record<Harness, HarnessEventLog>>(EMPTY_HARNESS_LOG)
  const [inFlight, setInFlight] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [composerText, setComposerText] = useState('')
  const lanesRef = useRef<HarnessState>(EMPTY_LANES)
  const logsRef = useRef<Record<Harness, HarnessEventLog>>(EMPTY_HARNESS_LOG)
  const openRef = useRef<Record<Harness, string | null>>({ codex: null, opencode: null })
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    if (typeof window === 'undefined' || !window.zero) {
      return () => {
        aliveRef.current = false
      }
    }
    const refresh = (h: Harness): void => {
      window.zero
        .invoke(h === 'codex' ? 'codex.state' : 'ocp.state')
        .then((v) => {
          const r = v as { state?: unknown; lastDiagnostic?: unknown }
          setStates((m) => ({
            ...m,
            [h]: {
              state: asBridgeState(r.state),
              lastDiagnostic: typeof r.lastDiagnostic === 'string' ? r.lastDiagnostic : null
            }
          }))
          if (h === 'codex' && asBridgeState(r.state) === 'live' && aliveRef.current) {
            void window.zero
              .invoke('codex.threads')
              .then((rowsValue) => {
                const rows = parseThreadRows(rowsValue)
                if (!aliveRef.current || rows.length === 0) return
                const laneNow = lanesRef.current.codex
                const next: HarnessState = { ...lanesRef.current, codex: { ...laneNow, rows } }
                lanesRef.current = next
                setLanes(next)
              })
              .catch(() => {
                /* fail-soft: the state card still shows the live bridge */
              })
          }
          // OpenCode discovery is a local read-only store scan, not a bridge
          // probe: it runs on mount with no connection and never sends.
          if (h === 'opencode' && aliveRef.current) {
            void window.zero
              .invoke('ocp.discover')
              .then((discovered) => {
                if (!aliveRef.current) return
                const parsed = parseDiscovery(discovered)
                if (parsed === null) return
                setDiscovery((d) => ({ ...d, opencode: parsed }))
              })
              .catch(() => {
                /* fail-soft: the discovery card keeps its honest empty state */
              })
          }
        })
        .catch((err: unknown) => {
          setStates((m) => ({ ...m, [h]: { state: 'disconnected', lastDiagnostic: null } }))
          setError(err instanceof Error ? err.message : String(err))
        })
    }
    refresh('codex')
    refresh('opencode')
    const unsubscribe = window.zero.subscribe('bridge', (u) => {
      const push = u as { harness?: unknown; event?: { method?: unknown; params?: unknown } }
      const h = push.harness === 'codex' || push.harness === 'opencode' ? push.harness : null
      const method = typeof push.event?.method === 'string' ? push.event.method : null
      if (h === null || method === null || !aliveRef.current) return
      const ev: BridgeEvent = { harness: h, method, params: push.event?.params }
      const nextLogs = pushHarnessEvent(logsRef.current, ev)
      logsRef.current = nextLogs
      setLogs(nextLogs)
      const openId = openRef.current[h]
      const params = (typeof ev.params === 'object' && ev.params !== null ? ev.params : null) as {
        threadId?: unknown
      } | null
      const eventThread = typeof params?.threadId === 'string' ? params.threadId : null
      if (openId !== null && (eventThread === null || eventThread === openId)) {
        const lane = lanesRef.current[h]
        const applied = applyBridgeEvent(lane.items, method, ev.params)
        if (applied.changed) {
          const nextLanes: HarnessState = {
            ...lanesRef.current,
            [h]: { ...lane, items: applied.items }
          }
          lanesRef.current = nextLanes
          setLanes(nextLanes)
        }
      }
      if (method === 'thread/started' && h === 'codex') {
        void window.zero
          .invoke('codex.threads')
          .then((v) => {
            const rows = parseThreadRows(v)
            if (!aliveRef.current || rows.length === 0) return
            const lane = lanesRef.current.codex
            const nextLanes: HarnessState = { ...lanesRef.current, codex: { ...lane, rows } }
            lanesRef.current = nextLanes
            setLanes(nextLanes)
          })
          .catch(() => {
            /* fail-soft: the wire log still carries the event */
          })
      }
    })
    return () => {
      aliveRef.current = false
      unsubscribe()
    }
  }, [])

  const info = states[harness]
  const result = discovery[harness] ?? null
  const selectedModel = models[harness]
  const mismatch = harnessLockWarning(selectedModel, harness)
  const lane = lanes[harness]
  const log = logs[harness]
  const shownEvents = useMemo(() => visibleBridgeEvents(log.events, harness), [log.events, harness])
  const live = info.state === 'live'
  // OpenCode discovery reads the local session store directly, so it needs no
  // bridge connection; codex discovery still probes the live bridge.
  const canDiscover = harness === 'opencode' ? !inFlight : live && !inFlight

  const loadThreads = (h: Harness): Promise<void> => {
    // Guard to codex explicitly: OpenCode has no read-only list method, so a
    // caller passing a foreign harness must be a no-op, never a codex probe.
    if (h !== 'codex') return Promise.resolve()
    return window.zero
      .invoke('codex.threads')
      .then((v) => {
        const rows = parseThreadRows(v)
        const laneNow = lanesRef.current[h]
        const next: HarnessState = { ...lanesRef.current, [h]: { ...laneNow, rows } }
        lanesRef.current = next
        setLanes(next)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }

  const openThread = (threadId: string): void => {
    // Codex-only by construction: it reads the codex lane and the read-only
    // codex.thread.get op. Callers switch the harness focus themselves, so no
    // stale-state guard here (a harness check would read the pre-click lane).
    openRef.current = { ...openRef.current, codex: threadId }
    const laneNow = lanesRef.current.codex
    const opened: HarnessState = {
      ...lanesRef.current,
      codex: { ...laneNow, threadId }
    }
    lanesRef.current = opened
    setLanes(opened)
    setError(null)
    setNotice(null)
    window.zero
      .invoke('codex.thread.get', { threadId })
      .then((v) => {
        const parsed = parseTranscript(v)
        const laneNext = lanesRef.current.codex
        // Merge (never replace): live events that landed while the read was
        // in flight are the newest evidence per item id and must survive.
        const merged = mergeTranscript(laneNext.items, parsed.items)
        const next: HarnessState = {
          ...lanesRef.current,
          codex: { ...laneNext, items: merged.items, dropped: merged.dropped }
        }
        lanesRef.current = next
        setLanes(next)
        if (merged.items.length === 0) setNotice('The thread transcript read returned no items.')
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }

  const newConversation = (): void => {
    // Local view only: no session/new exists on the backend, and the composer
    // is honestly blocked, so this clears the open thread without creating
    // anything on any provider.
    openRef.current = { ...openRef.current, [harness]: null }
    const laneNow = lanesRef.current[harness]
    const next: HarnessState = {
      ...lanesRef.current,
      [harness]: { ...laneNow, threadId: null, items: [], dropped: 0 }
    }
    lanesRef.current = next
    setLanes(next)
    setError(null)
    setNotice(
      'Cleared the open view. Nothing was created on any provider — describe the work below and Zero will hold it here until sending exists.'
    )
  }

  const run = (action: 'connect' | 'disconnect' | 'discover'): void => {
    setInFlight(true)
    setError(null)
    setNotice(null)
    const op = `${harness === 'codex' ? 'codex' : 'ocp'}.${action}` as
      | 'codex.connect'
      | 'codex.disconnect'
      | 'codex.discover'
      | 'ocp.connect'
      | 'ocp.disconnect'
      | 'ocp.discover'
    window.zero
      .invoke(op)
      .then((v) => {
        if (action === 'discover') {
          const parsed = parseDiscovery(v)
          if (parsed === null) throw new Error('Malformed discovery response')
          setDiscovery((d) => ({ ...d, [harness]: parsed }))
          setNotice('Discovery probes finished; nothing was started.')
        } else {
          const state: BridgeConnState = v === 'live' ? 'live' : 'disconnected'
          setStates((m) => ({ ...m, [harness]: { state, lastDiagnostic: null } }))
          setNotice(
            action === 'connect'
              ? `${harness} bridge connected; no thread, session, prompt or turn was started.`
              : `${harness} bridge disconnected.`
          )
          // The codex-only guard lives inside loadThreads itself, so the
          // call site can delegate without duplicating the harness check.
          if (action === 'connect') void loadThreads(harness)
        }
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setInFlight(false))
  }

  const modelOptions = Array.from(
    new Set([...HARNESS_MODELS[harness], ...(result?.models.map((m) => m.id) ?? [])])
  )

  const openRow = lane.rows.find((r) => r.id === lane.threadId) ?? null
  const activity = streamingLabel(lane.items)
  const counts = useMemo(() => turnItemCounts(lane.items), [lane.items])
  const toolItems = useMemo(
    () => lane.items.filter((i) => i.kind === 'tool' || i.kind === 'exec'),
    [lane.items]
  )
  // Context indicator from real lane data only: provider, selected model and
  // the items actually in view. Project and branch need the context-packet
  // backend (spec §§32-34), which does not exist — marked pending below.
  const contextLine =
    lane.threadId !== null
      ? `${PROVIDER_DISPLAY[harness]} · ${selectedModel} · ${lane.items.length} item${lane.items.length === 1 ? '' : 's'} in this view`
      : `${PROVIDER_DISPLAY[harness]} · ${selectedModel}`

  const codexRows = lanes.codex.rows
  const codexInfo = states.codex
  const opencodeInfo = states.opencode
  const opencodeResult = discovery.opencode ?? null

  return (
    <div className="zw-route" data-region="workspace" style={workspaceStyle}>
      <aside data-region="sidebar" style={sidebarStyle} aria-label="Conversations">
        <span data-voice="human" style={sectionLabel}>
          PROJECT ZERO — ZERO BOT
        </span>
        <button type="button" style={actionButton} onClick={newConversation}>
          New conversation
        </button>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <div style={providerHead}>
            <button
              type="button"
              style={harness === 'codex' ? providerActive : providerButton}
              aria-pressed={harness === 'codex'}
              onClick={() => setHarness('codex')}
            >
              Codex
            </button>
            <Chip label={STATE_LABEL[codexInfo.state]} tone={STATE_TONE[codexInfo.state]} />
          </div>
          <span data-voice="human" style={sectionLabel}>
            DISCOVERY · THREADS
          </span>
          {codexRows.length === 0 ? (
            <EmptyState
              title="No conversations yet"
              explanation={
                codexInfo.state === 'live'
                  ? 'Connected — the read-only thread list returned no threads yet.'
                  : 'Connect Codex to load the read-only thread list.'
              }
            />
          ) : (
            <ThreadList
              rows={codexRows}
              selectedId={lanes.codex.threadId}
              onSelect={(id) => {
                setHarness('codex')
                openThread(id)
              }}
            />
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <div style={providerHead}>
            <button
              type="button"
              style={harness === 'opencode' ? providerActive : providerButton}
              aria-pressed={harness === 'opencode'}
              onClick={() => setHarness('opencode')}
            >
              OpenCode
            </button>
            <Chip label={STATE_LABEL[opencodeInfo.state]} tone={STATE_TONE[opencodeInfo.state]} />
          </div>
          {opencodeResult !== null && opencodeResult.folders.length > 0 ? (
            <FolderGroupList groups={opencodeResult.folders} />
          ) : (
            <EmptyState
              title={
                opencodeResult === null
                  ? 'Reading your OpenCode sessions…'
                  : 'No OpenCode sessions yet'
              }
              explanation={
                opencodeResult === null
                  ? 'Zero is reading the local OpenCode session store; no connection needed.'
                  : (opencodeResult.note ??
                    'Runs you start in OpenCode will appear here, grouped by project folder.')
              }
            />
          )}
        </div>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span data-voice="human" style={sectionLabel}>
            {harness === 'codex' ? 'CODEX APP-SERVER' : 'OPENCODE ACP'} BRIDGE
          </span>
          <Chip label={STATE_LABEL[info.state]} tone={STATE_TONE[info.state]} />
          <p data-voice="human" style={bodyText}>
            {STATE_DETAIL[info.state]}
          </p>
          {info.lastDiagnostic !== null ? (
            <p data-voice="machine" style={machineMeta}>
              {info.lastDiagnostic}
            </p>
          ) : null}
          <div style={{ display: 'flex', gap: 8 }}>
            {info.state === 'live' ? (
              <button
                type="button"
                style={inFlight ? disabledAction : actionButton}
                disabled={inFlight}
                onClick={() => run('disconnect')}
              >
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                style={inFlight || info.state === 'connecting' ? disabledAction : actionButton}
                disabled={inFlight || info.state === 'connecting'}
                onClick={() => run('connect')}
              >
                {info.state === 'connecting'
                  ? 'Connecting…'
                  : harness === 'codex'
                    ? 'Connect Codex'
                    : 'Connect OpenCode'}
              </button>
            )}
            <button
              type="button"
              style={canDiscover ? actionButton : disabledAction}
              disabled={!canDiscover}
              onClick={() => run('discover')}
            >
              Discover
            </button>
          </div>
        </div>
      </aside>

      <main data-region="canvas" style={canvasStyle} aria-label="Conversation">
        <div style={canvasHead}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span data-voice="human" style={sectionLabel}>
              CONVERSATION · {harness.toUpperCase()}
            </span>
            {lane.threadId !== null ? (
              <span data-voice="human" style={{ ...bodyText, fontWeight: 700 }}>
                {openRow !== null ? threadTitle(openRow) : lane.threadId}
              </span>
            ) : null}
            {activity !== null ? (
              <span data-voice="human" style={{ ...bodyText, color: 'var(--z-secondary-ink)' }}>
                {activity}
              </span>
            ) : null}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            {lane.threadId !== null ? (
              live ? (
                <Chip label="LIVE" tone="healthy" />
              ) : (
                <Chip label="STALE" tone="attention" />
              )
            ) : null}
            <button
              type="button"
              style={actionButton}
              aria-expanded={inspectorOpen}
              onClick={() => setInspectorOpen((v) => !v)}
            >
              {inspectorOpen ? 'Hide inspector' : 'Show inspector'}
            </button>
          </div>
        </div>

        <div style={transcriptStyle}>
          {error !== null ? (
            <ErrorPanel
              harness={harness}
              message={error}
              canReconnect={info.state === 'disconnected'}
              onReconnect={() => run('connect')}
            />
          ) : null}
          {lane.threadId === null ? (
            <EmptyState
              title="No conversation open"
              explanation={
                harness === 'opencode'
                  ? 'OpenCode sessions are listed on the left. This build has no transcript read for them yet, so they stay labels.'
                  : 'Choose a thread on the left to read it. Live turns append here while the bridge streams.'
              }
              technical={
                harness === 'codex'
                  ? 'thread/list + thread/read · read-only · bounded to the last 400 items'
                  : 'local session store · read-only · no transcript read in this build'
              }
            />
          ) : (
            <>
              {lane.items.map((item, n) => (
                <ChatRow
                  key={item.id === '' ? `${item.kind}-anon-${n}` : item.id}
                  item={item}
                  harness={harness}
                  model={openRow?.model ?? null}
                />
              ))}
              {lane.dropped > 0 ? (
                <p data-voice="human" style={bodyText}>
                  +{lane.dropped} earlier item(s) kept out of this bounded view.
                </p>
              ) : null}
            </>
          )}
          {notice !== null ? (
            <p data-voice="human" style={bodyText}>
              {notice}
            </p>
          ) : null}
        </div>

        <div data-region="composer" style={composerStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 8
            }}
          >
            <span data-voice="human" style={sectionLabel}>
              COMPOSER
            </span>
            <span data-voice="machine" style={machineMeta} title="What this turn would run with">
              {contextLine}
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }} aria-label="Model selector">
            {modelOptions.map((m) => (
              <button
                key={m}
                type="button"
                style={selectedModel === m ? modelSelected : modelChip}
                aria-pressed={selectedModel === m}
                onClick={() => setModels((s) => ({ ...s, [harness]: m }))}
              >
                {m}
              </button>
            ))}
          </div>
          {mismatch !== null ? (
            <p data-voice="human" style={warnNotice}>
              {mismatch} Mirror: {mirrorLabel(harness)}
            </p>
          ) : null}
          <textarea
            data-voice="human"
            style={composerInput}
            rows={3}
            value={composerText}
            onChange={(e) => setComposerText(e.target.value)}
            placeholder="Describe the work for Zero…"
            aria-label="Message Zero"
          />
          <p data-voice="human" style={bodyText}>
            {SEND_BLOCKED_NOTICE}
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" style={disabledSend} disabled aria-label="Send turn">
              Send
            </button>
            <button type="button" style={disabledAction} disabled aria-label="Voice input">
              Voice
            </button>
          </div>
          <p data-voice="human" style={bodyText}>
            {VOICE_DISABLED_NOTICE}
          </p>
        </div>
      </main>

      {inspectorOpen ? (
        <aside data-region="inspector" style={inspectorStyle} aria-label="Turn inspector">
          <span data-voice="human" style={sectionLabel}>
            INSPECTOR · TURN DETAILS
          </span>
          {openRow !== null ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <p data-voice="human" style={{ ...bodyText, fontWeight: 700 }}>
                {threadTitle(openRow)}
              </p>
              <p data-voice="machine" style={machineMeta}>
                {openRow.id}
              </p>
              <p data-voice="machine" style={machineMeta}>
                {threadTime(threadTimestamp(openRow))}
                {openRow.model !== null ? ` · ${openRow.model}` : ''}
                {openRow.status !== '' ? ` · ${openRow.status}` : ''}
              </p>
            </div>
          ) : (
            <EmptyState
              title="No turn selected"
              explanation="Open a thread to inspect its details, tool calls and context here."
            />
          )}

          <span data-voice="human" style={sectionLabel}>
            TOOLS · {toolItems.length}
          </span>
          {toolItems.length === 0 ? (
            <p data-voice="human" style={bodyText}>
              No tool calls in this turn yet.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              {toolItems.map((item, n) => (
                <p
                  key={item.id === '' ? `tool-anon-${n}` : item.id}
                  data-voice="human"
                  style={{ ...bodyText, fontSize: 12 }}
                >
                  {item.kind === 'exec' ? summarizeExecItem(item) : summarizeToolItem(item)}
                </p>
              ))}
            </div>
          )}

          <span data-voice="human" style={sectionLabel}>
            CONTEXT
          </span>
          <p data-voice="human" style={bodyText}>
            {counts.messages} message{counts.messages === 1 ? '' : 's'} · {counts.thinking} thinking
            · {counts.tools} tool call{counts.tools === 1 ? '' : 's'}
            {counts.notices > 0
              ? ` · ${counts.notices} protocol note${counts.notices === 1 ? '' : 's'}`
              : ''}
          </p>
          {lane.dropped > 0 ? (
            <p data-voice="human" style={bodyText}>
              +{lane.dropped} earlier item(s) beyond the bounded view.
            </p>
          ) : null}
          <p data-voice="human" style={bodyText}>
            Project and branch context, provider handoff and automatic routing are designed but
            pending — this build has no context-packet backend, so every turn stays inside its own
            provider thread.
          </p>

          <span data-voice="human" style={sectionLabel}>
            CONVERSATION · BRIDGE EVENTS
          </span>
          {shownEvents.length === 0 ? (
            <p data-voice="human" style={bodyText}>
              {live
                ? 'Connected; no bridge event has streamed into this window yet.'
                : 'No bridge events in this window yet. Connect manually to surface streamed protocol state.'}
            </p>
          ) : (
            <>
              {shownEvents.map((e, i) => (
                <BridgeEventRow key={`${e.harness}-${i}`} event={e} />
              ))}
              {log.dropped > 0 ? (
                <p data-voice="human" style={bodyText}>
                  +{log.dropped} older event(s) kept out of bounded {harness} memory.
                </p>
              ) : null}
            </>
          )}
          <p data-voice="human" style={bodyText}>
            Events are retained bounded memory, never a live or actionable run while the bridge is
            not connected.
          </p>
        </aside>
      ) : null}
    </div>
  )
})
