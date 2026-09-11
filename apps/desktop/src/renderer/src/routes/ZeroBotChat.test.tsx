// @vitest-environment jsdom
import { act } from 'react'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ChatRow,
  ExecBlock,
  ThinkingBlock,
  ThreadList,
  ToolBlock,
  type ThinkingItem
} from './ZeroBotChat'
import type { ChatItem, ThreadRow } from './chat.model'

let root: Root | null = null
let host: HTMLElement | null = null

function mount(node: React.ReactElement): string {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root?.render(node)
  })
  return host.innerHTML
}

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  host?.remove()
  root = null
  host = null
})

const thinking: ThinkingItem = {
  kind: 'thinking',
  text: 'raw internal reasoning text',
  summary: 'summarizes the plan',
  id: 'r1'
}

const exec: ChatItem = {
  kind: 'exec',
  command: 'npm test',
  cwd: '/repo',
  output: 'all green',
  exitCode: 0,
  status: 'completed',
  id: 'e1'
}

const tool: ChatItem = {
  kind: 'tool',
  tool: 'read_file',
  server: 'fs',
  detail: '{"path":"/a.txt"}',
  result: 'file body',
  status: 'completed',
  id: 'm1'
}

const rows: ThreadRow[] = [
  {
    id: 't-new',
    name: '',
    preview: 'newest one',
    createdAt: 1757568000,
    recencyAt: 1757568000,
    model: 'gpt-5.6-sol',
    provider: 'openai',
    status: 'active'
  },
  {
    id: 't-mid',
    name: '',
    preview: '',
    createdAt: 300,
    recencyAt: null,
    model: null,
    provider: 'openai',
    status: 'idle'
  }
]

describe('ThinkingBlock', () => {
  it('hides reasoning by default behind a collapsed Thinking row', () => {
    const html = mount(createElement(ThinkingBlock, { item: thinking }))
    expect(html).toContain('Thinking')
    expect(html).toContain('summarizes the plan')
    expect(html).not.toContain('raw internal reasoning text')
  })

  it('expands the raw reasoning text on click and keeps it expandable', () => {
    mount(createElement(ThinkingBlock, { item: thinking }))
    const button = host?.querySelector('button')
    expect(button).not.toBeNull()
    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(host?.innerHTML).toContain('raw internal reasoning text')
    const expanded = host?.textContent ?? ''
    expect(expanded).toContain('summarizes the plan')
    act(() => {
      host?.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(host?.innerHTML).not.toContain('raw internal reasoning text')
  })
})

describe('MarkdownText via ChatRow messages', () => {
  it('renders markdown with bold and code from the assistant text', () => {
    const html = mount(
      createElement(ChatRow, {
        item: { kind: 'message', role: 'assistant', text: '**done** with `npm test`', id: 'a1' }
      })
    )
    expect(html).toContain('<strong>done</strong>')
    expect(html).toContain('<code>npm test</code>')
  })

  it('styles the operator bubble distinctly from the assistant bubble', () => {
    const user = mount(
      createElement(ChatRow, { item: { kind: 'message', role: 'user', text: 'hi', id: 'u1' } })
    )
    const agent = mount(
      createElement(ChatRow, { item: { kind: 'message', role: 'assistant', text: 'hi', id: 'a1' } })
    )
    expect(user).toContain('var(--z-orange)')
    expect(agent).not.toContain('var(--z-orange)')
  })
})

describe('ExecBlock', () => {
  it('renders command and output in the mono stack with exit status', () => {
    const html = mount(createElement(ExecBlock, { item: exec }))
    expect(html).toContain('npm test')
    expect(html).toContain('all green')
    expect(html).toContain('EXIT 0')
    expect(html).toContain('ui-monospace')
  })

  it('marks a failed execution honestly', () => {
    const html = mount(
      createElement(ExecBlock, {
        item: { ...exec, exitCode: 2, status: 'failed', output: 'boom' }
      })
    )
    expect(html).toContain('EXIT 2')
  })
})

describe('ToolBlock', () => {
  it('renders tool name, server namespace and status', () => {
    const html = mount(createElement(ToolBlock, { item: tool }))
    expect(html).toContain('read_file')
    expect(html).toContain('fs')
    expect(html).toContain('COMPLETED')
    expect(html).toContain('file body')
  })
})

describe('ThreadList', () => {
  it('renders titled, untitled and preview rows with timestamps and selection', () => {
    const onSelect = vi.fn()
    const html = mount(createElement(ThreadList, { rows, selectedId: 't-new', onSelect }))
    expect(html).toContain('newest one')
    expect(html).toContain('untitled')
    expect(html).toContain('2025')
    const first = host?.querySelector<HTMLButtonElement>('button')
    act(() => {
      first?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onSelect).toHaveBeenCalledWith('t-new')
  })
})
