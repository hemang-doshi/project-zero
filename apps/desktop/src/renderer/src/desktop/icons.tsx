import { fileById } from './items'

// Inline SVG desktop icon glyphs (no external assets). Depth comes from the
// tile frame in IconLayer (layered gradient + inner highlight/shadow + drop
// shadow); these components draw the glyph itself. Every color resolves to a
// --z-* design token.

const stroke = 'var(--z-ink)'

type SvgProps = {
  glyph: string
  size: number
  children: React.ReactNode
}

const Glyph = ({ glyph, size, children }: SvgProps): React.JSX.Element => (
  <svg
    data-glyph={glyph}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    {children}
  </svg>
)

export function RouteGlyph({
  route,
  size = 24
}: {
  route: string
  size?: number
}): React.JSX.Element {
  switch (route) {
    case 'desk':
      return (
        <Glyph glyph="desk" size={size}>
          <rect x="4.5" y="4.5" width="15" height="10" rx="1.5" stroke={stroke} strokeWidth="1.8" />
          <circle cx="12" cy="9.5" r="1.4" fill="var(--z-brand-orange)" />
          <path d="M3 18.75 4.6 16h14.8l1.6 2.75z" fill={stroke} />
        </Glyph>
      )
    case 'runtime':
      return (
        <Glyph glyph="runtime" size={size}>
          <path
            d="M4.5 17a7.5 7.5 0 1 1 15 0"
            stroke={stroke}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M12 17l4.2-4.2"
            stroke="var(--z-brand-orange)"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <circle cx="12" cy="17" r="1.5" fill={stroke} />
        </Glyph>
      )
    case 'network':
      return (
        <Glyph glyph="network" size={size}>
          <path d="M12 7 6.5 17.2M12 7l5.5 10.2M6.5 17.2h11" stroke={stroke} strokeWidth="1.6" />
          <circle cx="12" cy="7" r="2.5" fill="var(--z-brand-orange)" />
          <circle cx="6.5" cy="17.2" r="2.2" fill={stroke} />
          <circle cx="17.5" cy="17.2" r="2.2" fill={stroke} />
        </Glyph>
      )
    case 'flightRecorder':
      return (
        <Glyph glyph="flightRecorder" size={size}>
          <path d="M3.5 17.5h17" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
          <path
            d="M7 17.5v-4.5M12 17.5v-8.5M17 17.5v-3"
            stroke={stroke}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <circle cx="12" cy="7" r="1.6" fill="var(--z-brand-orange)" />
        </Glyph>
      )
    case 'airlock':
      return (
        <Glyph glyph="airlock" size={size}>
          <path
            d="M12 3.6 18.8 6.2v5.6c0 4.6-2.8 7.6-6.8 9-4-1.4-6.8-4.4-6.8-9V6.2z"
            stroke={stroke}
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="10.6" r="1.7" fill="var(--z-brand-orange)" />
          <path
            d="M12 12.4v3.2"
            stroke="var(--z-brand-orange)"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </Glyph>
      )
    case 'zeroBot':
      return (
        <Glyph glyph="zeroBot" size={size}>
          <rect x="5.5" y="8.5" width="13" height="9.5" rx="2.8" fill={stroke} />
          <circle cx="9.3" cy="13.2" r="1.25" fill="var(--z-card-cream)" />
          <circle cx="14.7" cy="13.2" r="1.25" fill="var(--z-card-cream)" />
          <path d="M12 8.5V5.6" stroke={stroke} strokeWidth="1.8" />
          <circle cx="12" cy="4.6" r="1.5" fill="var(--z-brand-orange)" />
          <path
            d="M3.6 13h1.9M18.5 13h1.9"
            stroke={stroke}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </Glyph>
      )
    case 'skillLab':
      return (
        <Glyph glyph="skillLab" size={size}>
          <path
            d="M9.8 4.2h4.4M10.6 4.2v5L5.9 16.6a3 3 0 0 0 2.7 4.4h6.8a3 3 0 0 0 2.7-4.4l-4.7-7.4v-5"
            stroke={stroke}
            strokeWidth="1.8"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path
            d="M7.6 14.6h8.8l1.1 2a2.1 2.1 0 0 1-1.9 3.2H8.4a2.1 2.1 0 0 1-1.9-3.2z"
            fill="var(--z-status-green)"
          />
          <circle cx="12" cy="12.6" r="0.9" fill="var(--z-status-green)" />
        </Glyph>
      )
    default:
      return (
        <Glyph glyph={route} size={size}>
          <circle cx="12" cy="12" r="7.5" stroke={stroke} strokeWidth="1.8" />
          <circle cx="12" cy="12" r="2.5" fill="var(--z-brand-orange)" />
        </Glyph>
      )
  }
}

const Paper = ({
  glyph,
  size,
  children
}: {
  glyph: string
  size: number
  children: React.ReactNode
}): React.JSX.Element => (
  <Glyph glyph={glyph} size={size}>
    <path
      d="M6 3.5h8.4L19 8.1V19a2.4 2.4 0 0 1-2.4 2.4H6A2.4 2.4 0 0 1 3.6 19V5.9A2.4 2.4 0 0 1 6 3.5z"
      fill="var(--z-card-white)"
      stroke="var(--z-line)"
      strokeWidth="1.2"
    />
    <path
      d="M14.4 3.5 19 8.1h-3.1a1.5 1.5 0 0 1-1.5-1.5z"
      fill="var(--z-canvas-tan)"
      stroke="var(--z-line)"
      strokeWidth="1"
    />
    {children}
  </Glyph>
)

export function FileGlyph({ ext, size = 24 }: { ext: string; size?: number }): React.JSX.Element {
  const kind = (FILE_EXTS as readonly string[]).includes(ext) ? ext : 'txt'
  switch (kind) {
    case 'pdf':
      return (
        <Paper glyph={`file-${ext}`} size={size}>
          <rect x="7.3" y="11" width="9.4" height="4" rx="1" fill="var(--z-brand-orange)" />
          <text
            x="12"
            y="14.25"
            textAnchor="middle"
            fontSize="3.2"
            fontWeight="800"
            fill="var(--z-card-white)"
          >
            PDF
          </text>
          <path d="M7.3 17.8h6" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
        </Paper>
      )
    case 'png':
      return (
        <Paper glyph={`file-${ext}`} size={size}>
          <rect
            x="7.3"
            y="10.5"
            width="9.4"
            height="7.5"
            rx="1"
            stroke={stroke}
            strokeWidth="1.3"
          />
          <path d="M8.2 16.6l2.6-3.1 1.9 2.2 1.2-1.4 2 2.3z" fill={stroke} />
          <circle cx="14.9" cy="12.4" r="1.1" fill="var(--z-brand-orange)" />
        </Paper>
      )
    case 'notes':
      return (
        <Paper glyph={`file-${ext}`} size={size}>
          <path
            d="M7.3 9.2h9.4"
            stroke="var(--z-brand-orange)"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M7.3 12.2h9.4M7.3 15.2h9.4M7.3 18.2h4.8"
            stroke={stroke}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </Paper>
      )
    case 'txt':
    default:
      return (
        <Paper glyph={`file-${kind}`} size={size}>
          <path
            d="M7.3 11.5h9.4M7.3 14.5h9.4M7.3 17.5h5.5"
            stroke={stroke}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </Paper>
      )
  }
}

export function DesktopGlyph({
  route,
  file,
  size = 24
}: {
  route?: string
  file?: string
  size?: number
}): React.JSX.Element {
  if (file) {
    const f = fileById(file)
    return <FileGlyph ext={f?.ext ?? 'txt'} size={size} />
  }
  return <RouteGlyph route={route ?? ''} size={size} />
}

export const ROUTE_IDS = [
  'desk',
  'runtime',
  'network',
  'flightRecorder',
  'airlock',
  'zeroBot',
  'skillLab'
] as const

export const FILE_EXTS = ['txt', 'pdf', 'png', 'notes'] as const
