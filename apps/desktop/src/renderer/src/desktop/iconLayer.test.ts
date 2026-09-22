import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { IconLayer, type IconLayerProps } from './IconLayer'
import {
  DESKTOP_ITEMS,
  GRID_ORIGIN,
  GRID_STEP_X,
  GRID_STEP_Y,
  ICON_H,
  ICON_W,
  SEED_BOTTOM_RESERVE,
  SEED_VIEWPORT,
  iconGridPos,
  migrateIconsToGrid,
  snapIconToGrid,
  type DesktopIcon
} from './items'

const icons: DesktopIcon[] = [
  { id: 'i-desk', label: 'Desk', kind: 'route', route: 'desk' },
  { id: 'i-readme', label: 'README.txt', kind: 'file', file: 'readme' }
]

const props = (openRoutes: string[]): IconLayerProps => ({
  icons,
  positions: {},
  openRoutes,
  onOpen: () => {},
  onCommitPos: () => {}
})

describe('icon geometry', () => {
  it('seeds a two-column grid with the tighter step', () => {
    expect(iconGridPos(0)).toEqual({ x: 24, y: 28 })
    expect(iconGridPos(3)).toEqual({ x: 24, y: 316 })
    expect(iconGridPos(6)).toEqual({ x: 112, y: 28 })
    expect(iconGridPos(10)).toEqual({ x: 112, y: 412 })
  })
  it('seeds every desktop item inside the default viewport', () => {
    expect(DESKTOP_ITEMS.icons).toHaveLength(11)
    DESKTOP_ITEMS.icons.forEach((_icon, index) => {
      const p = iconGridPos(index)
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x + ICON_W).toBeLessThanOrEqual(SEED_VIEWPORT.width)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y + ICON_H).toBeLessThanOrEqual(SEED_VIEWPORT.height - SEED_BOTTOM_RESERVE)
    })
  })
  it('reuses the seed geometry as the snap grid (no second grid)', () => {
    expect(GRID_ORIGIN).toEqual({ x: 24, y: 28 })
    expect(GRID_STEP_X).toBe(ICON_W + 20)
    expect(GRID_STEP_Y).toBe(96)
  })
  it('rounds free positions to the nearest slot', () => {
    expect(snapIconToGrid({ x: 24, y: 28 })).toEqual({ x: 24, y: 28 })
    expect(snapIconToGrid({ x: 200, y: 90 })).toEqual({ x: 200, y: 124 })
    expect(snapIconToGrid({ x: 0, y: 0 })).toEqual({ x: 24, y: 28 })
    expect(snapIconToGrid({ x: 150, y: 200 })).toEqual({ x: 112, y: 220 })
  })
  it('leaves every seed slot fixed under snapping', () => {
    for (let i = 0; i < DESKTOP_ITEMS.icons.length; i++) {
      expect(snapIconToGrid(iconGridPos(i))).toEqual(iconGridPos(i))
    }
  })
  it('migrates a free-placed icon map to slots one way', () => {
    expect(migrateIconsToGrid({ a: { x: 200, y: 90 }, b: { x: 24, y: 28 } })).toEqual({
      a: { x: 200, y: 124 },
      b: { x: 24, y: 28 }
    })
  })
})

describe('IconLayer render', () => {
  it('renders every icon label', () => {
    const html = renderToString(createElement(IconLayer, props([])))
    expect(html).toContain('Desk')
    expect(html).toContain('README.txt')
  })
  it('draws the app glyph on a layered tile — not a letter square', () => {
    const html = renderToString(createElement(IconLayer, props([])))
    expect((html.match(/data-glyph=/g) ?? []).length).toBe(icons.length)
    expect(html).toContain(
      'linear-gradient(180deg, var(--z-card-cream) 0%, var(--z-canvas-tan) 100%)'
    )
    expect(html).toContain('inset 0 1px 0 var(--z-card-white)')
    expect(html).toContain('inset 0 -6px 10px rgba(25, 28, 32, 0.05)')
    expect(html).not.toContain('rgba(25,28,32,.05)')
    expect(html).toContain('0 3px 9px rgba(0,0,0,.14)')
    expect(html).not.toContain('>DE<')
    // The TXT badge text is the document type badge, not a letter square.
    expect(html).toContain('>TXT</text>')
  })
  it('renders files as folded-corner documents, never square tiles', () => {
    const html = renderToString(createElement(IconLayer, props([])))
    // Exactly one sculpted tile (the route); the file face carries no tile.
    expect((html.match(/linear-gradient\(180deg, var\(--z-card-cream\)/g) ?? []).length).toBe(1)
    // The document fold is drawn for the file icon.
    expect(html).toContain('M14.4 3.5')
    expect(html).toContain('data-kind="route"')
    expect(html).toContain('data-kind="file"')
  })
  it('keeps labels readable over wallpaper with a token shadow', () => {
    const html = renderToString(createElement(IconLayer, props([])))
    expect(html).toContain('var(--z-card-cream)')
    expect(html).toMatch(/text-shadow:[^;]*var\(--z-card-cream\)/)
  })
  it('marks route icons of open routes with the running indicator', () => {
    const open = renderToString(createElement(IconLayer, props(['desk'])))
    expect(open).toContain('data-running="true"')
    const closed = renderToString(createElement(IconLayer, props([])))
    expect(closed).not.toContain('data-running')
  })
  it('honors a persisted slot over the grid seed', () => {
    const html = renderToString(
      createElement(IconLayer, { ...props([]), positions: { 'i-desk': { x: 200, y: 124 } } })
    )
    expect(html).toContain('left:200px')
    expect(html).toContain('top:124px')
  })
})
