export const ZERO_TOKENS: Record<string, string> = {
  brandOrange: '#F54E00',
  primaryAuthority: '#A83300',
  cardCream: '#FAF8F5',
  navCream: '#F3ECDF',
  navBorder: '#DED7CA',
  canvasTan: '#E9E3D7',
  windowCanvas: '#DBE3D3',
  hoverOrange: '#E04700',
  markerYellow: '#F7DF94',
  statusGreen: '#10B981',
  highlightBlue: '#3B82F6',
  errorRed: '#DC2626',
  wallpaper: '#8C9E82',
  wallpaperDot: '#7A8C70',
  ink: '#191C20',
  secondaryInk: '#5C4038',
  line: '#DED7CA',
  orange: '#F54E00',
  orangePressed: '#A83300'
}

export const ZERO_TYPE = {
  body: 'Inter, system-ui, -apple-system, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace'
} as const

const kebab = (k: string): string => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)

export function toCssVariables(): string {
  return Object.entries(ZERO_TOKENS)
    .map(([k, v]) => `--z-${kebab(k)}: ${v};`)
    .join('\n')
}
