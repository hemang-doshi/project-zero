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

// App glyphs pass 2: one distinct metaphor per route sharing the tile frame
// from IconLayer. Warm filled materials + a top-left card-white glint keep one
// coherent light direction; every color resolves to a --z-* design token.
// Shapes stay bold so each metaphor reads at 52px on the desktop and at 16px
// in the taskbar.
export function RouteGlyph({
  route,
  size = 24
}: {
  route: string
  size?: number
}): React.JSX.Element {
  switch (route) {
    case 'desk':
      // Desk terminal: glowing terminal screen on a stand, sitting on a full
      // desk surface line. The only glyph with the surface line.
      return (
        <Glyph glyph="desk" size={size}>
          <rect
            x="3.5"
            y="3.5"
            width="17"
            height="11"
            rx="1.5"
            fill="var(--z-card-white)"
            stroke={stroke}
            strokeWidth="1.8"
          />
          <circle cx="6.6" cy="7.6" r="1.1" fill="var(--z-brand-orange)" />
          <path d="M8.8 7.6h6.4" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" />
          <path d="M6.2 11h8.6" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" />
          <path d="M12 14.5v2.2" stroke={stroke} strokeWidth="1.8" />
          <path d="M2.5 19.5h19" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
        </Glyph>
      )
    case 'runtime':
      // Instrument gauge: dial arc with a healthy-zone segment, needle and
      // hub. The only glyph with the status-green zone arc.
      return (
        <Glyph glyph="runtime" size={size}>
          <path
            d="M4.5 17a7.5 7.5 0 1 1 15 0"
            stroke={stroke}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M17.3 11.7a7.5 7.5 0 0 1 1.75 2.7"
            stroke="var(--z-status-green)"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <path
            d="M12 17l4.2-4.2"
            stroke="var(--z-brand-orange)"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <circle cx="12" cy="17" r="1.5" fill={stroke} />
          <circle cx="11.5" cy="16.5" r="0.45" fill="var(--z-card-white)" />
        </Glyph>
      )
    case 'network':
      // Connection nodes: hub orb with satellite nodes over a warm ground
      // bar. The only glyph with the canvas-tan ground bar.
      return (
        <Glyph glyph="network" size={size}>
          <rect x="5" y="18.5" width="14" height="2.4" rx="1.2" fill="var(--z-nav-cream)" />
          <path d="M12 7 6.5 17.2M12 7l5.5 10.2M6.5 17.2h11" stroke={stroke} strokeWidth="1.6" />
          <circle cx="12" cy="7" r="2.5" fill="var(--z-brand-orange)" />
          <circle cx="11.2" cy="6.2" r="0.8" fill="var(--z-card-white)" />
          <circle cx="6.5" cy="17.2" r="2.2" fill={stroke} />
          <circle cx="17.5" cy="17.2" r="2.2" fill={stroke} />
        </Glyph>
      )
    case 'flightRecorder':
      // Log device: rounded instrument body with twin reels, tape path, log
      // rules and a record dot. The only glyph with the error-red dot.
      return (
        <Glyph glyph="flightRecorder" size={size}>
          <rect
            x="4"
            y="5.5"
            width="16"
            height="13.5"
            rx="2.5"
            fill="var(--z-card-white)"
            stroke={stroke}
            strokeWidth="1.8"
          />
          <circle cx="8.5" cy="10" r="2" stroke={stroke} strokeWidth="1.5" />
          <circle cx="8.5" cy="10" r="0.7" fill={stroke} />
          <circle cx="15.5" cy="10" r="2" stroke={stroke} strokeWidth="1.5" />
          <circle cx="15.5" cy="10" r="0.7" fill={stroke} />
          <path d="M10.5 10h3" stroke={stroke} strokeWidth="1.4" />
          <path d="M6.5 14.8h5M6.5 17h8" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="17.2" cy="7.8" r="1.3" fill="var(--z-error-red)" />
          <circle cx="16.8" cy="7.4" r="0.4" fill="var(--z-card-white)" />
        </Glyph>
      )
    case 'airlock':
      // Shield gate: warm attention-tinted shield with a portcullis and a
      // keystone. The only glyph with the marker-yellow shield fill.
      return (
        <Glyph glyph="airlock" size={size}>
          <path
            d="M12 3.6 18.8 6.2v5.6c0 4.6-2.8 7.6-6.8 9-4-1.4-6.8-4.4-6.8-9V6.2z"
            fill="var(--z-marker-yellow)"
            stroke={stroke}
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M6.4 6.6 12 4.4"
            stroke="var(--z-card-white)"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <path
            d="M10 9.2v5.6M12 9.2v5.6M14 9.2v5.6M8.6 11.4h6.8"
            stroke={stroke}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path d="M12 16.6l1.3 1.3-1.3 1.3-1.3-1.3z" fill="var(--z-brand-orange)" />
        </Glyph>
      )
    case 'zeroBot':
      // Core orb: warm sphere with a glowing core and an orbit ring. The only
      // glyph with the orbit ellipse.
      return (
        <Glyph glyph="zeroBot" size={size}>
          <ellipse cx="12" cy="13" rx="10" ry="4.2" stroke={stroke} strokeWidth="1.4" />
          <circle
            cx="12"
            cy="13"
            r="6.5"
            fill="var(--z-canvas-tan)"
            stroke={stroke}
            strokeWidth="1.8"
          />
          <circle cx="12" cy="13" r="2.6" fill="var(--z-brand-orange)" />
          <circle cx="10.2" cy="11.2" r="1" fill="var(--z-card-white)" />
          <circle cx="20.2" cy="9.4" r="1.2" fill={stroke} />
        </Glyph>
      )
    case 'skillLab':
      // Flask + module: lab flask with liquid and a bolted-on chip module.
      // The only glyph with the chip rect.
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
          <circle cx="10.4" cy="17.2" r="0.9" fill="var(--z-card-white)" />
          <rect x="15" y="15.5" width="5.5" height="5" rx="1" fill={stroke} />
          <circle cx="17.75" cy="18" r="1" fill="var(--z-brand-orange)" />
          <path
            d="M16.4 20.5v1.5M19.1 20.5v1.5"
            stroke={stroke}
            strokeWidth="1.4"
            strokeLinecap="round"
          />
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
      // PDF badge in errorRed, used sparingly on the badge only.
      return (
        <Paper glyph={`file-${ext}`} size={size}>
          <rect x="7.3" y="10.6" width="9.4" height="4.2" rx="1" fill="var(--z-error-red)" />
          <text
            x="12"
            y="13.85"
            textAnchor="middle"
            fontSize="3.2"
            fontWeight="800"
            fill="var(--z-card-white)"
          >
            PDF
          </text>
          <path d="M7.3 17h9.4" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
        </Paper>
      )
    case 'png':
      // Image thumbnail: landscape hint framed in highlightBlue.
      return (
        <Paper glyph={`file-${ext}`} size={size}>
          <rect
            x="7"
            y="10.5"
            width="10"
            height="7.6"
            rx="1"
            stroke="var(--z-highlight-blue)"
            strokeWidth="1.4"
          />
          <path d="M8 16.7l2.7-3.2 1.9 2.3 1.3-1.5 2.1 2.4z" fill={stroke} />
          <circle cx="14.9" cy="12.4" r="1.1" fill="var(--z-highlight-blue)" />
        </Paper>
      )
    case 'notes':
      // Notes carry a markerYellow spine tab; body rules stay ink.
      return (
        <Paper glyph={`file-${ext}`} size={size}>
          <rect x="5.2" y="9" width="2.2" height="9" rx="1" fill="var(--z-marker-yellow)" />
          <path
            d="M8.6 10.5h8M8.6 13h8M8.6 15.5h8M8.6 18h4.5"
            stroke={stroke}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </Paper>
      )
    case 'txt':
    default:
      // Plain text: rules plus a TXT badge in secondaryInk.
      return (
        <Paper glyph={`file-${kind}`} size={size}>
          <path
            d="M7.3 10.3h9.4M7.3 12.8h9.4"
            stroke="var(--z-secondary-ink)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <rect x="7.3" y="15" width="6.4" height="3.6" rx="1" fill="var(--z-secondary-ink)" />
          <text
            x="10.5"
            y="17.75"
            textAnchor="middle"
            fontSize="2.6"
            fontWeight="800"
            fill="var(--z-card-white)"
          >
            TXT
          </text>
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
