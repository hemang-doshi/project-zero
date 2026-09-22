import { ZERO_TYPE } from '../../../shared/tokens'
import { TONE_COLOR, type Tone } from './runtime.types'

const pillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  padding: '3px 10px',
  borderRadius: 999,
  border: '1px solid var(--z-line)',
  background: 'var(--z-card-cream)',
  fontFamily: ZERO_TYPE.mono,
  fontSize: 11,
  letterSpacing: '0.05em',
  color: 'var(--z-ink)',
  whiteSpace: 'nowrap'
}

export function Chip({ label, tone }: { label: string; tone: Tone }): React.JSX.Element {
  return (
    <span style={pillStyle}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          flexShrink: 0,
          background: TONE_COLOR[tone]
        }}
      />
      {label}
    </span>
  )
}
