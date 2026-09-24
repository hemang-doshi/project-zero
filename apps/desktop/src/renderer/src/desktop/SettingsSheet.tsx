import { ZERO_TYPE } from '../../../shared/tokens'
import {
  WALLPAPER_KIND_LABELS,
  type WallpaperKind,
  type WallpaperMode,
  type WallpaperState
} from './wallpaper'

export type SettingsSheetProps = {
  theme: 'light' | 'dark'
  onTheme: (theme: 'light' | 'dark') => void
  wallpaper: WallpaperState
  onKind: (kind: WallpaperKind) => void
  onMode: (mode: WallpaperMode) => void
  onPick: () => void
  onClose: () => void
}

const sheetStyle: React.CSSProperties = {
  position: 'absolute',
  right: 12,
  bottom: 44,
  zIndex: 30,
  width: 240,
  background: 'var(--z-card-cream)',
  border: '1px solid var(--z-line)',
  borderRadius: 12,
  padding: '14px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  boxShadow: '0 12px 32px rgba(0,0,0,.18)'
}

const microStyle: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.14em',
  color: 'var(--z-secondary-ink)'
}

const optionStyle = (selected: boolean): React.CSSProperties => ({
  display: 'block',
  width: '100%',
  textAlign: 'left',
  border: '1px solid var(--z-line)',
  borderRadius: 8,
  background: selected ? 'var(--z-canvas-tan)' : 'transparent',
  color: 'var(--z-ink)',
  fontSize: 12.5,
  padding: '6px 10px',
  cursor: 'pointer'
})

const modeRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6
}

const modeStyle = (selected: boolean): React.CSSProperties => ({
  flex: 1,
  border: '1px solid var(--z-line)',
  borderRadius: 8,
  background: selected ? 'var(--z-canvas-tan)' : 'transparent',
  color: 'var(--z-ink)',
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '0.1em',
  padding: '5px 0',
  cursor: 'pointer'
})

const pickStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  border: '1px solid var(--z-line)',
  borderRadius: 8,
  background: 'transparent',
  color: 'var(--z-ink)',
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '0.1em',
  padding: '6px 10px',
  cursor: 'pointer'
}

const closeStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--z-secondary-ink)',
  fontSize: 16,
  lineHeight: 1,
  cursor: 'pointer',
  padding: '0 2px'
}

export function SettingsSheet({
  theme,
  onTheme,
  wallpaper,
  onKind,
  onMode,
  onPick,
  onClose
}: SettingsSheetProps): React.JSX.Element {
  return (
    <div id="settings" style={sheetStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={microStyle}>SETTINGS</span>
        <button type="button" aria-label="Close settings" style={closeStyle} onClick={onClose}>
          ×
        </button>
      </div>
      <span style={microStyle}>APPEARANCE</span>
      <div style={modeRowStyle}>
        {(['light', 'dark'] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={theme === option}
            style={modeStyle(theme === option)}
            onClick={() => onTheme(option)}
          >
            {option.toUpperCase()}
          </button>
        ))}
      </div>
      <span style={microStyle}>WALLPAPER</span>
      {(Object.keys(WALLPAPER_KIND_LABELS) as WallpaperKind[]).map((kind) => (
        <button
          key={kind}
          type="button"
          aria-pressed={kind === wallpaper.kind}
          style={optionStyle(kind === wallpaper.kind)}
          onClick={() => onKind(kind)}
        >
          {WALLPAPER_KIND_LABELS[kind]}
        </button>
      ))}
      {wallpaper.kind === 'custom' ? (
        <>
          <button type="button" style={pickStyle} onClick={onPick}>
            CHOOSE IMAGE…
          </button>
          <div style={modeRowStyle}>
            {(['cover', 'tile'] as WallpaperMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={mode === wallpaper.mode}
                style={modeStyle(mode === wallpaper.mode)}
                onClick={() => onMode(mode)}
              >
                {mode.toUpperCase()}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
