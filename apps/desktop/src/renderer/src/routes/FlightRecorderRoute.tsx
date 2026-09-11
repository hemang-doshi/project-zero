import { memo, useMemo, useState } from 'react'
import { ZERO_TYPE } from '../../../shared/tokens'
import { useCockpit } from '../store/cockpit'
import { Chip } from './Chip'
import { flightNotice, flightRows, freshnessChip, visibleFlightRows } from './runtime.types'

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

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '76px 1fr 130px 110px',
  gap: 10,
  alignItems: 'center',
  padding: '5px 0',
  borderBottom: '1px solid color-mix(in srgb, var(--z-line) 70%, transparent)',
  minWidth: 0
}

const tableWrap: React.CSSProperties = {
  background: 'var(--z-card-cream)',
  border: '1px solid var(--z-line)',
  borderRadius: 8,
  padding: '10px 12px',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column'
}

const showAllButton: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  color: 'var(--z-ink)',
  background: 'transparent',
  border: '1px solid var(--z-line)',
  borderRadius: 999,
  padding: '3px 10px',
  cursor: 'pointer'
}

const clockStamp = (iso: string): string => (iso.length >= 19 ? iso.slice(11, 19) : '—')

export const FlightRecorderRoute = memo(function FlightRecorderRoute(): React.JSX.Element {
  const conn = useCockpit((s) => s.state)
  const snapshot = useCockpit((s) => s.snapshot)
  const [showAll, setShowAll] = useState(false)

  const freshness = useMemo(() => freshnessChip(conn, snapshot), [conn, snapshot])
  const rows = useMemo(() => visibleFlightRows(flightRows(snapshot), showAll), [snapshot, showAll])
  const notice = useMemo(() => flightNotice(snapshot), [snapshot])

  return (
    <div className="zw-route" style={routeStyle}>
      <div style={headerRow}>
        <span style={microStyle}>PROJECT ZERO — FLIGHT RECORDER</span>
        <Chip label={freshness.label} tone={freshness.tone} />
      </div>
      <div style={headerRow}>
        <span style={noticeStyle}>{notice}</span>
        <button style={showAllButton} type="button" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Hide noise' : 'Show all'}
        </button>
      </div>
      <div style={tableWrap}>
        <div style={rowStyle}>
          <span style={headStyle}>TIME</span>
          <span style={headStyle}>CHANNEL</span>
          <span style={headStyle}>ACTOR</span>
          <span style={headStyle}>OUTCOME</span>
        </div>
        {rows.length === 0 ? (
          <span style={noticeStyle}>No rows in the current projection.</span>
        ) : (
          rows.map((r) => (
            <div key={r.id} style={rowStyle}>
              <span style={cellStyle}>{clockStamp(r.time)}</span>
              <span style={{ ...cellStyle, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.channel}
              </span>
              <span style={{ ...cellStyle, color: 'var(--z-secondary-ink)' }}>{r.actor}</span>
              <Chip label={r.outcome} tone={r.tone} />
            </div>
          ))
        )}
      </div>
      <span style={noticeStyle}>
        Rows are retained bounded memory, not live evidence · noise filter hides
        display.*/clock.tick/sse.keepalive/ready by default
      </span>
    </div>
  )
})
