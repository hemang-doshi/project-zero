import { memo, useMemo, useState } from 'react'
import { ZERO_TYPE } from '../../../shared/tokens'
import { useCockpit } from '../store/cockpit'
import { Chip } from './Chip'
import { freshnessChip, nodeTone, parseSnapshot } from './runtime.types'
import { buildSceneGraph } from './topology.model'
import { TopologyScene } from './TopologyScene'

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

const summaryStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: 'var(--z-secondary-ink)',
  lineHeight: 1.5
}

const nodeCard: React.CSSProperties = {
  background: 'var(--z-card-cream)',
  border: '1px solid var(--z-line)',
  borderRadius: 8,
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
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

const capChip: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.06em',
  color: 'var(--z-secondary-ink)',
  border: '1px solid var(--z-line)',
  borderRadius: 4,
  padding: '2px 6px'
}

const capRow: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 5
}

const clockStamp = (iso: string | null): string =>
  iso !== null && iso.length >= 19 ? iso.slice(11, 19) : '—'

const selectedCard: React.CSSProperties = {
  outline: '2px solid var(--z-highlight-blue)',
  outlineOffset: 1,
  cursor: 'pointer'
}

const plainCard: React.CSSProperties = {
  cursor: 'pointer'
}

export const NetworkRoute = memo(function NetworkRoute(): React.JSX.Element {
  const conn = useCockpit((s) => s.state)
  const snapshot = useCockpit((s) => s.snapshot)
  const freshness = useMemo(() => freshnessChip(conn, snapshot), [conn, snapshot])
  const nodes = useMemo(() => parseSnapshot(snapshot)?.nodes ?? [], [snapshot])
  const truncated = useMemo(() => parseSnapshot(snapshot)?.truncated.nodes === true, [snapshot])

  const online = nodes.filter((n) => !n.revoked && n.status === 'ONLINE').length
  const revoked = nodes.filter((n) => n.revoked).length
  const summary = nodes.length
    ? `${nodes.length}${truncated ? '+' : ''} registered · ${online} online · ${revoked} revoked`
    : 'No node registered'

  // Shared selection: clicking a 3D node selects exactly as clicking its list
  // row does. The list below stays the honest source; the scene only presents
  // the same typed snapshot nodes. A selection whose node left the snapshot
  // clears itself instead of pointing at stale data.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const activeSelectedId = nodes.some((n) => n.id === selectedId) ? selectedId : null
  const graph = useMemo(() => buildSceneGraph(nodes, conn), [nodes, conn])
  const select = (id: string): void => setSelectedId(id)

  return (
    <div className="zw-route" style={routeStyle}>
      <div style={headerRow}>
        <span style={microStyle}>PROJECT ZERO — NETWORK</span>
        <Chip label={freshness.label} tone={freshness.tone} />
      </div>
      <span style={summaryStyle}>
        {summary} · daemon-derived lease status · enrollment changes not projected here
      </span>
      <TopologyScene graph={graph} selectedId={activeSelectedId} onSelect={select} />
      {nodes.map((n) => {
        const selected = activeSelectedId === n.id
        return (
          <div
            key={n.id}
            data-testid={`node-row-${n.id}`}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            style={{ ...nodeCard, ...(selected ? selectedCard : plainCard) }}
            onClick={() => select(n.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                select(n.id)
              }
            }}
          >
            <div style={headerRow}>
              <span style={nodeIdStyle}>{n.id}</span>
              <Chip label={n.status} tone={nodeTone(conn, n.status)} />
            </div>
            <span style={nodeDetailStyle}>last seen {clockStamp(n.last_seen)}</span>
            {n.capabilities.length > 0 ? (
              <div style={capRow}>
                {n.capabilities.map((c) => (
                  <span key={c} style={capChip}>
                    {c}
                  </span>
                ))}
              </div>
            ) : (
              <span style={nodeDetailStyle}>no projected capabilities</span>
            )}
          </div>
        )
      })}
      {truncated ? (
        <span style={summaryStyle}>Node list is a lower bound from the bounded snapshot.</span>
      ) : null}
    </div>
  )
})
