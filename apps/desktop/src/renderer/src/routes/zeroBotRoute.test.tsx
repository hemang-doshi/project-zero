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
})
