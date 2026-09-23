import { memo, useEffect, useMemo, useState } from 'react'
import { elapsed } from '../../../shared/format'
import { ZERO_TYPE } from '../../../shared/tokens'
import { useCockpit } from '../store/cockpit'
import { Chip } from './Chip'
import {
  connectivity,
  extrapolate,
  parseSnapshot,
  selectSpotify,
  type SpotifyMedia,
  type Tone
} from './runtime.types'

const routeStyle: React.CSSProperties = {
  height: '100%',
  overflowY: 'auto',
  padding: '24px 28px',
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
  maxWidth: 820,
  margin: '0 auto'
}

const smallLabel: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.12em',
  color: 'var(--z-secondary-ink)'
}

const headerRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12
}

const cardStyle: React.CSSProperties = {
  background: 'var(--z-card-cream)',
  border: '1px solid var(--z-line)',
  borderRadius: 10,
  padding: '16px 18px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  minWidth: 0
}

const noteStyle: React.CSSProperties = {
  color: 'var(--z-secondary-ink)',
  fontSize: 12,
  lineHeight: 1.5,
  margin: 0
}

const trackTitle: React.CSSProperties = {
  color: 'var(--z-ink)',
  fontSize: 18,
  fontWeight: 700,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const trackArtist: React.CSSProperties = {
  color: 'var(--z-secondary-ink)',
  fontSize: 13,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const elapsedStyle: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 28,
  fontWeight: 700,
  color: 'var(--z-ink)',
  fontVariantNumeric: 'tabular-nums'
}

const historyRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 12,
  borderTop: '1px solid var(--z-line)',
  padding: '8px 0 0',
  minWidth: 0
}

const coverStyle: React.CSSProperties = {
  width: 80,
  height: 80,
  borderRadius: 8,
  border: '1px solid var(--z-line)',
  objectFit: 'cover',
  flexShrink: 0,
  display: 'block'
}

function parseDataUrl(value: unknown): string | null {
  const url =
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)['dataUrl']
      : null
  return typeof url === 'string' && url.startsWith('data:image/') ? url : null
}

function ArtworkCover({ artworkId }: { artworkId: string | null }): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (artworkId === null || typeof window === 'undefined' || !window.zero) return
    let alive = true
    window.zero
      .invoke('artwork.fetch', { id: artworkId })
      .then((value) => {
        if (alive) setUrl(parseDataUrl(value))
      })
      .catch(() => {
        if (alive) setUrl(null)
      })
    return () => {
      alive = false
    }
  }, [artworkId])

  if (url !== null) return <img src={url} alt="Album artwork" style={coverStyle} />
  return (
    <div
      aria-label="Album artwork unavailable"
      style={{
        ...coverStyle,
        display: 'grid',
        placeItems: 'center',
        background: 'var(--z-canvas-tan)',
        fontFamily: ZERO_TYPE.mono,
        fontSize: 9,
        color: 'var(--z-secondary-ink)',
        textAlign: 'center'
      }}
    >
      NO ARTWORK
    </div>
  )
}

function mediaChip(spotify: SpotifyMedia | null, online: boolean): { label: string; tone: Tone } {
  if (spotify === null) return { label: 'NOT CONNECTED', tone: 'neutral' }
  if (!online) return { label: 'RETAINED', tone: 'neutral' }
  if (spotify.status !== 'ONLINE') return { label: 'UNAVAILABLE', tone: 'neutral' }
  return { label: 'LIVE', tone: 'healthy' }
}

function playChip(spotify: SpotifyMedia | null): { label: string; tone: Tone } {
  const state = (spotify?.state ?? '').toUpperCase()
  if (state === 'PLAYING') return { label: 'PLAYING', tone: 'healthy' }
  if (state === 'PAUSED') return { label: 'PAUSED', tone: 'attention' }
  return { label: state || 'NO PLAY STATE', tone: 'neutral' }
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
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])
  const ms = extrapolate(baseMs, ticking, receivedAt, now)
  return <span style={elapsedStyle}>{ms === null ? '—' : elapsed(ms)}</span>
}

export const DeskRoute = memo(function DeskRoute(): React.JSX.Element {
  const conn = useCockpit((state) => state.state)
  const snapshot = useCockpit((state) => state.snapshot)
  const receivedAt = useCockpit((state) => state.refreshAt)
  const spotify = useMemo(() => selectSpotify(snapshot), [snapshot])
  const listening = useMemo(() => parseSnapshot(snapshot)?.listeningSession ?? null, [snapshot])
  const media = mediaChip(spotify, conn === 'live')
  const play = playChip(spotify)
  const sessionState = listening?.playbackState.toUpperCase() ?? 'NOT OBSERVED'
  const track = spotify?.track || 'No track playing'
  const artist = spotify?.artist || 'Spotify playback details are unavailable.'

  return (
    <main className="zw-route" style={routeStyle} aria-label="Spotify listening session">
      <div style={headerRow}>
        <span style={smallLabel}>SPOTIFY</span>
        <Chip label={media.label} tone={media.tone} />
      </div>

      <section style={cardStyle} aria-label="Now playing">
        {spotify === null ? (
          <>
            <strong style={trackTitle}>Spotify is not connected</strong>
            <p style={noteStyle}>Connect local Spotify observation to show the current track.</p>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
            <ArtworkCover key={spotify.artworkId ?? 'none'} artworkId={spotify.artworkId} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 }}>
              <span style={smallLabel}>NOW PLAYING</span>
              <strong style={trackTitle}>{track}</strong>
              <span style={trackArtist}>{artist}</span>
              <div>
                <Chip label={play.label} tone={play.tone} />
              </div>
            </div>
          </div>
        )}
      </section>

      <section style={cardStyle} aria-label="Listening session">
        <div style={headerRow}>
          <span style={smallLabel}>LISTENING SESSION</span>
          <Chip
            label={sessionState}
            tone={listening?.playbackState === 'playing' ? 'healthy' : 'neutral'}
          />
        </div>
        {listening === null ? (
          <p style={noteStyle}>
            Session history starts when local Spotify observation is connected and playback begins.
          </p>
        ) : (
          <>
            <div style={headerRow}>
              <ElapsedClock
                baseMs={listening.activeDurationMs}
                ticking={
                  conn === 'live' &&
                  listening.playbackState === 'playing' &&
                  listening.endedAt === null
                }
                receivedAt={receivedAt}
              />
              <span style={noteStyle}>active listening time</span>
            </div>
            <p style={noteStyle}>
              {listening.contextType
                ? `Source · ${listening.contextType}`
                : 'Source not reported by Spotify'}
            </p>
            <div aria-label="Observed songs in this session">
              {listening.tracks.slice(-8).map((item, index) => (
                <div key={`${item.observedAt}:${index}`} style={historyRow}>
                  <span style={{ ...trackTitle, fontSize: 13, flex: 1, minWidth: 0 }}>
                    {item.track}
                  </span>
                  <span style={{ ...trackArtist, fontSize: 11 }}>{item.artist}</span>
                </div>
              ))}
            </div>
            <p style={noteStyle}>Only songs observed since this session began appear here.</p>
            <div
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}
            >
              <button
                type="button"
                disabled
                aria-describedby="playlist-unavailable"
                style={{
                  padding: '7px 11px',
                  border: '1px solid var(--z-line)',
                  borderRadius: 6,
                  background: 'var(--z-card-cream)',
                  color: 'var(--z-secondary-ink)',
                  font: `700 10px ${ZERO_TYPE.mono}`,
                  letterSpacing: '0.08em',
                  cursor: 'not-allowed'
                }}
              >
                MAKE PLAYLIST
              </button>
              <p id="playlist-unavailable" style={noteStyle}>
                Spotify account connection is required before tracks can be reviewed or added to a
                playlist.
              </p>
            </div>
          </>
        )}
      </section>
      {conn !== 'live' ? (
        <p style={noteStyle} role="status">
          {connectivity(conn, snapshot).detail}
        </p>
      ) : null}
    </main>
  )
})
