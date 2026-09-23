import { useEffect, useState } from 'react'
import { badgeFor, useCockpit, type Badge } from '../store/cockpit'

const MAX_AGE_MS = 5_000

const TONES: Record<Badge, string> = {
  LIVE: 'var(--z-status-green)',
  STALE: 'var(--z-marker-yellow)',
  CONNECTING: 'var(--z-marker-yellow)',
  RECONNECTING: 'var(--z-marker-yellow)',
  OFFLINE: 'var(--z-error-red)'
}

const pillStyle: React.CSSProperties = {
  position: 'fixed',
  top: 8,
  right: 8,
  zIndex: 30,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '3px 10px',
  borderRadius: 999,
  background: 'var(--z-card-cream)',
  border: '1px solid var(--z-line)',
  fontSize: 11,
  color: 'var(--z-ink)',
  pointerEvents: 'none'
}

export function StatusBadge(): React.JSX.Element {
  const state = useCockpit((s) => s.state)
  const refreshAt = useCockpit((s) => s.refreshAt)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(t)
  }, [])
  const badge = badgeFor(state, now, refreshAt, MAX_AGE_MS)
  return (
    <span style={pillStyle} role="status">
      <span style={{ width: 8, height: 8, borderRadius: 4, background: TONES[badge] }} />
      {badge}
    </span>
  )
}
