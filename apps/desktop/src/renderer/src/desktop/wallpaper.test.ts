import { describe, it, expect } from 'vitest'
import { wallpaperStyle, wallpaperUrl } from './wallpaper'

describe('wallpaperStyle', () => {
  it('renders dotted-green from the wallpaper tokens', () => {
    expect(wallpaperStyle({ kind: 'dotted-green', mode: 'cover' })).toEqual({
      background: 'var(--z-wallpaper)',
      backgroundImage: 'radial-gradient(var(--z-wallpaper-dot) 1.5px, transparent 1.5px)',
      backgroundSize: '24px 24px'
    })
  })
  it('renders cream and canvas-tan as flat token fills', () => {
    expect(wallpaperStyle({ kind: 'cream', mode: 'cover' })).toEqual({
      background: 'var(--z-card-cream)'
    })
    expect(wallpaperStyle({ kind: 'canvas-tan', mode: 'cover' })).toEqual({
      background: 'var(--z-canvas-tan)'
    })
  })
  it('maps a picked custom image through the zero-img protocol', () => {
    expect(wallpaperUrl('/Users/h/img.png')).toBe('zero-img://local/%2FUsers%2Fh%2Fimg.png')
    const cover = wallpaperStyle({ kind: 'custom', path: '/x/a.png', mode: 'cover' })
    expect(cover.backgroundImage).toContain('zero-img://local/%2Fx%2Fa.png')
    expect(cover.backgroundSize).toBe('cover')
    expect(cover.backgroundRepeat).toBe('no-repeat')
    const tile = wallpaperStyle({ kind: 'custom', path: '/x/a.png', mode: 'tile' })
    expect(tile.backgroundSize).toBe('256px 256px')
    expect(tile.backgroundRepeat).toBe('repeat')
  })
  it('falls back to the dotted-green texture when custom has no path', () => {
    expect(wallpaperStyle({ kind: 'custom', mode: 'cover' })).toEqual(
      wallpaperStyle({ kind: 'dotted-green', mode: 'cover' })
    )
  })
})
