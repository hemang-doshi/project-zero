import { describe, it, expect } from 'vitest'
import { ZERO_TOKENS, ZERO_TYPE, toCssVariables } from './tokens'

describe('ZERO_TOKENS', () => {
  it('matches the canonical Stitch hex values from Theme.swift/ZeroControls.swift', () => {
    expect(ZERO_TOKENS).toEqual({
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
    })
  })
  it('emits kebab-case CSS variables', () => {
    const css = toCssVariables()
    expect(css).toContain('--z-brand-orange: #F54E00;')
    expect(css).toContain('--z-window-canvas: #DBE3D3;')
  })
  it('keeps the mono stack as ui-monospace', () => {
    expect(ZERO_TYPE.mono.startsWith('ui-monospace')).toBe(true)
  })
})
