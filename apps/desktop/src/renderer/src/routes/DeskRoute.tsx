import { memo, useEffect, useState } from 'react'
import { elapsed } from '../../../shared/format'
import { ZERO_TYPE } from '../../../shared/tokens'
import { useCockpit } from '../store/cockpit'
import { Chip } from './Chip'
import {
  activeProjectLabel,
  connectivity,
  extrapolate,
  gitLine,
  selectSession,
  sessionChipTone
} from './runtime.types'

const routeStyle: React.CSSProperties = {
  height: '100%',
  overflowY: 'auto',
  padding: '20px 22px',
  display: 'flex',
  flexDirection: 'column',
  gap: 18
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
  const project = useCockpit((s) => selectSession(s.snapshot)?.project ?? '')
  const sessionState = useCockpit((s) => selectSession(s.snapshot)?.state ?? null)
  const elapsedMs = useCockpit((s) => selectSession(s.snapshot)?.elapsed_ms ?? null)
  const connLabel = useCockpit((s) => connectivity(s.state, s.snapshot).label)
  const connDetail = useCockpit((s) => connectivity(s.state, s.snapshot).detail)
  const connTone = useCockpit((s) => connectivity(s.state, s.snapshot).tone)
  const branch = useCockpit((s) => gitLine(s.snapshot)?.branch ?? null)
  const dirty = useCockpit((s) => gitLine(s.snapshot)?.dirty ?? null)

  const activeProject = activeProjectLabel(conn, project)
  const gitParts: string[] = []
  if (branch !== null) gitParts.push(`branch ${branch}`)
  if (dirty !== null) gitParts.push(`dirty ${dirty === 'true' ? 'yes' : 'no'}`)

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
      {gitParts.length > 0 ? <span style={gitStyle}>git · {gitParts.join(' · ')}</span> : null}
    </div>
  )
})
