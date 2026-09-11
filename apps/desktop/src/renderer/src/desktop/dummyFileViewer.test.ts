import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { DummyFileViewer } from './DummyFileViewer'
import { DUMMY_NOTICE, viewerTitle, type DesktopFile } from './items'

const txt: DesktopFile = {
  id: 'readme',
  name: 'README.txt',
  ext: 'txt',
  content: 'PROJECT ZERO — DESKTOP README (DUMMY)\nFree placement everywhere.'
}
const pdf: DesktopFile = {
  id: 'architecture',
  name: 'architecture.pdf',
  ext: 'pdf',
  content:
    'ARCHITECTURE — PDF MOCK (DUMMY)\n\nzerod owns committed state.\nThe desktop streams the cockpit.'
}
const png: DesktopFile = {
  id: 'screenshot',
  name: 'screenshot.png',
  ext: 'png',
  content: 'Placeholder card — no screenshot pipeline exists yet.'
}
const notes: DesktopFile = {
  id: 'notes',
  name: 'notes',
  ext: 'notes',
  content:
    'Desktop notes (dummy)\nIcons persist per drag.\nWallpaper kinds render from tokens.\nViewer windows are read-only.\nSettings lives in the taskbar strip.'
}

const html = (file: DesktopFile): string => renderToString(createElement(DummyFileViewer, { file }))

describe('DummyFileViewer', () => {
  it('labels every viewer as a read-only dummy', () => {
    for (const f of [txt, pdf, png, notes]) {
      expect(html(f)).toContain(DUMMY_NOTICE)
    }
  })
  it('titles the viewer window after the dummy file', () => {
    expect(viewerTitle(txt)).toBe('README.txt · dummy')
  })
  it('renders txt content verbatim', () => {
    expect(html(txt)).toContain('PROJECT ZERO — DESKTOP README (DUMMY)')
    expect(html(txt)).toContain('Free placement everywhere.')
  })
  it('renders the pdf mock with its mock band and paragraphs', () => {
    const out = html(pdf)
    expect(out).toContain('PDF MOCK')
    expect(out).toContain('zerod owns committed state.')
    expect(out).toContain('The desktop streams the cockpit.')
  })
  it('renders the png as a labeled placeholder card, not an image', () => {
    const out = html(png)
    expect(out).toContain('SCREENSHOT PLACEHOLDER')
    expect(out).toContain('Placeholder card — no screenshot pipeline exists yet.')
    expect(out).not.toContain('<img')
  })
  it('renders notes as a bullet list of its lines', () => {
    const out = html(notes)
    expect(out).toContain('<li')
    expect((out.match(/<li/g) ?? []).length).toBe(5)
    expect(out).toContain('Icons persist per drag.')
  })
})
