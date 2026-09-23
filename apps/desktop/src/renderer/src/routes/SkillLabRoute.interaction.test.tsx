// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { SkillLabRoute } from './SkillLabRoute'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

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
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 520
  })
  const reveal = vi.fn()
  HTMLElement.prototype.scrollIntoView = reveal
  ;(window as unknown as { zero: unknown }).zero = {
    invoke: vi.fn(async () => ({
      groups: [
        {
          id: 'tools',
          name: 'Tools',
          color: '#fff',
          skills: [
            {
              id: 'one',
              name: 'One',
              source: 'installed',
              pluginId: 'tools',
              description: 'Detail'
            }
          ]
        }
      ],
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

it('shows a locally generated proposal and requires explicit approval to install it', async () => {
  const proposal = {
    id: 'proposal-1',
    slug: 'workflow-rg-git-npm',
    title: 'Workflow: rg → git → npm',
    draft: '---\nname: workflow-rg-git-npm\ndescription: Review a workflow.\n---\n\n# Draft\n',
    source: 'observed',
    sourceRefs: ['codex:thread-1', 'opencode:session-2'],
    steps: ['rg', 'git', 'npm'],
    evidenceCount: 2,
    createdAt: 10,
    status: 'proposed'
  }
  let learningEnabled = false
  let status: 'proposed' | 'installed' = 'proposed'
  const invoke = vi.fn(async (op: string, payload?: Record<string, unknown>) => {
    if (op === 'skills.discover') return { groups: [], selfLearnt: [], note: null }
    if (op === 'skills.learning.get')
      return { learningEnabled, proposals: [{ ...proposal, status }] }
    if (op === 'skills.learning.set') {
      learningEnabled = payload?.enabled === true
      return { learningEnabled, proposals: [{ ...proposal, status }] }
    }
    if (op === 'skills.learning.approve') {
      status = 'installed'
      return { path: '/profile/skills-learned/workflow-rg-git-npm', hash: 'abc123' }
    }
    return []
  })
  ;(window as unknown as { zero: unknown }).zero = { invoke }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root?.render(createElement(SkillLabRoute)))
  expect(host.textContent).toContain('Workflow: rg → git → npm')
  expect(host.textContent).toContain('2 observed sources')
  expect((host.querySelector('[aria-label="Skill name"]') as HTMLInputElement).value).toBe(
    'workflow-rg-git-npm'
  )
  expect((host.querySelector('[aria-label="Skill draft"]') as HTMLTextAreaElement).value).toBe(
    proposal.draft
  )
  const toggle = host.querySelector('[aria-label="Enable self-learning"]') as HTMLInputElement
  await act(async () => {
    toggle.click()
  })
  expect(invoke).toHaveBeenCalledWith('skills.learning.set', { enabled: true })
  const approve = [...host.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Approve and install')
  )
  expect(approve).toBeDefined()
  await act(async () => approve?.click())
  expect(invoke).toHaveBeenCalledWith('skills.learning.approve', { proposalId: 'proposal-1' })
})
