import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

const html = (): string => readFileSync(new URL('../index.html', import.meta.url), 'utf8')

const cspContent = (): string => {
  const match = html().match(/http-equiv="Content-Security-Policy"\s*\n\s*content="([^"]+)"/)
  if (!match) throw new Error('renderer index.html has no CSP meta')
  return match[1]
}

const imgSrcDirectives = (): string[] => {
  const entry = cspContent()
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith('img-src'))
  if (!entry) throw new Error('CSP has no img-src directive')
  return entry.split(/\s+/).slice(1)
}

const rendererImageSchemes = (): string[] => {
  const wallpaperSrc = readFileSync(new URL('./desktop/wallpaper.ts', import.meta.url), 'utf8')
  const schemes = [...wallpaperSrc.matchAll(/\b([a-z][a-z0-9+.-]*):\/\//g)].map((m) => m[1])
  return [...new Set(schemes)]
}

describe('renderer CSP', () => {
  it('img-src permits the zero-img scheme used by the wallpaper protocol', () => {
    expect(imgSrcDirectives()).toContain('zero-img:')
  })

  it('keeps the existing img-src sources', () => {
    const directives = imgSrcDirectives()
    expect(directives).toContain("'self'")
    expect(directives).toContain('data:')
  })

  it('covers every image scheme the renderer wallpaper code loads', () => {
    const schemes = rendererImageSchemes()
    expect(schemes.length).toBeGreaterThan(0)
    for (const scheme of schemes) {
      expect(imgSrcDirectives()).toContain(`${scheme}:`)
    }
  })
})
