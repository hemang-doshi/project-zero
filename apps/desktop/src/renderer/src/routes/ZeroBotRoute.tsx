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

const routeStyle: React.CSSProperties = {
  height: '100%',
  overflowY: 'auto',
  padding: '20px 22px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12
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

const noticeStyle: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10.5,
  color: 'var(--z-secondary-ink)',
  lineHeight: 1.6,
  margin: 0
}

const warnNotice: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10.5,
  color: 'var(--z-primary-authority)',
  lineHeight: 1.6,
  margin: 0
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

const eventCell: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10,
  color: 'var(--z-ink)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const pickerButton: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '0.08em',
  padding: '5px 14px',
  borderRadius: 999,
  border: '1px solid var(--z-line)',
  background: 'transparent',
  color: 'var(--z-ink)',
  cursor: 'pointer'
}

const pickerSelected: React.CSSProperties = {
  ...pickerButton,
  background: 'var(--z-orange)',
  borderColor: 'var(--z-orange)',
  color: 'var(--z-card-white)'
}

const actionButton: React.CSSProperties = {
  ...pickerButton,
  borderRadius: 6
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

const transcriptColumn: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  maxHeight: 380,
  overflowY: 'auto',
  minHeight: 60
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

export function FolderGroupList({ groups }: { groups: OpenCodeFolderGroup[] }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      {groups.map((g) => (
        <div key={g.path} style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <div style={folderHead}>
            <span style={microStyle}>
              {g.folder.toUpperCase()} · {g.count}
            </span>
            <span style={{ ...eventCell, color: 'var(--z-secondary-ink)', textAlign: 'right' }}>
              {g.path}
            </span>
          </div>
          {g.sessions.map((s) => (
            <div key={s.id} style={sessionRow}>
              <span style={eventCell}>{s.title === '' ? s.id : s.title}</span>
              <span style={{ ...eventCell, color: 'var(--z-secondary-ink)', textAlign: 'right' }}>
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
    if (harness !== 'codex') return
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

  return (
    <div className="zw-route" style={routeStyle}>
      <div style={headerRow}>
        <span style={microStyle}>PROJECT ZERO — ZERO BOT</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['codex', 'opencode'] as const).map((h) => (
            <button
              key={h}
              type="button"
              style={harness === h ? pickerSelected : pickerButton}
              aria-pressed={harness === h}
              onClick={() => setHarness(h)}
            >
              {h === 'codex' ? 'Codex' : 'OpenCode'}
            </button>
          ))}
        </div>
      </div>

      <div style={cardStyle}>
        <div style={headerRow}>
          <span style={datumLabel}>
            {harness === 'codex' ? 'CODEX APP-SERVER' : 'OPENCODE ACP'} BRIDGE
          </span>
          <Chip label={STATE_LABEL[info.state]} tone={STATE_TONE[info.state]} />
        </div>
        <span style={noticeStyle}>{STATE_DETAIL[info.state]}</span>
        {info.lastDiagnostic !== null ? (
          <span style={warnNotice}>{info.lastDiagnostic}</span>
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
        {error !== null ? <span style={warnNotice}>{error}</span> : null}
        {notice !== null ? <span style={noticeStyle}>{notice}</span> : null}
      </div>

      <div style={cardStyle}>
        <div style={headerRow}>
          <span style={datumLabel}>DISCOVERY · THREADS + MODELS</span>
          <span style={datumLabel}>
            {harness === 'codex' ? 'THREAD/LIST · READ-ONLY' : 'LOCAL STORE · READ-ONLY'}
          </span>
        </div>
        {harness === 'opencode' ? (
          result !== null && result.folders.length > 0 ? (
            <FolderGroupList groups={result.folders} />
          ) : (
            <span style={noticeStyle}>
              {result === null
                ? 'Reading the local OpenCode session store…'
                : (result.note ?? 'No OpenCode sessions in the local store yet.')}
            </span>
          )
        ) : lane.rows.length === 0 ? (
          <span style={noticeStyle}>
            {live
              ? 'Connected; no threads returned by the read-only list yet.'
              : 'No thread list yet. Connect Codex to load the read-only thread list.'}
          </span>
        ) : (
          <ThreadList rows={lane.rows} selectedId={lane.threadId} onSelect={openThread} />
        )}
        {harness === 'codex' && result !== null && result.models.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {result.models.map((m) => (
              <Chip key={m.id} label={`${m.id} · advertised`} tone="neutral" />
            ))}
          </div>
        ) : null}
      </div>

      <div style={cardStyle}>
        <div style={headerRow}>
          <span style={datumLabel}>CONVERSATION · {harness.toUpperCase()}</span>
          {lane.threadId !== null ? (
            live ? (
              <Chip label="LIVE" tone="healthy" />
            ) : (
              <Chip label="RETAINED" tone="neutral" />
            )
          ) : null}
        </div>
        {lane.threadId === null ? (
          <span style={noticeStyle}>
            {harness === 'opencode'
              ? 'OpenCode sessions list above from the local session store; no read-only transcript read exists in this build.'
              : 'Select a thread above to render its transcript. Live events append to the open thread.'}
          </span>
        ) : (
          <>
            <span style={{ ...microStyle, fontWeight: 400, letterSpacing: '0.06em' }}>
              {openRow !== null ? threadTitle(openRow) : lane.threadId}
            </span>
            <div style={transcriptColumn}>
              {lane.items.map((item, n) => (
                <ChatRow key={item.id === '' ? `${item.kind}-anon-${n}` : item.id} item={item} />
              ))}
            </div>
            {lane.dropped > 0 ? (
              <span style={noticeStyle}>
                +{lane.dropped} earlier item(s) dropped from bounded memory.
              </span>
            ) : null}
          </>
        )}
      </div>

      <div style={cardStyle}>
        <div style={headerRow}>
          <span style={datumLabel}>CONVERSATION · BRIDGE EVENTS</span>
          {shownEvents.length > 0 ? (
            live ? (
              <Chip label="LIVE EVIDENCE" tone="healthy" />
            ) : (
              <Chip label="RETAINED EVIDENCE" tone="neutral" />
            )
          ) : null}
        </div>
        {shownEvents.length === 0 ? (
          <span style={noticeStyle}>
            {live
              ? 'Connected; no bridge event has streamed into this window yet.'
              : 'No bridge events in this window yet. Connect manually to surface streamed protocol state.'}
          </span>
        ) : (
          <>
            {shownEvents.map((e, i) => (
              <BridgeEventRow key={`${e.harness}-${i}`} event={e} />
            ))}
            {log.dropped > 0 ? (
              <span style={noticeStyle}>
                +{log.dropped} older event(s) dropped from bounded {harness} memory.
              </span>
            ) : null}
          </>
        )}
        <span style={noticeStyle}>
          Events are retained bounded memory, never a live or actionable run while the bridge is not
          connected.
        </span>
      </div>

      <div style={cardStyle}>
        <div style={headerRow}>
          <span style={datumLabel}>COMPOSER</span>
          <Chip
            label={`MODEL ${selectedModel}`}
            tone={mismatch === null ? 'neutral' : 'attention'}
          />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
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
          <span style={warnNotice}>
            {mismatch} Mirror: {mirrorLabel(harness)}
          </span>
        ) : null}
        <span style={noticeStyle}>{SEND_BLOCKED_NOTICE}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" style={disabledSend} disabled aria-label="Send turn">
            Send
          </button>
          <button type="button" style={disabledAction} disabled aria-label="Voice input">
            Voice
          </button>
        </div>
        <span style={noticeStyle}>{VOICE_DISABLED_NOTICE}</span>
      </div>
    </div>
  )
})
