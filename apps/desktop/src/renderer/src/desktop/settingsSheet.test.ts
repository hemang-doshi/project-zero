import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { SettingsSheet, type SettingsSheetProps } from './SettingsSheet'
import { WALLPAPER_KIND_LABELS } from './wallpaper'

const base: SettingsSheetProps = {
  wallpaper: { kind: 'dotted-green', mode: 'cover' },
  onKind: () => {},
  onMode: () => {},
  onPick: () => {},
  onClose: () => {}
}

const html = (props: SettingsSheetProps): string =>
  renderToString(createElement(SettingsSheet, props))

describe('SettingsSheet', () => {
  it('offers the three bundled kinds plus custom', () => {
    expect(Object.keys(WALLPAPER_KIND_LABELS).sort()).toEqual(
      ['canvas-tan', 'cream', 'custom', 'dotted-green'].sort()
    )
    const out = html(base)
    for (const label of Object.values(WALLPAPER_KIND_LABELS)) {
      expect(out).toContain(label)
    }
  })
  it('marks the selected wallpaper kind', () => {
    const out = html(base)
    expect(out).toContain('aria-pressed="true"')
    expect((out.match(/aria-pressed="true"/g) ?? []).length).toBe(1)
  })
  it('shows the custom image picker and cover/tile mode only for custom', () => {
    const custom = html({ ...base, wallpaper: { kind: 'custom', path: '/x/a.png', mode: 'tile' } })
    expect(custom).toContain('CHOOSE IMAGE')
    expect(custom).toContain('COVER')
    expect(custom).toContain('TILE')
    expect(custom).toContain('aria-pressed="true"')
    expect((custom.match(/aria-pressed="true"/g) ?? []).length).toBe(2)
    expect(html(base)).not.toContain('CHOOSE IMAGE')
  })
})
