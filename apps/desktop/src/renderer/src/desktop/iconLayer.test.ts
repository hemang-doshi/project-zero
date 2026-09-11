import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { IconLayer, type IconLayerProps } from './IconLayer'
import {
  DESKTOP_ITEMS,
  ICON_H,
  ICON_W,
  SEED_BOTTOM_RESERVE,
  SEED_VIEWPORT,
  iconGridPos,
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
})

describe('IconLayer render', () => {
  it('renders every icon label', () => {
    const html = renderToString(createElement(IconLayer, props([])))
    expect(html).toContain('Desk')
    expect(html).toContain('README.txt')
  })
  it('draws real svg glyphs on layered tiles — not letter squares', () => {
    const html = renderToString(createElement(IconLayer, props([])))
    expect((html.match(/data-glyph=/g) ?? []).length).toBe(icons.length)
    expect(html).toContain(
      'linear-gradient(180deg, var(--z-card-cream) 0%, var(--z-canvas-tan) 100%)'
    )
    expect(html).toContain('inset 0 1px 0 var(--z-card-white)')
    expect(html).toContain('0 3px 9px rgba(0,0,0,.14)')
    expect(html).not.toContain('>DE<')
    expect(html).not.toContain('>TXT<')
  })
  it('marks route icons of open routes with the running indicator', () => {
    const open = renderToString(createElement(IconLayer, props(['desk'])))
    expect(open).toContain('data-running="true"')
    const closed = renderToString(createElement(IconLayer, props([])))
    expect(closed).not.toContain('data-running')
  })
  it('honors a persisted position over the grid slot', () => {
    const html = renderToString(
      createElement(IconLayer, { ...props([]), positions: { 'i-desk': { x: 200, y: 90 } } })
    )
    expect(html).toContain('left:200px')
    expect(html).toContain('top:90px')
  })
})
