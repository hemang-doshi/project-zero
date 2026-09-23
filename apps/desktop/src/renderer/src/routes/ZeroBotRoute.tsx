import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ZERO_TYPE } from '../../../shared/tokens'
import type { ProjectListItem } from '../../../shared/ipc'
import type { PromptSubmitPayload } from '../../../shared/ipc'
import { Chip } from './Chip'
import { ChatRow, ThinkingGroupBlock, ThreadList } from './ZeroBotChat'
import { parseOpenCodeTranscript, type TranscriptUsage } from './opencodeTranscript'
import { codexUsageFromEvent } from './providerUsage'
import { useWindows } from '../store/windows'
import type { Tone } from './runtime.types'
import {
  applyBridgeEvent,
  groupThreadsByRegisteredProject,
  groupThreadsByFolder,
  groupVisibleItems,
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
  projectErrorMessage,
  streamingLabel,
  toolOutcomeSummary,
  turnItemCounts
} from './zeroBot.presentation'

// Layout: a real chat workspace (spec §25), not a card grid — left sidebar
// (provider sections with thread lists), main conversation canvas, bottom
// composer, collapsible right inspector. This is a recomposition of the
// existing data surfaces: every data path below (thread reads, bridge
// events, discovery ops, retention, honest blocks) is unchanged.

const workspaceStyle: React.CSSProperties = {
  height: '100%',
  position: 'relative',
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
  overflow: 'hidden',
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
  gap: 11,
  padding: '6px 24px 16px',
  overflowY: 'auto',
  minHeight: 60
}

const composerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8
}

const composerBox: React.CSSProperties = {
  border: '1px solid var(--z-line)',
  borderRadius: 10,
  padding: '8px 10px',
  display: 'flex',
  flexDirection: 'column',
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
  fontSize: 13.5,
  lineHeight: 1.55,
  color: 'var(--z-ink)',
  margin: 0
}

// Machine voice: mono reserved for ids, timestamps, model ids, commands.
const machineMeta: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 11,
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
  border: '1px solid var(--z-line)',
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
  border: 'none',
  outline: 'none',
  padding: '2px 0',
  resize: 'none',
  minHeight: 66,
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

const formatTokenCount = (value: number | null): string =>
  value === null ? '—' : value.toLocaleString()

export function FolderGroupList({
  groups,
  selectedId,
  onSelect
}: {
  groups: OpenCodeFolderGroup[]
  selectedId: string | null
  onSelect: (id: string) => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      {groups.map((g, index) => (
        <details
          key={g.path}
          className="zw-group-details"
          open={
            expanded[g.path] ??
            (index === 0 || g.sessions.some((session) => session.id === selectedId))
          }
          onToggle={(event) => {
            const open = event.currentTarget.open
            setExpanded((current) => ({ ...current, [g.path]: open }))
          }}
        >
          <summary title={g.path}>
            {g.folder} · {g.count}
            {g.sessions.some((session) => session.id === selectedId) ? ' · selected' : ''}
          </summary>
          {g.sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              style={{
                ...sessionRow,
                width: '100%',
                border: 'none',
                background: selectedId === s.id ? 'var(--z-card-white)' : 'transparent',
                cursor: 'pointer',
                textAlign: 'left'
              }}
              onClick={() => onSelect(s.id)}
              aria-current={selectedId === s.id ? 'true' : undefined}
            >
              <span data-voice="human" style={{ ...bodyText, fontSize: 12 }}>
                {s.title === '' ? s.id : s.title}
              </span>
              <span data-voice="machine" style={{ ...machineMeta, textAlign: 'right' }}>
                {sessionTime(s.updatedAt)}
                {s.model !== null ? ` · ${s.model}` : ''}
                {s.agent !== null ? ` · ${s.agent}` : ''}
              </span>
            </button>
          ))}
        </details>
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
  usage: TranscriptUsage | null
}

const EMPTY_LANE: ThreadLane = { rows: [], items: [], dropped: 0, threadId: null, usage: null }

type HarnessState = Record<Harness, ThreadLane>

type PendingPermission = {
  provider: Harness
  requestId: string | number
  title: string
  allowOptionId?: string
}

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
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({})
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({})
  const openRoute = useWindows((state) => state.openRoute)
  const [workspaceWidth, setWorkspaceWidth] = useState<number | null>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const [composerText, setComposerText] = useState('')
  const [draft, setDraft] = useState<{ provider: Harness; cwd: string; draftId: string } | null>(
    null
  )
  const [promptBusy, setPromptBusy] = useState(false)
  const [promptHold, setPromptHold] = useState<{
    id: string
    categories: string[]
    positions: number[]
  } | null>(null)
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null)
  const activePromptRef = useRef<string | null>(null)
  const [projects, setProjects] = useState<ProjectListItem[]>([])
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const lanesRef = useRef<HarnessState>(EMPTY_LANES)
  const logsRef = useRef<Record<Harness, HarnessEventLog>>(EMPTY_HARNESS_LOG)
  const usageRef = useRef<Map<string, TranscriptUsage>>(new Map())
  const openRef = useRef<Record<Harness, string | null>>({ codex: null, opencode: null })
  const aliveRef = useRef(true)

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || workspaceRef.current === null) return
    const observer = new ResizeObserver(([entry]) => {
      setWorkspaceWidth(entry.contentRect.width)
      if (entry.contentRect.width < 820) setInspectorOpen(false)
    })
    observer.observe(workspaceRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    aliveRef.current = true
    if (typeof window === 'undefined' || !window.zero) {
      return () => {
        aliveRef.current = false
      }
    }
    void window.zero
      .invoke('projects.list')
      .then((value) => {
        if (aliveRef.current && Array.isArray(value)) setProjects(value as ProjectListItem[])
      })
      .catch((err: unknown) => {
        if (aliveRef.current) setProjectsError(projectErrorMessage(err))
      })
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
            void window.zero
              .invoke('codex.discover')
              .then((value) => {
                if (!aliveRef.current) return
                const parsed = parseDiscovery(value)
                if (parsed === null) return
                setDiscovery((current) => ({ ...current, codex: parsed }))
                setModels((current) => ({
                  ...current,
                  codex: parsed.models.some((model) => model.id === current.codex)
                    ? current.codex
                    : (parsed.models[0]?.id ?? '')
                }))
              })
              .catch(() => {})
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
      const push = u as {
        harness?: unknown
        event?: { id?: unknown; method?: unknown; params?: unknown }
      }
      const h = push.harness === 'codex' || push.harness === 'opencode' ? push.harness : null
      const method = typeof push.event?.method === 'string' ? push.event.method : null
      if (h === null || method === null || !aliveRef.current) return
      const ev: BridgeEvent = { harness: h, method, params: push.event?.params }
      if (
        (method === 'session/request_permission' || method.includes('requestApproval')) &&
        (typeof push.event?.id === 'string' || typeof push.event?.id === 'number')
      ) {
        const permissionParams =
          typeof push.event.params === 'object' && push.event.params !== null
            ? (push.event.params as Record<string, unknown>)
            : {}
        const options = Array.isArray(permissionParams['options'])
          ? permissionParams['options']
          : []
        const allow = options.find(
          (value) =>
            typeof value === 'object' &&
            value !== null &&
            (value as Record<string, unknown>)['kind'] === 'allow_once'
        ) as Record<string, unknown> | undefined
        setPendingPermission({
          provider: h,
          requestId: push.event.id,
          title:
            typeof permissionParams['title'] === 'string'
              ? permissionParams['title']
              : 'Provider requests permission for a tool action.',
          ...(typeof allow?.['optionId'] === 'string' ? { allowOptionId: allow.optionId } : {})
        })
      }
      const nextLogs = pushHarnessEvent(logsRef.current, ev)
      logsRef.current = nextLogs
      setLogs(nextLogs)
      const openId = openRef.current[h]
      const params = (typeof ev.params === 'object' && ev.params !== null ? ev.params : null) as {
        threadId?: unknown
      } | null
      const eventThread = typeof params?.threadId === 'string' ? params.threadId : null
      if (h === 'codex' && method === 'thread/tokenUsage/updated') {
        const usage = codexUsageFromEvent(ev.params, Date.now())
        if (usage !== null) {
          const key = `codex:${usage.threadId}`
          usageRef.current.set(key, usage)
          if (usageRef.current.size > 200)
            usageRef.current.delete(usageRef.current.keys().next().value as string)
          if (openId === usage.threadId) {
            const current = lanesRef.current.codex
            const next: HarnessState = {
              ...lanesRef.current,
              codex: { ...current, usage }
            }
            lanesRef.current = next
            setLanes(next)
          }
        }
      }
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
  const mismatch =
    result !== null && result.models.some((model) => model.id === selectedModel)
      ? null
      : harnessLockWarning(selectedModel, harness)
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
    setDraft(null)
    const selectedRow = lanesRef.current.codex.rows.find((row) => row.id === threadId)
    if (selectedRow?.model)
      setModels((current) => ({ ...current, codex: selectedRow.model as string }))
    activePromptRef.current = null
    setPromptHold(null)
    // Codex-only by construction: it reads the codex lane and the read-only
    // codex.thread.get op. Callers switch the harness focus themselves, so no
    // stale-state guard here (a harness check would read the pre-click lane).
    openRef.current = { ...openRef.current, codex: threadId }
    const laneNow = lanesRef.current.codex
    const opened: HarnessState = {
      ...lanesRef.current,
      codex: { ...laneNow, threadId, usage: usageRef.current.get(`codex:${threadId}`) ?? null }
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

  const openOpenCodeThread = (threadId: string): void => {
    setDraft(null)
    openRef.current = { ...openRef.current, opencode: threadId }
    const laneNow = lanesRef.current.opencode
    const opened: HarnessState = {
      ...lanesRef.current,
      opencode: {
        ...laneNow,
        threadId,
        items: [],
        dropped: 0,
        usage: usageRef.current.get(`opencode:${threadId}`) ?? null
      }
    }
    lanesRef.current = opened
    setLanes(opened)
    setError(null)
    setNotice(null)
    const saved = discovery.opencode?.folders
      .flatMap((group) => group.sessions)
      .find((session) => session.id === threadId)
    if (saved?.model) setModels((current) => ({ ...current, opencode: saved.model ?? '' }))
    if (states.opencode.state === 'live') {
      void window.zero
        .invoke('ocp.thread.prepare', { threadId })
        .then((value) => {
          if (openRef.current.opencode !== threadId || typeof value !== 'object' || value === null)
            return
          const prepared = value as { currentModel?: unknown; models?: unknown }
          const providerModels = Array.isArray(prepared.models)
            ? prepared.models.flatMap((item) => {
                if (typeof item !== 'object' || item === null) return []
                const row = item as { id?: unknown; name?: unknown }
                return typeof row.id === 'string'
                  ? [
                      {
                        id: row.id,
                        label: typeof row.name === 'string' ? row.name : row.id,
                        advertised: true
                      }
                    ]
                  : []
              })
            : []
          setDiscovery((current) => ({
            ...current,
            opencode: {
              ...(current.opencode ?? {
                harness: 'opencode',
                models: [],
                threads: [],
                folders: [],
                note: null
              }),
              models: providerModels
            }
          }))
          if (typeof prepared.currentModel === 'string')
            setModels((current) => ({ ...current, opencode: prepared.currentModel as string }))
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
    }
    window.zero.invoke('ocp.thread.get', { threadId }).then(
      (value) => {
        if (openRef.current.opencode !== threadId) return
        const session =
          typeof value === 'object' && value !== null
            ? (value as { session?: unknown }).session
            : null
        const parsed = parseOpenCodeTranscript(session)
        const current = lanesRef.current.opencode
        if (parsed.usage?.threadId === threadId)
          usageRef.current.set(`opencode:${threadId}`, parsed.usage)
        const next: HarnessState = {
          ...lanesRef.current,
          opencode: {
            ...current,
            items: parsed.items,
            dropped: parsed.dropped,
            usage: parsed.usage?.threadId === threadId ? parsed.usage : null
          }
        }
        lanesRef.current = next
        setLanes(next)
        if (parsed.items.length === 0) setNotice('No messages in this OpenCode session yet.')
      },
      (err: unknown) => {
        if (openRef.current.opencode === threadId)
          setError(err instanceof Error ? err.message : String(err))
      }
    )
  }

  const newConversation = (): void => {
    activePromptRef.current = null
    setPromptHold(null)
    setError(null)
    const currentId = openRef.current[harness]
    const codexRow = lanesRef.current.codex.rows.find((row) => row.id === currentId)
    const codexProject = codexRow?.projectId
      ? projects.find((project) => project.id === codexRow.projectId)
      : null
    const openCodeRow = discovery.opencode?.folders
      .flatMap((group) => group.sessions)
      .find((session) => session.id === currentId)
    const cwd = harness === 'codex' ? (codexRow?.cwd ?? codexProject?.path) : openCodeRow?.directory
    if (!live || !cwd || !result?.models.some((model) => model.id === selectedModel)) {
      setNotice(
        'Select a connected conversation with a verified directory and advertised model before creating a new one.'
      )
      return
    }
    setDraft({
      provider: harness,
      cwd,
      draftId: `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`
    })
    openRef.current = { ...openRef.current, [harness]: null }
    const current = lanesRef.current[harness]
    const next: HarnessState = {
      ...lanesRef.current,
      [harness]: { ...current, threadId: null, items: [], dropped: 0, usage: null }
    }
    lanesRef.current = next
    setLanes(next)
    setComposerText('')
    setNotice('New conversation draft. The provider creates a conversation when you send.')
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
          if (action === 'connect' && harness === 'codex') {
            void window.zero
              .invoke('codex.discover')
              .then((value) => {
                const parsed = parseDiscovery(value)
                if (parsed === null) return
                setDiscovery((current) => ({ ...current, codex: parsed }))
                setModels((current) => ({
                  ...current,
                  codex: parsed.models.some((model) => model.id === current.codex)
                    ? current.codex
                    : (parsed.models[0]?.id ?? '')
                }))
              })
              .catch(() => {})
          }
        }
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setInFlight(false))
  }

  const modelOptions = result?.models.map((model) => model.id) ?? []

  const codexRows = lanes.codex.rows
  const projectThreads = useMemo(
    () => groupThreadsByRegisteredProject(projects, codexRows),
    [projects, codexRows]
  )
  const firstProjectWithRows = projectThreads.groups.findIndex((group) => group.rows.length > 0)
  const openRow = lane.rows.find((r) => r.id === lane.threadId) ?? null
  const openProject =
    projectThreads.groups.find(({ rows }) => rows.some((row) => row.id === openRow?.id))?.project ??
    null
  const canSend =
    live &&
    (lane.threadId !== null || draft?.provider === harness) &&
    selectedModel !== '' &&
    modelOptions.includes(selectedModel) &&
    (draft?.provider === harness || harness === 'opencode' || Boolean(openProject)) &&
    composerText.trim() !== '' &&
    !promptBusy
  const promptRequest = (): PromptSubmitPayload | null =>
    draft?.provider === harness
      ? {
          provider: harness,
          model: selectedModel,
          cwd: draft.cwd,
          draftId: draft.draftId,
          text: composerText
        }
      : lane.threadId === null
        ? null
        : { provider: harness, model: selectedModel, threadId: lane.threadId, text: composerText }
  const promptResult = (value: unknown, request: PromptSubmitPayload): void => {
    const result = value as {
      state?: string
      turnId?: string
      threadId?: string
      holdId?: string
      categories?: string[]
      positions?: number[]
      reason?: string
    }
    if (activePromptRef.current !== JSON.stringify(request)) {
      if (result.state === 'held' && typeof result.holdId === 'string') {
        void window.zero
          .invoke('prompt.decide', { ...request, holdId: result.holdId, action: 'cancel' })
          .catch(() => {})
      }
      setNotice(
        result.state === 'accepted'
          ? 'The original turn was accepted; your newer edit was not sent.'
          : 'Prompt changed during Airlock review. Your current text was not sent; submit it again.'
      )
      return
    }
    if (result.state === 'held' && typeof result.holdId === 'string') {
      setPromptHold({
        id: result.holdId,
        categories: result.categories ?? [],
        positions: result.positions ?? []
      })
      setNotice('Airlock paused this prompt before provider dispatch. Review the categories below.')
    } else if (result.state === 'accepted' && typeof result.turnId === 'string') {
      setPromptHold(null)
      activePromptRef.current = null
      setComposerText((current) => (current === request.text ? '' : current))
      setNotice('Provider accepted the turn. Completion and cost are not yet verified.')
      if (typeof result.threadId === 'string' && draft?.provider === harness) {
        if (harness === 'codex') {
          void loadThreads('codex').then(() => openThread(result.threadId as string))
        } else {
          void window.zero.invoke('ocp.discover').then((discovered) => {
            const parsed = parseDiscovery(discovered)
            if (parsed !== null) setDiscovery((current) => ({ ...current, opencode: parsed }))
            openOpenCodeThread(result.threadId as string)
          })
        }
      }
    } else {
      setPromptHold(null)
      if (typeof result.threadId === 'string' && draft?.provider === harness) {
        setDraft(null)
        openRef.current = { ...openRef.current, [harness]: result.threadId }
        const current = lanesRef.current[harness]
        const next: HarnessState = {
          ...lanesRef.current,
          [harness]: { ...current, threadId: result.threadId }
        }
        lanesRef.current = next
        setLanes(next)
        setNotice(
          'The provider conversation was created, but the turn failed. Open the new conversation to retry; your draft is intact.'
        )
        if (harness === 'codex') void loadThreads('codex')
        else
          void window.zero.invoke('ocp.discover').then((discovered) => {
            const parsed = parseDiscovery(discovered)
            if (parsed !== null) setDiscovery((current) => ({ ...current, opencode: parsed }))
          })
      }
      const reason = result.reason
      if (typeof result.threadId !== 'string')
        setNotice(
          reason === 'dispatch-unavailable'
            ? `${PROVIDER_DISPLAY[harness]} could not start this turn. Check the connection and selected conversation; your draft is intact.`
            : reason === 'thread-unavailable'
              ? 'This Codex conversation cannot be resumed in Zero. It may be active in Codex; open it there or start a new Zero conversation. Your draft is intact.'
              : reason === 'scanner-unavailable'
                ? 'Airlock could not screen this prompt. Nothing was sent; try again after it recovers.'
                : reason === 'expired-or-changed'
                  ? 'The Airlock decision expired or the draft changed. Review it and send again.'
                  : 'Prompt was not sent. Check the text and selected destination.'
        )
    }
  }
  const submitPrompt = (): void => {
    const request = promptRequest()
    if (!canSend || request === null) return
    activePromptRef.current = JSON.stringify(request)
    setPromptBusy(true)
    setError(null)
    void window.zero
      .invoke('prompt.submit', request)
      .then((value) => promptResult(value, request))
      .catch(() => setNotice('Prompt was not sent. The Airlock or provider is unavailable.'))
      .finally(() => setPromptBusy(false))
  }
  const decidePrompt = (action: 'cancel' | 'send-once'): void => {
    const request = promptRequest()
    if (promptHold === null || request === null || promptBusy) return
    const holdId = promptHold.id
    setPromptHold(null)
    setPromptBusy(true)
    void window.zero
      .invoke('prompt.decide', { ...request, holdId, action })
      .then((value) =>
        action === 'cancel'
          ? setNotice('Airlock hold cancelled; nothing was sent.')
          : promptResult(value, request)
      )
      .catch(() => setNotice('Prompt was not sent. The Airlock decision failed.'))
      .finally(() => setPromptBusy(false))
  }
  const decidePermission = (action: 'allow-once' | 'reject'): void => {
    const permission = pendingPermission
    if (permission === null) return
    setPendingPermission(null)
    void window.zero
      .invoke('provider.permission.decide', {
        provider: permission.provider,
        requestId: permission.requestId,
        action,
        ...(action === 'allow-once' && permission.allowOptionId
          ? { optionId: permission.allowOptionId }
          : {})
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }
  const activity = streamingLabel(lane.items)
  const displayItems = useMemo(() => groupVisibleItems(lane.items), [lane.items])
  const counts = useMemo(() => turnItemCounts(lane.items), [lane.items])
  const toolItems = useMemo(
    () => lane.items.filter((i) => i.kind === 'tool' || i.kind === 'exec'),
    [lane.items]
  )
  const toolSummary = useMemo(() => toolOutcomeSummary(lane.items), [lane.items])
  const selectedUsage = lane.usage?.threadId === lane.threadId ? lane.usage : null
  // Context indicator from real lane data only: provider, selected model and
  // the items actually in view. Project and branch need the context-packet
  // backend (spec §§32-34), which does not exist — marked pending below.
  const contextLine =
    lane.threadId !== null
      ? `${PROVIDER_DISPLAY[harness]} · ${selectedModel} · ${lane.items.length} item${lane.items.length === 1 ? '' : 's'} in this view`
      : `${PROVIDER_DISPLAY[harness]} · ${selectedModel}`

  const codexInfo = states.codex
  const opencodeResult = discovery.opencode ?? null
  const openOpenCodeRow =
    opencodeResult?.folders
      .flatMap((group) => group.sessions)
      .find((session) => session.id === lanes.opencode.threadId) ?? null
  const compact = workspaceWidth !== null && workspaceWidth < 620
  const overlayInspector = workspaceWidth !== null && workspaceWidth < 1050

  return (
    <div ref={workspaceRef} className="zw-route" data-region="workspace" style={workspaceStyle}>
      <aside
        data-region="sidebar"
        style={
          compact
            ? { ...sidebarStyle, width: '42%', minWidth: 168, maxWidth: 264, flexShrink: 1 }
            : sidebarStyle
        }
        aria-label="Conversations"
      >
        <span data-voice="human" style={sectionLabel}>
          PROJECT ZERO — ZERO BOT
        </span>
        <button type="button" style={actionButton} onClick={newConversation}>
          New conversation
        </button>

        <div
          role="group"
          aria-label="Conversation source"
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}
        >
          <button
            type="button"
            style={harness === 'codex' ? providerActive : providerButton}
            aria-pressed={harness === 'codex'}
            onClick={() => {
              activePromptRef.current = null
              setPromptHold(null)
              setHarness('codex')
            }}
          >
            Projects
          </button>
          <button
            type="button"
            style={harness === 'opencode' ? providerActive : providerButton}
            aria-pressed={harness === 'opencode'}
            onClick={() => {
              activePromptRef.current = null
              setPromptHold(null)
              setHarness('opencode')
            }}
          >
            OpenCode
          </button>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 10
          }}
        >
          {harness === 'codex' ? (
            <>
              <span data-voice="human" style={sectionLabel}>
                REGISTERED PROJECTS
              </span>
              {projectsError !== null ? (
                <details className="zw-group-details">
                  <summary style={warnNotice}>Projects unavailable · Zero runtime offline</summary>
                  <p style={warnNotice}>{projectsError}</p>
                </details>
              ) : null}
              {projectThreads.groups.map(({ project, rows }, projectIndex) => (
                <details
                  key={project.id}
                  aria-label={`Project ${project.name}`}
                  className="zw-group-details"
                  open={
                    expandedProjects[project.id] ??
                    (projectIndex === firstProjectWithRows ||
                      rows.some((row) => row.id === lanes.codex.threadId))
                  }
                  onToggle={(event) => {
                    const open = event.currentTarget.open
                    setExpandedProjects((current) => ({ ...current, [project.id]: open }))
                  }}
                >
                  <summary data-voice="human" title={project.path}>
                    {project.name} · {rows.length}
                    {rows.some((row) => row.id === lanes.codex.threadId) ? ' · selected' : ''}
                  </summary>
                  {groupThreadsByFolder(project.path, rows).map((folder) => (
                    <details
                      key={folder.path ?? 'unknown'}
                      className="zw-group-details zw-folder-details"
                      open={
                        expandedFolders[`${project.id}:${folder.path}`] ??
                        folder.rows.some((row) => row.id === lanes.codex.threadId)
                      }
                      onToggle={(event) => {
                        const open = event.currentTarget.open
                        setExpandedFolders((current) => ({
                          ...current,
                          [`${project.id}:${folder.path}`]: open
                        }))
                      }}
                    >
                      <summary title={folder.path ?? undefined}>
                        {folder.label} · {folder.rows.length}
                      </summary>
                      <ThreadList
                        rows={folder.rows}
                        selectedId={lanes.codex.threadId}
                        onSelect={openThread}
                      />
                    </details>
                  ))}
                </details>
              ))}
              {projects.length === 0 && projectsError === null ? (
                <p style={bodyText}>No registered projects yet.</p>
              ) : null}
              <details
                aria-label="Unprojected conversations"
                className="zw-group-details"
                style={{ marginTop: 'auto' }}
              >
                <summary data-voice="human">
                  UNPROJECTED · {projectThreads.unprojected.length}
                </summary>
                {projectThreads.unprojected.length > 0 ? (
                  <ThreadList
                    rows={projectThreads.unprojected}
                    selectedId={lanes.codex.threadId}
                    onSelect={openThread}
                  />
                ) : (
                  <EmptyState
                    title="No conversations yet"
                    explanation={
                      codexInfo.state === 'live'
                        ? 'Connected — no unprojected threads in the read-only list.'
                        : 'Connect Codex to load the read-only thread list.'
                    }
                  />
                )}
              </details>
            </>
          ) : opencodeResult !== null && opencodeResult.folders.length > 0 ? (
            <FolderGroupList
              groups={opencodeResult.folders}
              selectedId={lanes.opencode.threadId}
              onSelect={openOpenCodeThread}
            />
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
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
        <div
          style={
            compact
              ? {
                  ...canvasHead,
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                  padding: '10px 10px 6px'
                }
              : canvasHead
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span data-voice="human" style={sectionLabel}>
              CONVERSATION · {harness.toUpperCase()}
            </span>
            {lane.threadId !== null ? (
              <span
                data-voice="human"
                style={{ ...bodyText, fontWeight: 700, overflowWrap: 'anywhere' }}
              >
                {openRow !== null ? threadTitle(openRow) : openOpenCodeRow?.title || lane.threadId}
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
              aria-controls="turn-inspector"
              onClick={() => setInspectorOpen((v) => !v)}
            >
              {inspectorOpen ? 'Hide inspector' : 'Show inspector'}
            </button>
          </div>
        </div>

        <div className="zw-transcript" style={transcriptStyle}>
          {pendingPermission !== null ? (
            <div role="alert" aria-label="Provider permission" style={warnNotice}>
              <p>{pendingPermission.title}</p>
              <button type="button" onClick={() => decidePermission('reject')}>
                Reject
              </button>
              <button
                type="button"
                disabled={
                  pendingPermission.provider === 'opencode' && !pendingPermission.allowOptionId
                }
                onClick={() => decidePermission('allow-once')}
              >
                Allow once
              </button>
            </div>
          ) : null}
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
                  ? 'Choose an OpenCode session on the left to read its saved messages and tool calls.'
                  : 'Choose a thread on the left to read it. Live turns append here while the bridge streams.'
              }
              technical={
                harness === 'codex'
                  ? 'thread/list + thread/read · read-only · bounded to the last 400 items'
                  : 'local session store + sanitized CLI export · read-only · bounded to the last 400 items'
              }
            />
          ) : (
            <>
              {displayItems.map((item, n) =>
                item.kind === 'thinking-group' ? (
                  <ThinkingGroupBlock key={item.id} items={item.items} />
                ) : (
                  <ChatRow
                    key={item.id === '' ? `${item.kind}-anon-${n}` : item.id}
                    item={item}
                    harness={harness}
                    model={openRow?.model ?? null}
                  />
                )
              )}
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

        <div className="zw-composer-shell" data-region="composer" style={composerStyle}>
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
          {mismatch !== null ? (
            <p data-voice="human" style={warnNotice}>
              {mismatch} Mirror: {mirrorLabel(harness)}
            </p>
          ) : null}
          <div style={composerBox}>
            <textarea
              data-voice="human"
              style={composerInput}
              rows={3}
              value={composerText}
              onChange={(e) => {
                activePromptRef.current = null
                setPromptHold(null)
                setComposerText(e.target.value)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.metaKey) {
                  e.preventDefault()
                  if (canSend && promptHold === null) submitPrompt()
                  else setNotice(SEND_BLOCKED_NOTICE)
                }
              }}
              placeholder="Describe the work for Zero…"
              aria-label="Message Zero"
            />
            <div
              style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}
            >
              <select
                aria-label="Model selector"
                style={{
                  ...modelChip,
                  borderRadius: 6,
                  maxWidth: compact ? 132 : 180,
                  minWidth: 0,
                  flex: '1 1 100px'
                }}
                value={selectedModel}
                onChange={(e) => {
                  activePromptRef.current = null
                  setPromptHold(null)
                  setModels((s) => ({ ...s, [harness]: e.target.value }))
                }}
              >
                {modelOptions.length === 0 && selectedModel === '' ? (
                  <option value="" disabled>
                    No advertised models
                  </option>
                ) : null}
                {selectedModel !== '' && !modelOptions.includes(selectedModel) ? (
                  <option value={selectedModel} disabled>
                    {selectedModel} · unavailable
                  </option>
                ) : null}
                {result?.models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                style={disabledAction}
                disabled
                aria-label="Voice input"
                title={VOICE_DISABLED_NOTICE}
              >
                <svg
                  aria-hidden="true"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="9" y="2" width="6" height="12" rx="3" />
                  <path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8" />
                </svg>
              </button>
              <button
                type="button"
                style={canSend && promptHold === null ? sendButton : disabledSend}
                disabled={!canSend || promptHold !== null}
                onClick={submitPrompt}
                aria-label="Send turn"
                title={canSend ? 'Send through Airlock' : SEND_BLOCKED_NOTICE}
              >
                <svg
                  aria-hidden="true"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 19V5m-6 6 6-6 6 6" />
                </svg>
              </button>
            </div>
          </div>
          {promptHold !== null ? (
            <div role="alert" aria-label="Airlock hold" style={warnNotice}>
              <p>
                Sensitive data detected: {promptHold.categories.join(', ')}. Positions:{' '}
                {promptHold.positions.join(', ')}. No prompt has been sent.
              </p>
              <button type="button" onClick={() => decidePrompt('cancel')} disabled={promptBusy}>
                Cancel
              </button>
              <button type="button" onClick={() => decidePrompt('send-once')} disabled={promptBusy}>
                Send once
              </button>
            </div>
          ) : (
            <p data-voice="human" style={bodyText}>
              {live && (harness === 'opencode' || Boolean(openProject))
                ? 'Send runs through the local Airlock. Sensitive prompts pause for approval.'
                : SEND_BLOCKED_NOTICE}
            </p>
          )}
        </div>
      </main>

      <aside
        id="turn-inspector"
        className={`zw-inspector${inspectorOpen ? '' : ' is-collapsed'}`}
        data-region="inspector"
        style={{
          ...inspectorStyle,
          width: compact ? 240 : 288,
          ...(overlayInspector
            ? {
                position: 'absolute',
                right: 0,
                top: 0,
                bottom: 0,
                zIndex: 5,
                background: 'var(--z-card-cream)',
                boxShadow: inspectorOpen ? '-12px 0 30px rgb(0 0 0 / 12%)' : 'none'
              }
            : {})
        }}
        aria-label="Turn inspector"
        aria-hidden={!inspectorOpen}
        inert={!inspectorOpen}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span data-voice="human" style={sectionLabel}>
            INSPECTOR
          </span>
          {overlayInspector ? (
            <button type="button" style={actionButton} onClick={() => setInspectorOpen(false)}>
              Close
            </button>
          ) : null}
        </div>
        {openRow !== null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <p data-voice="human" style={{ ...bodyText, fontWeight: 700 }}>
              {threadTitle(openRow)}
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
            <p data-voice="human" style={{ ...bodyText, fontSize: 12 }}>
              {toolSummary.completed} completed · {toolSummary.failed} failed ·{' '}
              {toolSummary.running} running
            </p>
            <details>
              <summary data-voice="human" style={{ ...bodyText, cursor: 'pointer' }}>
                Calls by tool
              </summary>
              {toolSummary.groups.map((group) => (
                <p key={group.name} data-voice="human" style={{ ...bodyText, fontSize: 12 }}>
                  {group.name} · {group.count}
                </p>
              ))}
            </details>
          </div>
        )}

        <span data-voice="human" style={sectionLabel}>
          USAGE
        </span>
        <p data-voice="human" style={bodyText}>
          {selectedUsage !== null
            ? `${formatTokenCount(selectedUsage.input)} input · ${formatTokenCount(selectedUsage.output)} output · ${formatTokenCount(selectedUsage.total)} total`
            : 'No verified token totals for this conversation yet.'}
        </p>
        {selectedUsage !== null ? (
          <p data-voice="machine" style={machineMeta}>
            {formatTokenCount(selectedUsage.cachedInput)} cached input ·{' '}
            {formatTokenCount(selectedUsage.reasoningOutput)} reasoning output
            {selectedUsage.cost !== null ? ` · provider cost ${selectedUsage.cost}` : ''}
            <br />
            {selectedUsage.source === 'codex-live' ? 'Codex live' : 'OpenCode saved'} ·{' '}
            {new Date(selectedUsage.observedAt).toLocaleTimeString()}
          </p>
        ) : null}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span data-voice="human" style={sectionLabel}>
            AIRLOCK · {promptHold !== null ? 'Held' : live ? 'Active' : 'Unavailable'}
          </span>
          <button type="button" style={actionButton} onClick={() => openRoute('airlock')}>
            History
          </button>
        </div>

        <details>
          <summary data-voice="human" style={{ ...bodyText, cursor: 'pointer' }}>
            Details
          </summary>
          {openRow !== null ? (
            <p data-voice="machine" style={machineMeta}>
              Task {openRow.id} · {threadTime(threadTimestamp(openRow))}
              {openRow.status !== '' ? ` · ${openRow.status}` : ''}
            </p>
          ) : null}
          <p data-voice="human" style={bodyText}>
            {PROVIDER_DISPLAY[harness]} · {selectedModel} · {openProject?.name ?? 'No project'}
          </p>
          <p data-voice="human" style={bodyText}>
            {counts.messages} messages · {counts.thinking} reasoning items · {counts.tools} tools
            {counts.notices > 0 ? ` · ${counts.notices} protocol notes` : ''}
          </p>
          {lane.dropped > 0 ? (
            <p data-voice="human" style={bodyText}>
              +{lane.dropped} earlier items outside this view
            </p>
          ) : null}
          <details>
            <summary data-voice="human" style={{ ...bodyText, cursor: 'pointer' }}>
              Bridge events · {shownEvents.length}
            </summary>
            {shownEvents.map((event, index) => (
              <BridgeEventRow key={`${event.harness}-${index}`} event={event} />
            ))}
            {log.dropped > 0 ? (
              <p data-voice="human" style={bodyText}>
                +{log.dropped} older events outside this view
              </p>
            ) : null}
          </details>
        </details>
      </aside>
    </div>
  )
})
