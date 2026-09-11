export type WallpaperKind = 'dotted-green' | 'cream' | 'canvas-tan' | 'custom'
export type WallpaperMode = 'cover' | 'tile'
export type WallpaperState = { kind: WallpaperKind; path?: string; mode: WallpaperMode }

export const WALLPAPER_KIND_LABELS: Record<WallpaperKind, string> = {
  'dotted-green': 'Dotted Green',
  cream: 'Cream',
  'canvas-tan': 'Canvas Tan',
  custom: 'Custom'
}

export const wallpaperUrl = (path: string): string => `zero-img://local/${encodeURIComponent(path)}`

const dottedGreenStyle: React.CSSProperties = {
  background: 'var(--z-wallpaper)',
  backgroundImage: 'radial-gradient(var(--z-wallpaper-dot) 1.5px, transparent 1.5px)',
  backgroundSize: '24px 24px'
}

export function wallpaperStyle(state: WallpaperState): React.CSSProperties {
  switch (state.kind) {
    case 'cream':
      return { background: 'var(--z-card-cream)' }
    case 'canvas-tan':
      return { background: 'var(--z-canvas-tan)' }
    case 'custom':
      if (!state.path) return dottedGreenStyle
      return {
        backgroundImage: `url(${wallpaperUrl(state.path)})`,
        backgroundSize: state.mode === 'cover' ? 'cover' : '256px 256px',
        backgroundRepeat: state.mode === 'tile' ? 'repeat' : 'no-repeat',
        backgroundPosition: 'center'
      }
    case 'dotted-green':
      return dottedGreenStyle
  }
}
