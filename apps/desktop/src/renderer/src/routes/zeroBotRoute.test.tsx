// @vitest-environment jsdom
import { act } from 'react'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZeroBotRoute } from './ZeroBotRoute'
import { SEND_BLOCKED_NOTICE } from './runtime.types'

type FakeZero = {
  invoke: (op: string, payload?: unknown) => Promise<unknown>
  subscribe: (channel: 'bridge' | 'cockpit', cb: (u: unknown) => void) => () => void
}

const THREAD_ROWS_PAYLOAD = {
  harness: 'codex',
  threads: [
    {
      id: 't1',
      name: null,
      preview: 'first chat thread',
      createdAt: 1757568000,
      recencyAt: 1757568000,
      model: 'gpt-5.6-sol',
      modelProvider: 'openai',
      status: 'idle'
    },
    { id: 't2', name: 'second', preview: 'p', createdAt: 10, recencyAt: 10 }
  ]
}

const THREAD_GET_PAYLOAD = {
  harness: 'codex',
  thread: {
    id: 't1',
    name: 'first chat thread',
    preview: 'first chat thread',
    createdAt: 1757568000,
    turns: [
      {
        id: 'turn1',
        status: 'completed',
        items: [
          { id: 'u1', type: 'userMessage', content: [{ type: 'text', text: 'run the tests' }] },
          { id: 'r1', type: 'reasoning', content: ['raw thoughts'], summary: ['short'] },
          {
            id: 'c1',
            type: 'commandExecution',
            command: 'npm test',
            cwd: '/repo',
            status: 'completed',
            exitCode: 0,
            aggregatedOutput: 'all green'
          },
          { id: 'a1', type: 'agentMessage', text: '**done**' }
        ]
      }
    ]
  }
}

let bridgeCb: ((u: unknown) => void) | null = null

const OPENCODE_FOLDERS_PAYLOAD = {
  harness: 'opencode',
  models: [],
  threads: [],
  folders: [
    {
      folder: 'beta',
      path: '/repo/beta',
      count: 1,
      sessions: [
        {
          id: 'b1',
          title: 'Beta chat',
          directory: '/repo/beta',
          agent: null,
          model: null,
          createdAt: 0,
          updatedAt: 200
        }
      ]
    },
    {
      folder: 'alpha',
      path: '/repo/alpha',
      count: 2,
      sessions: [
        {
          id: 'a-old',
          title: 'Old alpha',
          directory: '/repo/alpha',
          agent: null,
          model: null,
          createdAt: 0,
          updatedAt: 10
        },
        {
          id: 'a-new',
          title: 'Alpha new',
          directory: '/repo/alpha',
          agent: 'build',
          model: 'muse-spark-1.3',
          createdAt: 0,
          updatedAt: 300
        }
      ]
    }
  ],
  note: null
}

function fakeZero(handlers: Record<string, (payload?: unknown) => Promise<unknown>>): FakeZero {
  return {
    invoke: (op, payload) =>
      handlers[op] !== undefined ? handlers[op](payload) : Promise.reject(new Error(`no op ${op}`)),
    subscribe: (channel, cb) => {
      if (channel === 'bridge') bridgeCb = cb
      return () => {}
    }
  }
}

function stubZero(zero: FakeZero): void {
  // vi.stubGlobal remembers the previous (jsdom) global so afterEach can
  // RESTORE it — deleting `window` outright left react-dom's pending
  // concurrent-scheduler flush with a bare ReferenceError after teardown.
  vi.stubGlobal('window', { zero })
}

let root: Root | null = null
let host: HTMLElement | null = null

beforeEach(() => {
  bridgeCb = null
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
})

afterEach(async () => {
  act(() => {
    root?.unmount()
  })
  // Restore the real jsdom window FIRST, then drain react-dom's pending
  // scheduler flush (setImmediate) so nothing fires after the environment
  // is restored away.
  vi.unstubAllGlobals()
  await new Promise((r) => setImmediate(r))
  await new Promise((r) => setImmediate(r))
  host?.remove()
  root = null
  host = null
})

const renderRoute = (): void => {
  act(() => {
    root?.render(createElement(ZeroBotRoute))
  })
}

describe('ZeroBotRoute thread surface', () => {
  it('shows registered projects first, unprojected at bottom, and only the selected provider tree', async () => {
    const invoke = vi.fn(async (op: string) => {
      if (op === 'projects.list') return [{ id: 'p1', name: 'Project One', path: '/repo/one' }]
      if (op === 'codex.state') return { state: 'live', lastDiagnostic: null }
      if (op === 'ocp.state') return { state: 'disconnected', lastDiagnostic: null }
      if (op === 'codex.threads')
        return {
          threads: [
            { id: 'bound', name: 'Bound thread', projectId: 'p1' },
            { id: 'loose', name: 'Loose thread' }
          ]
        }
      if (op === 'ocp.discover') return OPENCODE_FOLDERS_PAYLOAD
      throw new Error(`unexpected op ${op}`)
    })
    stubZero(fakeZero({}))
    ;(globalThis as unknown as { window: { zero: FakeZero } }).window.zero.invoke = invoke
    renderRoute()
    await vi.waitFor(() => expect(host?.textContent).toContain('Bound thread'))
    const sidebar = host?.querySelector('[data-region="sidebar"]')
    expect(sidebar?.textContent?.indexOf('Project One')).toBeLessThan(
      sidebar?.textContent?.indexOf('UNPROJECTED') ?? 0
    )
    expect(sidebar?.textContent).not.toContain('Beta chat')
    const openCode = Array.from(sidebar?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent === 'OpenCode'
    )
    await act(async () => {
      openCode?.click()
    })
    expect(sidebar?.textContent).toContain('Beta chat')
    expect(sidebar?.textContent).not.toContain('Bound thread')
  })

  it('keeps model, voice, and send in one trailing composer row while send stays blocked', () => {
    stubZero(fakeZero({}))
    renderRoute()
    const composer = host?.querySelector('[data-region="composer"]')
    const selector = composer?.querySelector('select[aria-label="Model selector"]')
    const voice = composer?.querySelector('button[aria-label="Voice input"]')
    const send = composer?.querySelector('button[aria-label="Send turn"]')
    expect(selector?.parentElement).toBe(voice?.parentElement)
    expect(voice?.parentElement).toBe(send?.parentElement)
    expect(Array.from(voice?.parentElement?.children ?? [])).toEqual([selector, voice, send])
    expect(voice?.querySelector('svg')).not.toBeNull()
    expect(send?.querySelector('svg')).not.toBeNull()
    expect(send?.hasAttribute('disabled')).toBe(true)
  })
  it('submits an open Codex thread through Airlock, then requires Send once for a hold', async () => {
    const invoke = vi.fn(async (op: string) => {
      if (op === 'projects.list') return [{ id: 'p1', name: 'Project One', path: '/repo/one' }]
      if (op === 'codex.state') return { state: 'live', lastDiagnostic: null }
      if (op === 'ocp.state') return { state: 'disconnected', lastDiagnostic: null }
      if (op === 'codex.threads')
        return {
          ...THREAD_ROWS_PAYLOAD,
          threads: [{ ...THREAD_ROWS_PAYLOAD.threads[0], projectId: 'p1' }]
        }
      if (op === 'codex.thread.get') return THREAD_GET_PAYLOAD
      if (op === 'prompt.submit')
        return { state: 'held', holdId: 'hold-1', categories: ['credential'], positions: [1] }
      if (op === 'prompt.decide') return { state: 'accepted', turnId: 'turn-2' }
      throw new Error(`unexpected op ${op}`)
    })
    stubZero(fakeZero({}))
    ;(globalThis as unknown as { window: { zero: FakeZero } }).window.zero.invoke = invoke
    renderRoute()
    await vi.waitFor(() => expect(host?.innerHTML).toContain('first chat thread'))
    const row = Array.from(host?.querySelectorAll('button') ?? []).find((b) =>
      b.textContent?.includes('first chat thread')
    )
    await act(async () => {
      row?.click()
    })
    const box = host?.querySelector('textarea[aria-label="Message Zero"]') as HTMLTextAreaElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(box, 'password = synthetic-secret-123')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const send = host?.querySelector('button[aria-label="Send turn"]') as HTMLButtonElement
    expect(send.disabled).toBe(false)
    await act(async () => {
      send.click()
    })
    await vi.waitFor(() =>
      expect(host?.querySelector('[aria-label="Airlock hold"]')).not.toBeNull()
    )
    expect(invoke).toHaveBeenCalledWith('prompt.submit', {
      provider: 'codex',
      model: 'gpt-5.6-luna',
      threadId: 't1',
      text: 'password = synthetic-secret-123'
    })
    await act(async () => {
      Array.from(host?.querySelectorAll('button') ?? [])
        .find((b) => b.textContent === 'Send once')
        ?.click()
    })
    await vi.waitFor(() => expect(box.value).toBe(''))
    expect(invoke).toHaveBeenCalledWith(
      'prompt.decide',
      expect.objectContaining({ holdId: 'hold-1', action: 'send-once' })
    )
    expect(host?.textContent).toContain('Provider accepted the turn')
  })
  it('loads advertised OpenCode models and submits the selected saved session through Airlock', async () => {
    const invoke = vi.fn(async (op: string) => {
      if (op === 'projects.list') return []
      if (op === 'codex.state') return { state: 'disconnected', lastDiagnostic: null }
      if (op === 'ocp.state') return { state: 'live', lastDiagnostic: null }
      if (op === 'ocp.discover') return OPENCODE_FOLDERS_PAYLOAD
      if (op === 'ocp.thread.get') return { session: { messages: [] } }
      if (op === 'ocp.thread.prepare')
        return {
          sessionId: 'b1',
          cwd: '/repo/beta',
          currentModel: 'anthropic/claude-sonnet',
          models: [
            { id: 'anthropic/claude-sonnet', name: 'Claude Sonnet' },
            { id: 'openai/gpt-5', name: 'GPT-5' }
          ]
        }
      if (op === 'prompt.submit') return { state: 'accepted', turnId: 'ocp-1' }
      throw new Error(`unexpected op ${op}`)
    })
    stubZero(fakeZero({}))
    ;(globalThis as unknown as { window: { zero: FakeZero } }).window.zero.invoke = invoke
    renderRoute()
    const sidebar = host?.querySelector('[data-region="sidebar"]')
    await vi.waitFor(() => expect(sidebar?.textContent).toContain('OpenCode'))
    await act(async () => {
      Array.from(sidebar?.querySelectorAll('button') ?? [])
        .find((button) => button.textContent === 'OpenCode')
        ?.click()
    })
    await vi.waitFor(() => expect(sidebar?.textContent).toContain('Beta chat'))
    await act(async () => {
      Array.from(sidebar?.querySelectorAll('button') ?? [])
        .find((button) => button.textContent?.includes('Beta chat'))
        ?.click()
    })
    const box = host?.querySelector('textarea[aria-label="Message Zero"]') as HTMLTextAreaElement
    await vi.waitFor(() =>
      expect(
        (host?.querySelector('select[aria-label="Model selector"]') as HTMLSelectElement).value
      ).toBe('anthropic/claude-sonnet')
    )
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
        box,
        'continue'
      )
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const send = host?.querySelector('button[aria-label="Send turn"]') as HTMLButtonElement
    expect(send.disabled).toBe(false)
    await act(async () => {
      send.click()
    })
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('prompt.submit', {
        provider: 'opencode',
        model: 'anthropic/claude-sonnet',
        threadId: 'b1',
        text: 'continue'
      })
    )
  })
  it('surfaces provider permission requests and sends only the chosen bounded decision', async () => {
    const invoke = vi.fn(async (op: string) => {
      if (op === 'projects.list') return []
      if (op === 'codex.state') return { state: 'disconnected', lastDiagnostic: null }
      if (op === 'ocp.state') return { state: 'live', lastDiagnostic: null }
      if (op === 'ocp.discover') return OPENCODE_FOLDERS_PAYLOAD
      if (op === 'provider.permission.decide') return { accepted: true }
      throw new Error(`unexpected op ${op}`)
    })
    stubZero(fakeZero({}))
    ;(globalThis as unknown as { window: { zero: FakeZero } }).window.zero.invoke = invoke
    renderRoute()
    await vi.waitFor(() => expect(bridgeCb).not.toBeNull())
    act(() =>
      bridgeCb?.({
        harness: 'opencode',
        event: {
          id: 42,
          method: 'session/request_permission',
          params: {
            title: 'Run tests?',
            options: [{ optionId: 'allow-tool', name: 'Allow once', kind: 'allow_once' }]
          }
        }
      })
    )
    await vi.waitFor(() => expect(host?.textContent).toContain('Run tests?'))
    const allow = Array.from(host?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent === 'Allow once'
    )
    await act(async () => {
      allow?.click()
    })
    expect(invoke).toHaveBeenCalledWith('provider.permission.decide', {
      provider: 'opencode',
      requestId: 42,
      action: 'allow-once',
      optionId: 'allow-tool'
    })
  })
  it('renders thread rows after connect lists them via the read-only op', async () => {
    const invoke = vi.fn(async (op: string) => {
      if (op === 'codex.state') return { state: 'disconnected', lastDiagnostic: null }
      if (op === 'ocp.state') return { state: 'disconnected', lastDiagnostic: null }
      if (op === 'codex.connect') return 'live'
      if (op === 'codex.threads') return THREAD_ROWS_PAYLOAD
      throw new Error(`unexpected op ${op}`)
    })
    stubZero(fakeZero({}))
    ;(globalThis as unknown as { window: { zero: FakeZero } }).window.zero.invoke = invoke
    renderRoute()
    const connect = host?.querySelectorAll('button')
    const connectBtn = Array.from(connect ?? []).find((b) => b.textContent === 'Connect Codex')
    expect(connectBtn).toBeDefined()
    await act(async () => {
      connectBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    await vi.waitFor(() => {
      expect(host?.innerHTML).toContain('first chat thread')
      expect(host?.innerHTML).toContain('second')
      expect(invoke).toHaveBeenCalledWith('codex.threads')
    })
  })

  it('loads a selected thread transcript and renders chat items', async () => {
    const invoke = vi.fn(async (op, payload) => {
      if (op === 'codex.state') return { state: 'live', lastDiagnostic: null }
      if (op === 'ocp.state') return { state: 'disconnected', lastDiagnostic: null }
      if (op === 'codex.threads') return THREAD_ROWS_PAYLOAD
      if (op === 'codex.thread.get' && (payload as { threadId?: string })?.threadId === 't1') {
        return THREAD_GET_PAYLOAD
      }
      throw new Error(`unexpected op ${op}`)
    })
    stubZero(fakeZero({}))
    ;(globalThis as unknown as { window: { zero: FakeZero } }).window.zero.invoke = invoke
    renderRoute()
    await vi.waitFor(() => expect(host?.innerHTML).toContain('first chat thread'))
    const row = Array.from(host?.querySelectorAll('button') ?? []).find((b) =>
      b.textContent?.includes('first chat thread')
    )
    await act(async () => {
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    await vi.waitFor(() => {
      const html = host?.innerHTML ?? ''
      expect(html).toContain('run the tests')
      expect(html).toContain('<strong>done</strong>')
      expect(html).toContain('npm test')
      expect(html).toContain('EXIT 0')
      expect(html).toContain('Thinking')
      expect(html).not.toContain('raw thoughts')
    })
  })

  it('appends live bridge events of the open thread and keeps others out', async () => {
    const invoke = vi.fn(async (op, payload) => {
      if (op === 'codex.state') return { state: 'live', lastDiagnostic: null }
      if (op === 'ocp.state') return { state: 'disconnected', lastDiagnostic: null }
      if (op === 'codex.threads') return THREAD_ROWS_PAYLOAD
      if (op === 'codex.thread.get' && (payload as { threadId?: string })?.threadId === 't1') {
        return THREAD_GET_PAYLOAD
      }
      throw new Error(`unexpected op ${op}`)
    })
    stubZero(fakeZero({}))
    ;(globalThis as unknown as { window: { zero: FakeZero } }).window.zero.invoke = invoke
    renderRoute()
    await vi.waitFor(() => expect(host?.innerHTML).toContain('first chat thread'))
    const row = Array.from(host?.querySelectorAll('button') ?? []).find((b) =>
      b.textContent?.includes('first chat thread')
    )
    await act(async () => {
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(host?.innerHTML).toContain('<strong>done</strong>'))
    expect(bridgeCb).not.toBeNull()
    const push = bridgeCb as unknown as (u: unknown) => void
    act(() => {
      push({
        harness: 'codex',
        event: {
          method: 'item/completed',
          params: {
            threadId: 't1',
            turnId: 'turn2',
            completedAtMs: 9,
            item: { id: 'a2', type: 'agentMessage', text: 'live append' }
          }
        }
      })
    })
    expect(host?.innerHTML).toContain('live append')
    act(() => {
      push({
        harness: 'codex',
        event: {
          method: 'item/completed',
          params: {
            threadId: 't-other',
            turnId: 'x',
            completedAtMs: 9,
            item: { id: 'z1', type: 'agentMessage', text: 'foreign thread leak' }
          }
        }
      })
    })
    expect(host?.innerHTML).not.toContain('foreign thread leak')
    expect(host?.innerHTML).toContain('item/completed')
  })

  it('keeps live events that land while the transcript read is in flight', async () => {
    let resolveRead: (v: unknown) => void = () => {}
    const invoke = vi.fn(async (op, payload) => {
      if (op === 'codex.state') return { state: 'live', lastDiagnostic: null }
      if (op === 'ocp.state') return { state: 'disconnected', lastDiagnostic: null }
      if (op === 'codex.threads') return THREAD_ROWS_PAYLOAD
      if (op === 'codex.thread.get' && (payload as { threadId?: string })?.threadId === 't1') {
        return new Promise((resolve) => {
          resolveRead = resolve
        })
      }
      throw new Error(`unexpected op ${op}`)
    })
    stubZero(fakeZero({}))
    ;(globalThis as unknown as { window: { zero: FakeZero } }).window.zero.invoke = invoke
    renderRoute()
    await vi.waitFor(() => expect(host?.innerHTML).toContain('first chat thread'))
    const row = Array.from(host?.querySelectorAll('button') ?? []).find((b) =>
      b.textContent?.includes('first chat thread')
    )
    await act(async () => {
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    expect(bridgeCb).not.toBeNull()
    const push = bridgeCb as unknown as (u: unknown) => void
    // Live event lands while the read is still in flight.
    act(() => {
      push({
        harness: 'codex',
        event: {
          method: 'item/completed',
          params: {
            threadId: 't1',
            turnId: 'turn2',
            completedAtMs: 9,
            item: { id: 'a9', type: 'agentMessage', text: 'live text' }
          }
        }
      })
    })
    expect(host?.innerHTML).toContain('live text')
    await act(async () => {
      resolveRead(THREAD_GET_PAYLOAD)
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(host?.innerHTML).toContain('<strong>done</strong>'))
    // The live item must survive the read resolution (merge, not replace).
    expect(host?.innerHTML).toContain('live text')
    expect(host?.innerHTML).toContain('run the tests')
  })

  it('keeps the honest send block and voice placeholder', async () => {
    stubZero(fakeZero({}))
    renderRoute()
    expect(host?.innerHTML).toContain(SEND_BLOCKED_NOTICE)
    expect(host?.innerHTML).toContain('Voice')
  })

  it('never probes codex.threads when connecting the opencode harness', async () => {
    const invoke = vi.fn(async (op) => {
      if (op === 'codex.state' || op === 'ocp.state') {
        return { state: 'disconnected', lastDiagnostic: null }
      }
      if (op === 'ocp.connect') return 'live'
      throw new Error(`unexpected op ${op}`)
    })
    stubZero(fakeZero({}))
    ;(globalThis as unknown as { window: { zero: FakeZero } }).window.zero.invoke = invoke
    renderRoute()
    const ocpBtn = Array.from(host?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent === 'OpenCode'
    )
    expect(ocpBtn).toBeDefined()
    act(() => {
      ocpBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const connectBtn = Array.from(host?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent === 'Connect OpenCode'
    )
    await act(async () => {
      connectBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    expect(invoke).toHaveBeenCalledWith('ocp.connect')
    expect(invoke.mock.calls.some(([op]) => op === 'codex.threads')).toBe(false)
  })

  it('renders opencode sessions grouped by folder newest-first without connecting', async () => {
    const invoke = vi.fn(async (op: string) => {
      if (op === 'codex.state' || op === 'ocp.state') {
        return { state: 'disconnected', lastDiagnostic: null }
      }
      if (op === 'ocp.discover') return OPENCODE_FOLDERS_PAYLOAD
      throw new Error(`unexpected op ${op}`)
    })
    stubZero(fakeZero({}))
    ;(globalThis as unknown as { window: { zero: FakeZero } }).window.zero.invoke = invoke
    renderRoute()
    const ocpBtn = Array.from(host?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent === 'OpenCode'
    )
    act(() => {
      ocpBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await vi.waitFor(() => expect(host?.innerHTML).toContain('Alpha new'))
    const html = host?.innerHTML ?? ''
    // Folder groups render newest-group-first even though the wire sent beta first.
    expect(html).toContain('/repo/alpha')
    expect(html).toContain('/repo/beta')
    expect(html.indexOf('Alpha new')).toBeLessThan(html.indexOf('Beta chat'))
    // Sessions render newest-first within the folder.
    expect(html.indexOf('Alpha new')).toBeLessThan(html.indexOf('Old alpha'))
    expect(html).toContain('muse-spark-1.3')
    expect(invoke).toHaveBeenCalledWith('ocp.discover')
    expect(invoke.mock.calls.some(([op]) => op === 'ocp.connect')).toBe(false)
  })

  it('renders the honest empty note when the opencode store has no sessions', async () => {
    const invoke = vi.fn(async (op: string) => {
      if (op === 'codex.state' || op === 'ocp.state') {
        return { state: 'disconnected', lastDiagnostic: null }
      }
      if (op === 'ocp.discover') {
        return {
          harness: 'opencode',
          models: [],
          threads: [],
          folders: [],
          note: 'No OpenCode sessions found (session store unreadable at /nowhere).'
        }
      }
      throw new Error(`unexpected op ${op}`)
    })
    stubZero(fakeZero({}))
    ;(globalThis as unknown as { window: { zero: FakeZero } }).window.zero.invoke = invoke
    renderRoute()
    const ocpBtn = Array.from(host?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent === 'OpenCode'
    )
    act(() => {
      ocpBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await vi.waitFor(() => expect(host?.innerHTML).toContain('No OpenCode sessions found'))
  })

  it('renders the workspace regions: sidebar, canvas, composer and inspector', async () => {
    stubZero(fakeZero({}))
    renderRoute()
    const regions = (name: string): Element | null =>
      host?.querySelector(`[data-region="${name}"]`) ?? null
    expect(regions('sidebar')).not.toBeNull()
    expect(regions('canvas')).not.toBeNull()
    expect(regions('composer')).not.toBeNull()
    expect(regions('inspector')).not.toBeNull()
    expect(host?.innerHTML).toContain('New conversation')
  })

  it('collapses and reopens the inspector without touching any data path', async () => {
    const invoke = vi.fn(async (op: string) => {
      if (op === 'codex.state' || op === 'ocp.state') {
        return { state: 'disconnected', lastDiagnostic: null }
      }
      throw new Error(`unexpected op ${op}`)
    })
    stubZero(fakeZero({}))
    ;(globalThis as unknown as { window: { zero: FakeZero } }).window.zero.invoke = invoke
    renderRoute()
    const toggle = Array.from(host?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent === 'Hide inspector'
    )
    expect(toggle).toBeDefined()
    act(() => {
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(host?.querySelector('[data-region="inspector"]')).toBeNull()
    const reopen = Array.from(host?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent === 'Show inspector'
    )
    act(() => {
      reopen?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(host?.querySelector('[data-region="inspector"]')).not.toBeNull()
    expect(invoke.mock.calls.some(([op]) => op === 'codex.threads')).toBe(false)
  })

  it('attributes open-thread turns to Zero with muted provider models and summaries', async () => {
    const invoke = vi.fn(async (op, payload) => {
      if (op === 'codex.state') return { state: 'live', lastDiagnostic: null }
      if (op === 'ocp.state') return { state: 'disconnected', lastDiagnostic: null }
      if (op === 'codex.threads') return THREAD_ROWS_PAYLOAD
      if (op === 'codex.thread.get' && (payload as { threadId?: string })?.threadId === 't1') {
        return THREAD_GET_PAYLOAD
      }
      throw new Error(`unexpected op ${op}`)
    })
    stubZero(fakeZero({}))
    ;(globalThis as unknown as { window: { zero: FakeZero } }).window.zero.invoke = invoke
    renderRoute()
    await vi.waitFor(() => expect(host?.innerHTML).toContain('first chat thread'))
    const row = Array.from(host?.querySelectorAll('button') ?? []).find((b) =>
      b.textContent?.includes('first chat thread')
    )
    await act(async () => {
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(host?.innerHTML).toContain('via Codex'))
    const html = host?.innerHTML ?? ''
    expect(html).toContain('gpt-5.6-sol')
    expect(html).toContain('Ran npm test')
    expect(html).toContain('designed but pending')
  })

  it('invites starting in the composer from the empty canvas with send honestly blocked', async () => {
    stubZero(fakeZero({}))
    renderRoute()
    expect(host?.innerHTML).toContain('No conversation open')
    const box = host?.querySelector('[data-region="composer"] textarea')
    expect(box).not.toBeNull()
    expect(box?.getAttribute('rows')).toBe('3')
    expect(host?.innerHTML).toContain(SEND_BLOCKED_NOTICE)
    const send = Array.from(host?.querySelectorAll('button') ?? []).find(
      (b) => b.getAttribute('aria-label') === 'Send turn'
    )
    expect(send?.hasAttribute('disabled')).toBe(true)
  })

  it('does not create a conversation until the selected thread has a verified directory', async () => {
    const invoke = vi.fn(async (op, payload) => {
      if (op === 'codex.state') return { state: 'live', lastDiagnostic: null }
      if (op === 'ocp.state') return { state: 'disconnected', lastDiagnostic: null }
      if (op === 'codex.threads') return THREAD_ROWS_PAYLOAD
      if (op === 'codex.thread.get' && (payload as { threadId?: string })?.threadId === 't1') {
        return THREAD_GET_PAYLOAD
      }
      throw new Error(`unexpected op ${op}`)
    })
    stubZero(fakeZero({}))
    ;(globalThis as unknown as { window: { zero: FakeZero } }).window.zero.invoke = invoke
    renderRoute()
    await vi.waitFor(() => expect(host?.innerHTML).toContain('first chat thread'))
    const row = Array.from(host?.querySelectorAll('button') ?? []).find((b) =>
      b.textContent?.includes('first chat thread')
    )
    await act(async () => {
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(host?.innerHTML).toContain('run the tests'))
    const fresh = Array.from(host?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent === 'New conversation'
    )
    act(() => {
      fresh?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(host?.innerHTML).toContain('verified directory and advertised model')
    expect(host?.innerHTML).toContain('run the tests')
    const ops = invoke.mock.calls.map(([op]) => op as string)
    expect(ops).not.toContain('codex.send')
    expect(ops).not.toContain('ocp.send')
    expect(ops).not.toContain('conversation.new')
  })

  it('explains bridge failures in human copy with the raw diagnostic behind it', async () => {
    const invoke = vi.fn(async () => Promise.reject(new Error('socket refused at /tmp/z.sock')))
    stubZero(fakeZero({}))
    ;(globalThis as unknown as { window: { zero: FakeZero } }).window.zero.invoke = invoke
    renderRoute()
    await vi.waitFor(() => expect(host?.innerHTML).toContain('hit a problem'))
    expect(host?.innerHTML).toContain('socket refused at /tmp/z.sock')
    expect(host?.innerHTML).toContain('Reconnect')
  })
})
