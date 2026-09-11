import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { FILE_EXTS, ROUTE_IDS, FileGlyph, RouteGlyph } from './icons'

describe('desktop icon glyphs', () => {
  it('renders a distinct non-empty svg for every route', () => {
    const htmls = ROUTE_IDS.map((route) => renderToString(createElement(RouteGlyph, { route })))
    ROUTE_IDS.forEach((route, i) => {
      expect(htmls[i]).toContain('<svg')
      expect(htmls[i]).toContain(`data-glyph="${route}"`)
      expect(htmls[i]).toContain('var(--z-')
      expect(htmls[i].length).toBeGreaterThan(60)
    })
    expect(new Set(htmls).size).toBe(ROUTE_IDS.length)
  })

  it('renders a distinct non-empty svg for every file type', () => {
    const htmls = FILE_EXTS.map((ext) => renderToString(createElement(FileGlyph, { ext })))
    FILE_EXTS.forEach((ext, i) => {
      expect(htmls[i]).toContain('<svg')
      expect(htmls[i]).toContain(`data-glyph="file-${ext}"`)
      expect(htmls[i]).toContain('var(--z-')
      expect(htmls[i].length).toBeGreaterThan(60)
    })
    expect(new Set(htmls).size).toBe(FILE_EXTS.length)
  })

  it('covers exactly the canonical desktop items', () => {
    expect(ROUTE_IDS).toEqual([
      'desk',
      'runtime',
      'network',
      'flightRecorder',
      'airlock',
      'zeroBot',
      'skillLab'
    ])
    expect(FILE_EXTS).toEqual(['txt', 'pdf', 'png', 'notes'])
  })

  it('falls back to a generic glyph for unknown ids', () => {
    const fallback = renderToString(createElement(RouteGlyph, { route: 'unknown' }))
    const desk = renderToString(createElement(RouteGlyph, { route: 'desk' }))
    expect(fallback).toContain('<svg')
    expect(fallback).toContain('data-glyph="unknown"')
    expect(fallback).not.toBe(desk)
    const file = renderToString(createElement(FileGlyph, { ext: 'docx' }))
    expect(file).toContain('data-glyph="file-txt"')
  })

  it('sizes through the size prop', () => {
    expect(renderToString(createElement(RouteGlyph, { route: 'desk', size: 16 }))).toContain(
      'width="16" height="16"'
    )
    expect(renderToString(createElement(FileGlyph, { ext: 'txt', size: 52 }))).toContain(
      'width="52" height="52"'
    )
  })
})
