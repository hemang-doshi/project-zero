// @vitest-environment jsdom
import { act } from 'react'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ChatRow,
  ExecBlock,
  ThinkingBlock,
  ThinkingGroupBlock,
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
  it('shows consecutive provider notes as one keyboard-accessible disclosure', () => {
    mount(
      createElement(ThinkingGroupBlock, {
        items: [
          { kind: 'thinking', id: 'r0', text: '', summary: '' },
          thinking,
          { kind: 'thinking', id: 'r2', text: 'second private detail', summary: 'Checked files' }
        ]
      })
    )
    const button = host?.querySelector('button')
    expect(host?.querySelectorAll('button')).toHaveLength(1)
    expect(button?.getAttribute('aria-expanded')).toBe('false')
    expect(host?.innerHTML).not.toContain('raw internal reasoning text')
    expect(host?.innerHTML).not.toContain('second private detail')
    act(() => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(button?.getAttribute('aria-expanded')).toBe('true')
    expect(host?.textContent).toContain('raw internal reasoning text')
    expect(host?.textContent).toContain('second private detail')
  })
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

  it('labels provider-withheld reasoning without implying a missing generated summary', () => {
    const html = mount(
      createElement(ThinkingBlock, { item: { ...thinking, text: '', summary: '' } })
    )
    expect(html).toContain('reasoning unavailable')
    expect(html).not.toContain('no summary available')
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
  it('shows a semantic summary first and keeps raw output behind expansion', () => {
    const html = mount(createElement(ExecBlock, { item: exec }))
    expect(html).toContain('Ran npm test')
    expect(html).toContain('EXIT 0')
    expect(html).toContain('ui-monospace')
    expect(html).not.toContain('all green')
    act(() => {
      host?.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(host?.innerHTML).toContain('npm test')
    expect(host?.innerHTML).toContain('all green')
    expect(host?.querySelector('[role="region"][aria-label="Terminal output"]')).not.toBeNull()
    expect(host?.querySelector('.zw-terminal-command')?.textContent).toBe('$ npm test')
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
  it('shows a semantic summary first and keeps raw output behind expansion', () => {
    const html = mount(createElement(ToolBlock, { item: tool }))
    expect(html).toContain('Read 1 file')
    expect(html).toContain('COMPLETED')
    expect(html).not.toContain('file body')
    act(() => {
      host?.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const expanded = host?.innerHTML ?? ''
    expect(expanded).toContain('read_file')
    expect(expanded).toContain('fs')
    expect(expanded).toContain('COMPLETED')
    expect(expanded).toContain('file body')
  })
})

describe('ChatRow Zero attribution', () => {
  it('authors assistant turns as Zero with muted verbatim provider attribution', () => {
    const html = mount(
      createElement(ChatRow, {
        item: { kind: 'message', role: 'assistant', text: 'hi', id: 'a1' },
        harness: 'codex',
        model: 'gpt-5.6-sol'
      })
    )
    expect(html).toContain('Zero')
    expect(html).toContain('via Codex')
    expect(html).toContain('gpt-5.6-sol')
    expect(html).not.toContain('ZERO BOT')
  })

  it('speaks chat in the human voice and metadata in the machine voice', () => {
    mount(
      createElement(ChatRow, {
        item: { kind: 'message', role: 'assistant', text: 'hi', id: 'a1' },
        harness: 'codex',
        model: 'gpt-5.6-sol'
      })
    )
    const human = host?.querySelector('[data-voice="human"]')
    const machine = host?.querySelector('[data-voice="machine"]')
    expect(human).not.toBeNull()
    expect(machine).not.toBeNull()
    expect((machine as HTMLElement | null)?.textContent).toContain('via Codex')
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
