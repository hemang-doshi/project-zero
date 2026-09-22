// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { SkillLabRoute } from './SkillLabRoute'

let root: Root | null = null
let host: HTMLElement | null = null

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  delete (window as unknown as { zero?: unknown }).zero
  vi.restoreAllMocks()
  root = null
  host = null
})

it('reveals selected skill details when the lab is narrow', async () => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 520 })
  const reveal = vi.fn()
  HTMLElement.prototype.scrollIntoView = reveal
  ;(window as unknown as { zero: unknown }).zero = {
    invoke: vi.fn(async () => ({
      groups: [{ id: 'tools', name: 'Tools', color: '#fff', glyph: 'flask', skills: [{ id: 'one', name: 'One', source: 'installed', pluginId: 'tools', description: 'Detail' }] }],
      selfLearnt: [],
      note: null
    }))
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root?.render(createElement(SkillLabRoute)))
  const row = host.querySelector('[role="option"]') as HTMLButtonElement
  await act(async () => row.click())
  expect(reveal).toHaveBeenCalled()
})
