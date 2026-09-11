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

  it('gives every app a distinct metaphor with its own signature shape', () => {
    const html = Object.fromEntries(
      ROUTE_IDS.map((route) => [route, renderToString(createElement(RouteGlyph, { route }))])
    ) as Record<string, string>
    // Desk terminal surface, orbit ellipse, record dot, attention shield fill,
    // node ground bar — each signature appears in exactly one app.
    const unique: Record<string, string> = {
      desk: 'M2.5 19.5h19',
      zeroBot: '<ellipse',
      flightRecorder: 'var(--z-error-red)',
      airlock: 'var(--z-marker-yellow)',
      network: 'var(--z-nav-cream)'
    }
    for (const [route, sig] of Object.entries(unique)) {
      expect(html[route]).toContain(sig)
      for (const other of ROUTE_IDS) {
        if (other !== route) expect(html[other]).not.toContain(sig)
      }
    }
    // Gauge zone and flask liquid share the healthy token but differ
    // structurally (arc path vs filled blob + chip rect).
    expect(html.runtime).toContain('var(--z-status-green)')
    expect(html.skillLab).toContain('var(--z-status-green)')
    expect(html.skillLab).toContain('<rect')
  })

  it('shares one coherent top-left light across every app glyph', () => {
    for (const route of ROUTE_IDS) {
      expect(renderToString(createElement(RouteGlyph, { route }))).toContain('var(--z-card-white)')
    }
  })

  it('reads at desktop and taskbar sizes', () => {
    for (const route of ROUTE_IDS) {
      expect(renderToString(createElement(RouteGlyph, { route, size: 16 }))).toContain(
        'width="16" height="16"'
      )
      expect(renderToString(createElement(RouteGlyph, { route, size: 52 }))).toContain(
        'width="52" height="52"'
      )
    }
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

  it('renders file types as documents with folded corners and token badges', () => {
    const html = Object.fromEntries(
      FILE_EXTS.map((ext) => [ext, renderToString(createElement(FileGlyph, { ext }))])
    ) as Record<string, string>
    for (const ext of FILE_EXTS) {
      // Every file is a folded-corner document object.
      expect(html[ext]).toContain('M14.4 3.5')
    }
    // One badge token per type, each used sparingly on its own type.
    expect(html.pdf).toContain('var(--z-error-red)')
    expect(html.png).toContain('var(--z-highlight-blue)')
    expect(html.notes).toContain('var(--z-marker-yellow)')
    expect(html.txt).toContain('var(--z-secondary-ink)')
    expect(html.png).not.toContain('var(--z-error-red)')
    expect(html.txt).not.toContain('var(--z-error-red)')
    expect(html.pdf).not.toContain('var(--z-highlight-blue)')
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
