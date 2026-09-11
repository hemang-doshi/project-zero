import { memo } from 'react'
import { byteRate } from '../../../shared/format'
import { ZERO_TYPE } from '../../../shared/tokens'
import { useCockpit } from '../store/cockpit'
import { Chip } from './Chip'
import {
  EMPTY_MACHINE_SAMPLE,
  activeProjectLabel,
  mostLoaded,
  selectSession,
  sessionChipTone,
  type MachineSample
} from './runtime.types'

const routeStyle: React.CSSProperties = {
  height: '100%',
  overflowY: 'auto',
  padding: '20px 22px',
  display: 'flex',
  flexDirection: 'column',
  gap: 16
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
  fontSize: 15,
  fontWeight: 700,
  color: 'var(--z-ink)'
}

const tileGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 10
}

const tileBase: React.CSSProperties = {
  background: 'var(--z-card-cream)',
  border: '1px solid var(--z-line)',
  borderRadius: 8,
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  minWidth: 0
}

const tileAccent: React.CSSProperties = {
  ...tileBase,
  boxShadow: 'inset 0 2px 0 0 var(--z-marker-yellow)',
  background: 'color-mix(in srgb, var(--z-marker-yellow) 14%, var(--z-card-cream))'
}

const tileLabel: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.12em',
  color: 'var(--z-secondary-ink)'
}

const tileValue: React.CSSProperties = {
  fontSize: 21,
  fontWeight: 800,
  color: 'var(--z-ink)',
  lineHeight: 1.15,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums'
}

const tileDetail: React.CSSProperties = {
  fontSize: 11.5,
  color: 'var(--z-secondary-ink)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const noticeStyle: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10.5,
  color: 'var(--z-secondary-ink)',
  borderTop: '1px solid var(--z-line)',
  paddingTop: 12,
  lineHeight: 1.6
}

const percent = (v: number, digits: number): string => `${v.toFixed(digits)}%`

function Tile({
  label,
  value,
  detail,
  accent
}: {
  label: string
  value: string
  detail: string
  accent: boolean
}): React.JSX.Element {
  return (
    <div style={accent ? tileAccent : tileBase}>
      <span style={tileLabel}>{label}</span>
      <span style={tileValue}>{value}</span>
      <span style={tileDetail}>{detail}</span>
    </div>
  )
}

export const RuntimeRoute = memo(function RuntimeRoute(): React.JSX.Element {
  const conn = useCockpit((s) => s.state)
  const project = useCockpit((s) => selectSession(s.snapshot)?.project ?? '')
  const sessionState = useCockpit((s) => selectSession(s.snapshot)?.state ?? null)

  const sample: MachineSample = EMPTY_MACHINE_SAMPLE
  const accent = mostLoaded(sample)
  const tiles: { key: string; label: string; value: string; detail: string }[] = [
    {
      key: 'cpu',
      label: 'CPU',
      value: sample.cpu === null ? '—' : percent(sample.cpu, 1),
      detail: sample.cpu === null ? 'Unavailable' : 'processor load'
    },
    {
      key: 'ram',
      label: 'RAM',
      value: sample.ram === null ? '—' : percent(sample.ram, 0),
      detail: sample.ram === null ? 'Unavailable' : 'memory pressure'
    },
    {
      key: 'ssd',
      label: 'SSD R+W',
      value: sample.ssd === null ? '—' : byteRate(sample.ssd),
      detail: sample.ssd === null ? 'Unavailable' : 'disk throughput'
    },
    {
      key: 'gpu',
      label: 'GPU',
      value: sample.gpu === null ? '—' : percent(sample.gpu, 0),
      detail: sample.gpu === null ? 'Unavailable' : 'graphics load'
    }
  ]

  return (
    <div className="zw-route" style={routeStyle}>
      <div style={headerRow}>
        <span style={microStyle}>RUNTIME — MACHINE TELEMETRY</span>
        <Chip label={sessionState ?? 'UNAVAILABLE'} tone={sessionChipTone(conn, sessionState)} />
      </div>
      <span style={projectStyle}>{activeProjectLabel(conn, project)}</span>
      <div style={tileGrid}>
        {tiles.map((t) => (
          <Tile
            key={t.key}
            label={t.label}
            value={t.value}
            detail={t.detail}
            accent={accent === t.key}
          />
        ))}
      </div>
      <span style={noticeStyle}>
        Local-only machine telemetry · host counters not read in this renderer · snapshot projection
        unchanged
      </span>
    </div>
  )
})
