import { memo, useEffect, useMemo, useState } from 'react'
import { ZERO_TYPE } from '../../../shared/tokens'
import { useCockpit } from '../store/cockpit'
import { Chip } from './Chip'
import type { RuntimeConnState } from '../../../shared/protocol'
import type { Tone } from './runtime.types'
import {
  airlockStats,
  approvalActions,
  approvalAuditRows,
  approvalExpired,
  approvalFreshness,
  approvalIdentityComplete,
  approvalNotice,
  parseSnapshot,
  type CockpitApproval
} from './runtime.types'

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

const headingStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 800,
  color: 'var(--z-ink)',
  lineHeight: 1.25
}

const summaryStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: 'var(--z-secondary-ink)',
  lineHeight: 1.5,
  margin: 0
}

const statsRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  gap: 10
}

const statCell: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  background: 'var(--z-card-cream)',
  border: '1px solid var(--z-line)',
  borderRadius: 8,
  padding: '10px 12px',
  minWidth: 0
}

const statValue: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 20,
  fontWeight: 700,
  color: 'var(--z-ink)',
  fontVariantNumeric: 'tabular-nums'
}

const statLabel: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.12em',
  color: 'var(--z-secondary-ink)'
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

const approvalHead: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 12.5,
  fontWeight: 700,
  color: 'var(--z-ink)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const approvalTarget: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10.5,
  color: 'var(--z-secondary-ink)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const datumRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 8
}

const datumLabel: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 8.5,
  fontWeight: 700,
  letterSpacing: '0.12em',
  color: 'var(--z-secondary-ink)'
}

const datumValue: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10.5,
  color: 'var(--z-ink)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const noticeStyle: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10.5,
  color: 'var(--z-secondary-ink)',
  lineHeight: 1.6
}

const warnNotice: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10.5,
  color: 'var(--z-primary-authority)',
  lineHeight: 1.6
}

const cellStyle: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10.5,
  color: 'var(--z-ink)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const headStyle: React.CSSProperties = {
  ...cellStyle,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.12em',
  color: 'var(--z-secondary-ink)',
  borderBottom: '1px solid var(--z-line)',
  paddingBottom: 6
}

const auditRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '86px 1fr 120px 100px',
  gap: 10,
  alignItems: 'center',
  padding: '5px 0',
  borderBottom: '1px solid color-mix(in srgb, var(--z-line) 70%, transparent)',
  minWidth: 0
}

const actionButton: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.06em',
  padding: '5px 12px',
  borderRadius: 6,
  border: '1px solid var(--z-line)',
  background: 'transparent',
  color: 'var(--z-ink)',
  cursor: 'pointer'
}

const approveEnabled: React.CSSProperties = {
  ...actionButton,
  background: 'var(--z-orange)',
  borderColor: 'var(--z-orange)',
  color: '#FFFFFF'
}

const disabledAction: React.CSSProperties = {
  ...actionButton,
  opacity: 0.45,
  cursor: 'not-allowed'
}

const connChipLabel = (conn: string): string => {
  switch (conn) {
    case 'live':
      return 'ZEROD LIVE'
    case 'connecting':
      return 'ZEROD CONNECTING'
    case 'reconnecting':
      return 'ZEROD RECONNECTING'
    default:
      return 'ZEROD OFFLINE'
  }
}

const connChipTone = (conn: string): Tone => {
  switch (conn) {
    case 'live':
      return 'healthy'
    case 'connecting':
    case 'reconnecting':
      return 'attention'
    default:
      return 'error'
  }
}

const FRESHNESS_LABEL: Record<string, string> = {
  live: 'LIVE REQUEST',
  retained: 'CACHED EVIDENCE',
  expired: 'EXPIRED'
}

const FRESHNESS_TONE: Record<string, Tone> = {
  live: 'healthy',
  retained: 'neutral',
  expired: 'error'
}

export function AirlockApprovalRow({
  item,
  conn,
  now
}: {
  item: CockpitApproval
  conn: RuntimeConnState
  now: number
}): React.JSX.Element {
  const [inFlight, setInFlight] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)
  const actions = approvalActions(conn, item, now)
  const freshness = approvalFreshness(conn, item, now)
  const expired = approvalExpired(item, now)
  const identity = approvalIdentityComplete(item)

  const resolve = (approve: boolean): void => {
    if (approve ? !actions.canApprove : !actions.canDeny) return
    setInFlight(true)
    setOutcome(null)
    window.zero
      .invoke('command.send', {
        op: approve ? 'approvals.approve' : 'approvals.deny',
        body: { id: item.id }
      })
      .then(() => setOutcome(approve ? 'Approve sent for exact id.' : 'Deny sent for exact id.'))
      .catch((err: unknown) => setOutcome(err instanceof Error ? err.message : String(err)))
      .finally(() => setInFlight(false))
  }

  return (
    <div style={cardStyle}>
      <div style={headerRow}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
          <span style={approvalHead}>{item.capability}</span>
          <span style={approvalTarget}>{item.node}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
          <Chip label="PROJECT ZERO" tone={identity ? 'attention' : 'neutral'} />
          <Chip label={FRESHNESS_LABEL[freshness]} tone={FRESHNESS_TONE[freshness]} />
          {expired && freshness !== 'expired' ? <Chip label="EXPIRED" tone="error" /> : null}
        </div>
      </div>
      <div style={datumRow}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={datumLabel}>REQUEST ID</span>
          <span style={datumValue}>{item.id}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={datumLabel}>SOURCE</span>
          <span style={datumValue}>Project Zero · zerod</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={datumLabel}>DEADLINE</span>
          <span style={datumValue}>{item.deadline}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={datumLabel}>DECISION</span>
          <span style={datumValue}>{item.status}</span>
        </div>
      </div>
      <span style={noticeStyle}>{approvalNotice(conn, item, now)}</span>
      {item.input_omitted ? (
        <span style={noticeStyle}>
          INPUT OMITTED · The display summary is incomplete; the action still references only the
          original invocation ID.
        </span>
      ) : null}
      {outcome !== null ? <span style={warnNotice}>{outcome}</span> : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          style={actions.canDeny && !inFlight ? actionButton : disabledAction}
          disabled={!actions.canDeny || inFlight}
          aria-label={`Deny exact request ${item.id}`}
          onClick={() => resolve(false)}
        >
          Deny exact request
        </button>
        <button
          type="button"
          style={actions.canApprove && !inFlight ? approveEnabled : disabledAction}
          disabled={!actions.canApprove || inFlight}
          aria-label={`Approve exact request ${item.id}`}
          onClick={() => resolve(true)}
        >
          {inFlight ? 'Resolving…' : 'Approve exact request'}
        </button>
      </div>
    </div>
  )
}

export function AirlockSlate({
  conn,
  snapshot,
  now
}: {
  conn: RuntimeConnState
  snapshot: unknown
  now: number
}): React.JSX.Element {
  const parsed = useMemo(() => parseSnapshot(snapshot), [snapshot])
  const stats = useMemo(() => airlockStats(snapshot), [snapshot])
  const approvals = useMemo(() => parsed?.approvals ?? [], [parsed])
  const audit = useMemo(() => approvalAuditRows(snapshot), [snapshot])
  const approvalsTruncated = parsed?.truncated.approvals === true
  const auditTruncated = parsed?.truncated.audit === true

  const emptyDetail =
    conn === 'connecting' || conn === 'reconnecting'
      ? 'zerod is connecting. No current runtime decision can be inferred from an empty projection.'
      : conn !== 'live'
        ? 'zerod is offline. No pending decision can be inferred.'
        : 'No approval is present in the current bounded runtime projection.'

  return (
    <div className="zw-route" style={routeStyle}>
      <div style={headerRow}>
        <span style={microStyle}>PROJECT ZERO — AIRLOCK</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Chip label="EXPLICIT LOCAL AUTHORITY" tone="error" />
          <Chip label={connChipLabel(conn)} tone={connChipTone(conn)} />
        </div>
      </div>
      <div>
        <span style={headingStyle}>Airlock: Local Boundary & Outbound Egress Gate</span>
        <p style={summaryStyle}>
          Every visible live or retained request stays attached to its original authority ID.
          Display-only summaries never become action payloads.
        </p>
      </div>
      <div style={statsRow}>
        <div style={statCell}>
          <span style={statValue}>{stats.pending}</span>
          <span style={statLabel}>PENDING</span>
        </div>
        <div style={statCell}>
          <span style={statValue}>{stats.runtime}</span>
          <span style={statLabel}>PROJECT ZERO</span>
        </div>
        <div style={statCell}>
          <span style={statValue}>{stats.codex}</span>
          <span style={statLabel}>CODEX</span>
        </div>
        <div style={statCell}>
          <span style={statValue}>{stats.audited}</span>
          <span style={statLabel}>AUDITED</span>
        </div>
      </div>
      <div style={cardStyle}>
        <div style={headerRow}>
          <span style={datumLabel}>OUTBOUND & TOOL BOUNDARY REQUESTS</span>
          <span style={datumValue}>
            {approvals.length}
            {approvalsTruncated ? '+' : ''} VISIBLE
          </span>
        </div>
        {approvals.length === 0 ? (
          <span style={noticeStyle}>Boundary idle · {emptyDetail}</span>
        ) : (
          approvals.map((a) => <AirlockApprovalRow key={a.id} item={a} conn={conn} now={now} />)
        )}
        {approvalsTruncated ? (
          <span style={warnNotice}>
            The daemon reports additional approvals beyond this bounded projection. The visible
            count is a lower bound.
          </span>
        ) : null}
      </div>
      <div style={cardStyle}>
        <div style={headerRow}>
          <span style={datumLabel}>HISTORICAL APPROVAL LEDGER</span>
          <span style={datumValue}>{audit.length} VISIBLE</span>
        </div>
        {audit.length === 0 ? (
          <span style={noticeStyle}>No approval decisions in bounded history.</span>
        ) : (
          <>
            <div style={auditRowStyle}>
              <span style={headStyle}>TIME</span>
              <span style={headStyle}>ACTION</span>
              <span style={headStyle}>ACTOR</span>
              <span style={headStyle}>OUTCOME</span>
            </div>
            {audit.slice(0, 100).map((row) => (
              <div key={row.seq} style={auditRowStyle}>
                <span style={cellStyle}>
                  {row.time.length >= 19 ? row.time.slice(11, 19) : '—'}
                </span>
                <span style={cellStyle}>{row.action}</span>
                <span style={{ ...cellStyle, color: 'var(--z-secondary-ink)' }}>
                  {row.principal ?? '—'}
                </span>
                <Chip
                  label={row.decision}
                  tone={row.decision === 'APPROVED' ? 'healthy' : 'neutral'}
                />
              </div>
            ))}
          </>
        )}
        {auditTruncated ? (
          <span style={warnNotice}>
            The daemon reports additional audit decisions beyond this bounded projection. The
            visible count is a lower bound.
          </span>
        ) : null}
      </div>
      <span style={noticeStyle}>
        Runtime approvals resolve through the daemon&apos;s exact-ID approve/deny commands; one
        decision per click, never batched. Codex app-server approvals ride the Zero Bot lane.
      </span>
    </div>
  )
}

export const AirlockRoute = memo(function AirlockRoute(): React.JSX.Element {
  const conn = useCockpit((s) => s.state)
  const snapshot = useCockpit((s) => s.snapshot)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(t)
  }, [])
  return <AirlockSlate conn={conn} snapshot={snapshot} now={now} />
})
