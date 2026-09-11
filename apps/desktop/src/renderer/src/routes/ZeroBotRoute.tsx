import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ZERO_TYPE } from '../../../shared/tokens'
import { Chip } from './Chip'
import type { Tone } from './runtime.types'
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
  pushBridgeEvent,
  visibleBridgeEvents,
  type BridgeConnState,
  type BridgeEvent,
  type DiscoveryResult,
  type Harness
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
  color: '#FFFFFF'
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
  color: '#FFFFFF'
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
  const [events, setEvents] = useState<BridgeEvent[]>([])
  const [dropped, setDropped] = useState(0)
  const [inFlight, setInFlight] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const eventsRef = useRef<BridgeEvent[]>([])
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
      const r = pushBridgeEvent(eventsRef.current, {
        harness: h,
        method,
        params: push.event?.params
      })
      eventsRef.current = r.events
      setEvents(r.events)
      setDropped((d) => d + r.dropped)
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
  const shown = useMemo(() => visibleBridgeEvents(events, harness), [events, harness])
  const live = info.state === 'live'

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
        }
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setInFlight(false))
  }

  const modelOptions = Array.from(
    new Set([...HARNESS_MODELS[harness], ...(result?.models.map((m) => m.id) ?? [])])
  )

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
            style={live && !inFlight ? actionButton : disabledAction}
            disabled={!live || inFlight}
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
          <span style={datumLabel}>DISCOVERY · READ-ONLY PROBES</span>
          <span style={datumLabel}>
            {harness === 'codex' ? 'MODEL/LIST + THREAD/LIST' : 'HONEST ABSENCE'}
          </span>
        </div>
        {result === null ? (
          <span style={noticeStyle}>
            {harness === 'codex'
              ? 'No discovery yet. Connect Codex, then run the read-only probes.'
              : 'OpenCode ACP advertises no read-only discovery method in this build; sessions surface from streamed bridge events.'}
          </span>
        ) : (
          <>
            {result.note !== null ? <span style={noticeStyle}>{result.note}</span> : null}
            {result.models.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {result.models.map((m) => (
                  <Chip key={m.id} label={`${m.id} · advertised`} tone="neutral" />
                ))}
              </div>
            ) : null}
            {result.threads.length > 0 ? (
              result.threads.map((t) => (
                <span key={t.id} style={eventCell}>
                  thread {t.id} · {t.name !== '' ? t.name : 'untitled'}
                </span>
              ))
            ) : (
              <span style={noticeStyle}>No threads returned by the discovery probe.</span>
            )}
          </>
        )}
      </div>

      <div style={cardStyle}>
        <div style={headerRow}>
          <span style={datumLabel}>CONVERSATION · BRIDGE EVENTS</span>
          {shown.length > 0 ? (
            live ? (
              <Chip label="LIVE EVIDENCE" tone="healthy" />
            ) : (
              <Chip label="RETAINED EVIDENCE" tone="neutral" />
            )
          ) : null}
        </div>
        {shown.length === 0 ? (
          <span style={noticeStyle}>
            {info.state === 'live'
              ? 'Connected; no bridge event has streamed into this window yet.'
              : 'No bridge events in this window yet. Connect manually to surface streamed protocol state.'}
          </span>
        ) : (
          <>
            {shown.map((e, i) => (
              <BridgeEventRow key={`${e.harness}-${i}`} event={e} />
            ))}
            {dropped > 0 ? (
              <span style={noticeStyle}>
                +{dropped} older event(s) dropped from bounded memory.
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
