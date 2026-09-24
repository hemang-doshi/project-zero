import { describe, expect, it } from 'vitest'
import {
  groupThreadsByRegisteredProject,
  groupThreadsByFolder,
  groupVisibleItems,
  MAX_CHAT_ITEMS,
  MAX_BRIDGE_EVENTS,
  applyBridgeEvent,
  mergeChatItem,
  mergeTranscript,
  parseThreadRows,
  parseTranscript,
  pushHarnessEvent,
  threadTimestamp,
  threadTitle,
  type ChatItem
} from './chat.model'
import type { BridgeEvent, Harness } from './runtime.types'

const THREAD_ROWS = {
  harness: 'codex',
  threads: [
    {
      id: 't-old',
      name: 'Older thread',
      preview: 'first user text',
      createdAt: 100,
      recencyAt: 200,
      model: 'gpt-5.6-luna',
      modelProvider: 'openai',
      status: 'idle'
    },
    {
      id: 't-new',
      name: null,
      preview: 'newest one',
      createdAt: 500,
      recencyAt: 900,
      model: 'gpt-5.6-sol',
      modelProvider: 'openai',
      status: 'active'
    },
    {
      id: 't-mid',
      name: null,
      preview: '',
      createdAt: 300,
      recencyAt: null,
      modelProvider: 'openai',
      status: 'idle'
    },
    'not-a-thread',
    { nope: 1 }
  ]
}

describe('groupVisibleItems', () => {
  it('groups only consecutive reasoning and hides an empty interior group', () => {
    const items: ChatItem[] = [
      { kind: 'thinking', id: 'r1', text: '', summary: '' },
      { kind: 'thinking', id: 'r2', text: 'available detail', summary: 'Checked history' },
      {
        kind: 'exec',
        id: 'e1',
        command: 'pwd',
        cwd: '/repo',
        output: '',
        exitCode: 0,
        status: 'completed'
      },
      { kind: 'thinking', id: 'r3', text: '', summary: '' },
      { kind: 'message', id: 'a1', role: 'assistant', text: 'Done' }
    ]
    const display = groupVisibleItems(items)
    expect(display.map((item) => item.kind)).toEqual(['thinking-group', 'exec', 'message'])
    expect(display[0]).toMatchObject({ items: [{ id: 'r1' }, { id: 'r2' }] })
    expect(display[1]).toBe(items[2])
    expect(display[2]).toBe(items[4])
  })
})

describe('parseThreadRows', () => {
  it('parses codex thread rows leniently and orders newest first', () => {
    const rows = parseThreadRows(THREAD_ROWS)
    expect(rows.map((r) => r.id)).toEqual(['t-new', 't-mid', 't-old'])
    expect(rows[0]).toMatchObject({
      id: 't-new',
      name: '',
      preview: 'newest one',
      createdAt: 500,
      recencyAt: 900,
      model: 'gpt-5.6-sol',
      provider: 'openai',
      status: 'active'
    })
    expect(rows[1].recencyAt).toBeNull()
  })

  it('skips malformed rows and accepts a bare array', () => {
    expect(parseThreadRows({ harness: 'codex', threads: ['nope'] })).toEqual([])
    expect(parseThreadRows([])).toEqual([])
    expect(parseThreadRows(null)).toEqual([])
  })

  it('titles from name, then preview, then untitled; timestamp prefers recencyAt', () => {
    const rows = parseThreadRows(THREAD_ROWS)
    expect(threadTitle(rows[0])).toBe('newest one')
    expect(threadTitle(rows[1])).toBe('untitled')
    expect(threadTitle(rows[2])).toBe('Older thread')
    expect(threadTimestamp(rows[0])).toBe(900)
    expect(threadTimestamp(rows[1])).toBe(300)
    expect(threadTimestamp(rows[2])).toBe(200)
  })
})

describe('groupThreadsByRegisteredProject', () => {
  it('groups Codex threads by verified cwd when daemon project ids are absent', () => {
    const projects = [
      { id: 'p1', name: 'App', path: '/one' },
      { id: 'p2', name: 'App', path: '/two' }
    ]
    const rows = parseThreadRows({
      threads: [
        { id: 'a', projectId: 'p1', recencyAt: 2 },
        { id: 'b', projectId: 'p2', recencyAt: 4 },
        { id: 'c', projectId: 'unknown', recencyAt: 5 },
        { id: 'd', cwd: '/one/subdir', recencyAt: 3 },
        { id: 'e', projectId: 'p1', recencyAt: 6 }
      ]
    })
    const result = groupThreadsByRegisteredProject(projects, rows)
    expect(result.groups.map((g) => [g.project.id, g.rows.map((r) => r.id)])).toEqual([
      ['p1', ['e', 'd', 'a']],
      ['p2', ['b']]
    ])
    expect(result.unprojected.map((r) => r.id)).toEqual(['c'])
  })
})

describe('groupThreadsByFolder', () => {
  it('keeps nested worktrees distinct under one verified project path', () => {
    const rows = parseThreadRows({
      threads: [
        { id: 'root', cwd: '/repo/app', recencyAt: 4 },
        { id: 'work', cwd: '/repo/app/.worktrees/feature', recencyAt: 3 },
        { id: 'other', cwd: '/repo/app/sub', recencyAt: 2 },
        { id: 'unknown', recencyAt: 1 }
      ]
    })
    expect(
      groupThreadsByFolder('/repo/app', rows).map((group) => [
        group.path,
        group.label,
        group.rows.map((row) => row.id)
      ])
    ).toEqual([
      ['/repo/app', 'Project root', ['root']],
      ['/repo/app/.worktrees/feature', '.worktrees/feature', ['work']],
      ['/repo/app/sub', 'sub', ['other']],
      [null, 'Unknown folder', ['unknown']]
    ])
  })
})

const TRANSCRIPT = {
  harness: 'codex',
  thread: {
    id: 't1',
    name: 'Some thread',
    preview: 'hi',
    createdAt: 7,
    turns: [
      {
        id: 'turn1',
        status: 'completed',
        items: [
          { id: 'u1', type: 'userMessage', content: [{ type: 'text', text: 'explain the build' }] },
          {
            id: 'r1',
            type: 'reasoning',
            content: ['thinking raw text'],
            summary: ['summary line']
          },
          {
            id: 'c1',
            type: 'commandExecution',
            command: 'npm test',
            cwd: '/repo',
            status: 'completed',
            exitCode: 0,
            aggregatedOutput: 'all green'
          },
          {
            id: 'm1',
            type: 'mcpToolCall',
            server: 'fs',
            tool: 'read_file',
            arguments: { path: '/a.txt' },
            status: 'completed',
            result: { content: [{ type: 'text', text: 'file body' }] }
          },
          { id: 'a1', type: 'agentMessage', text: '**done**' },
          { id: 'w1', type: 'webSearch', query: 'vitest jsdom' },
          {
            id: 'f1',
            type: 'fileChange',
            changes: [{ path: '/x.ts' }],
            status: 'completed'
          },
          { id: 'd1', type: 'dynamicToolCall', tool: 'grep', arguments: {}, status: 'failed' },
          { id: 'o1', type: 'functionCallOutput', name: 'plan_step', output: 'ok' },
          { id: 'p1', type: 'plan', text: 'step plan' },
          'garbage'
        ]
      }
    ]
  }
}

describe('parseTranscript', () => {
  it('flattens turn items in wire order into chat items', () => {
    const { items } = parseTranscript(TRANSCRIPT)
    expect(items.map((i) => i.kind)).toEqual([
      'message',
      'thinking',
      'exec',
      'tool',
      'message',
      'tool',
      'tool',
      'tool',
      'tool',
      'notice'
    ])
  })

  it('classifies user and agent messages', () => {
    const { items } = parseTranscript(TRANSCRIPT)
    const [user, , , , agent] = items as Extract<ChatItem, { kind: 'message' }>[]
    expect(user).toMatchObject({ kind: 'message', role: 'user', text: 'explain the build' })
    expect(agent).toMatchObject({ kind: 'message', role: 'assistant', text: '**done**' })
  })

  it('renders reasoning as hidden thinking with raw text and summary', () => {
    const [thinking] = parseTranscript(TRANSCRIPT).items.filter((i) => i.kind === 'thinking')
    expect(thinking).toMatchObject({
      kind: 'thinking',
      text: 'thinking raw text',
      summary: 'summary line'
    })
  })

  it('renders reasoning with no summary as summary-empty, content fallback works', () => {
    const items = parseTranscript({
      harness: 'codex',
      thread: {
        id: 't',
        turns: [
          {
            id: 'r',
            status: 'completed',
            items: [{ id: 'r1', type: 'reasoning', content: ['a', 'b'], summary: [] }]
          }
        ]
      }
    })
    expect(items.items[0]).toMatchObject({ kind: 'thinking', text: 'a\nb', summary: '' })
  })

  it('classifies terminal execution with command, cwd, output and exit code', () => {
    const [exec] = parseTranscript(TRANSCRIPT).items.filter((i) => i.kind === 'exec') as Extract<
      ChatItem,
      { kind: 'exec' }
    >[]
    expect(exec).toMatchObject({
      kind: 'exec',
      command: 'npm test',
      cwd: '/repo',
      output: 'all green',
      exitCode: 0,
      status: 'completed'
    })
  })

  it('classifies tool calls with server/tool name, status and result text', () => {
    const tools = parseTranscript(TRANSCRIPT).items.filter((i) => i.kind === 'tool') as Extract<
      ChatItem,
      { kind: 'tool' }
    >[]
    expect(tools).toHaveLength(5)
    expect(tools[0]).toMatchObject({ tool: 'read_file', server: 'fs', status: 'completed' })
    expect(tools[0].detail).toContain('/a.txt')
    expect(tools[0].result).toBe('file body')
    expect(tools[1]).toMatchObject({ tool: 'webSearch', detail: 'vitest jsdom' })
    expect(tools[2]).toMatchObject({ tool: 'fileChange', detail: '/x.ts' })
    expect(tools[3]).toMatchObject({ tool: 'grep', status: 'failed' })
    expect(tools[4]).toMatchObject({ tool: 'plan_step', result: 'ok' })
  })

  it('keeps unknown item types as honest notice rows', () => {
    const notices = parseTranscript(TRANSCRIPT).items.filter((i) => i.kind === 'notice') as Extract<
      ChatItem,
      { kind: 'notice' }
    >[]
    expect(notices[0]).toMatchObject({ kind: 'notice', text: 'plan' })
  })

  it('is bounded: keeps the last MAX items with an honest dropped count', () => {
    const turns = Array.from({ length: MAX_CHAT_ITEMS + 10 }, (_, i) => ({
      id: `turn${i}`,
      status: 'completed',
      items: [{ id: `m${i}`, type: 'agentMessage', text: `msg ${i}` }]
    }))
    const parsed = parseTranscript({ harness: 'codex', thread: { id: 't', turns } })
    expect(parsed.items).toHaveLength(MAX_CHAT_ITEMS)
    expect(parsed.dropped).toBe(10)
    const last = parsed.items.at(-1) as Extract<ChatItem, { kind: 'message' }>
    expect(last.text).toBe('msg 409')
  })

  it('tolerates malformed transcript payloads', () => {
    expect(parseTranscript(null)).toEqual({ items: [], dropped: 0 })
    expect(parseTranscript({})).toEqual({ items: [], dropped: 0 })
    expect(parseTranscript({ thread: { turns: 'nope' } })).toEqual({ items: [], dropped: 0 })
  })
})

describe('mergeChatItem', () => {
  it('upserts by item id, replacing an earlier partial item', () => {
    const base: ChatItem[] = [
      { kind: 'message', role: 'assistant', text: 'par', id: 'a1' },
      { kind: 'message', role: 'user', text: 'q', id: 'u1' }
    ]
    const merged = mergeChatItem(base, {
      kind: 'message',
      role: 'assistant',
      text: 'partial',
      id: 'a1'
    })
    expect(merged).toHaveLength(2)
    expect(merged[0]).toMatchObject({ id: 'a1', text: 'partial' })
    const appended = mergeChatItem(merged, {
      kind: 'exec',
      command: 'ls',
      cwd: '.',
      output: null,
      exitCode: null,
      status: 'inProgress',
      id: 'e1'
    })
    expect(appended).toHaveLength(3)
  })
})

describe('mergeTranscript (read-vs-live race)', () => {
  it('keeps live lane state per id and fills only the ids the read uniquely has', () => {
    const lane: ChatItem[] = [
      { kind: 'message', role: 'user', text: 'q', id: 'u1' },
      { kind: 'message', role: 'assistant', text: 'live partial', id: 'a1' },
      { kind: 'message', role: 'assistant', text: 'live only', id: 'a2' }
    ]
    const read: ChatItem[] = [
      { kind: 'message', role: 'user', text: 'q', id: 'u1' },
      { kind: 'message', role: 'assistant', text: 'read full', id: 'a1' },
      {
        kind: 'exec',
        command: 'ls',
        cwd: '.',
        output: null,
        exitCode: null,
        status: 'completed',
        id: 'e1'
      }
    ]
    const { items: merged } = mergeTranscript(lane, read)
    expect(merged.map((i) => i.id)).toEqual(['u1', 'a1', 'e1', 'a2'])
    expect(merged[1]).toMatchObject({ kind: 'message', text: 'live partial' })
    expect(merged[2]).toMatchObject({ kind: 'exec' })
    expect(merged[3]).toMatchObject({ kind: 'message', text: 'live only' })
  })

  it('returns the read transcript unchanged when the lane is empty', () => {
    const read: ChatItem[] = [{ kind: 'message', role: 'user', text: 'q', id: 'u1' }]
    expect(mergeTranscript([], read)).toEqual({ items: read, dropped: 0 })
  })

  it('returns the lane unchanged when the read is empty', () => {
    const lane: ChatItem[] = [{ kind: 'message', role: 'user', text: 'q', id: 'u1' }]
    expect(mergeTranscript(lane, [])).toEqual({ items: lane, dropped: 0 })
  })

  it('is bounded with an honest dropped count over the merged result', () => {
    const lane: ChatItem[] = Array.from({ length: MAX_CHAT_ITEMS + 5 }, (_, i) => ({
      kind: 'message',
      role: 'assistant',
      text: `live ${i}`,
      id: `l${i}`
    }))
    const merged = mergeTranscript(lane, [])
    expect(merged.items).toHaveLength(MAX_CHAT_ITEMS)
    expect(merged.dropped).toBe(5)
    expect((merged.items[0] as Extract<ChatItem, { kind: 'message' }>).text).toBe('live 5')
  })
})

describe('applyBridgeEvent (live merge over zero:bridge)', () => {
  it('upserts started/completed items carrying threadId context', () => {
    let items: ChatItem[] = []
    let r = applyBridgeEvent(items, 'item/started', {
      threadId: 't1',
      turnId: 'turn1',
      startedAtMs: 1,
      item: { id: 'i1', type: 'agentMessage', text: 'hel' }
    })
    items = r.items
    expect(items).toHaveLength(1)
    r = applyBridgeEvent(items, 'item/completed', {
      threadId: 't1',
      turnId: 'turn1',
      completedAtMs: 2,
      item: { id: 'i1', type: 'agentMessage', text: 'hello world' }
    })
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({ kind: 'message', role: 'assistant', text: 'hello world' })
  })

  it('appends agent message deltas to the open assistant item', () => {
    let items: ChatItem[] = [{ kind: 'message', role: 'user', text: 'q', id: 'u1' }]
    items = applyBridgeEvent(items, 'item/agentMessage/delta', {
      itemId: 'i1',
      delta: 'hel',
      threadId: 't1',
      turnId: 'turn1'
    }).items
    items = applyBridgeEvent(items, 'item/agentMessage/delta', {
      itemId: 'i1',
      delta: 'lo',
      threadId: 't1',
      turnId: 'turn1'
    }).items
    const msg = items.find((i) => i.id === 'i1') as Extract<ChatItem, { kind: 'message' }>
    expect(msg.text).toBe('hello')
    expect(msg.role).toBe('assistant')
    expect(items).toHaveLength(2)
  })

  it('appends reasoning deltas to the open thinking item', () => {
    let items: ChatItem[] = []
    items = applyBridgeEvent(items, 'item/reasoning/textDelta', {
      itemId: 'r1',
      delta: 'thin',
      threadId: 't1',
      turnId: 'turn1'
    }).items
    items = applyBridgeEvent(items, 'item/reasoning/textDelta', {
      itemId: 'r1',
      delta: 'king',
      threadId: 't1',
      turnId: 'turn1'
    }).items
    const th = items[0] as Extract<ChatItem, { kind: 'thinking' }>
    expect(th.text).toBe('thinking')
  })

  it('appends command execution output deltas to the open exec item', () => {
    let items: ChatItem[] = []
    items = applyBridgeEvent(items, 'item/commandExecution/outputDelta', {
      itemId: 'e1',
      delta: 'out1',
      threadId: 't1',
      turnId: 'turn1'
    }).items
    items = applyBridgeEvent(items, 'item/commandExecution/outputDelta', {
      itemId: 'e1',
      delta: 'out2',
      threadId: 't1',
      turnId: 'turn1'
    }).items
    const exec = items[0] as Extract<ChatItem, { kind: 'exec' }>
    expect(exec.command).toBe('')
    expect(exec.output).toBe('out1out2')
  })

  it('ignores unrelated or malformed bridge methods', () => {
    const items: ChatItem[] = [{ kind: 'message', role: 'user', text: 'q', id: 'u1' }]
    expect(applyBridgeEvent(items, 'thread/status/changed', { threadId: 't1' }).items).toBe(items)
    expect(applyBridgeEvent(items, 'item/agentMessage/delta', null).items).toBe(items)
  })
})

const ev = (harness: Harness, method: string): BridgeEvent => ({
  harness,
  method,
  params: undefined
})

describe('per-harness bounded retention', () => {
  it('caps each harness at 100 events with independent dropped counters', () => {
    let log = {
      codex: { events: [] as BridgeEvent[], dropped: 0 },
      opencode: { events: [] as BridgeEvent[], dropped: 0 }
    }
    for (let i = 0; i < 102; i++) log = pushHarnessEvent(log, ev('codex', `c${i}`))
    for (let i = 0; i < 101; i++) log = pushHarnessEvent(log, ev('opencode', `o${i}`))
    expect(log.codex.events).toHaveLength(MAX_BRIDGE_EVENTS)
    expect(log.codex.events[0].method).toBe('c2')
    expect(log.codex.dropped).toBe(2)
    expect(log.opencode.events).toHaveLength(MAX_BRIDGE_EVENTS)
    expect(log.opencode.events[0].method).toBe('o1')
    expect(log.opencode.dropped).toBe(1)
  })

  it('keeps per-harness visibility under the strict harness lock', () => {
    let log = {
      codex: { events: [] as BridgeEvent[], dropped: 0 },
      opencode: { events: [] as BridgeEvent[], dropped: 0 }
    }
    log = pushHarnessEvent(log, ev('codex', 'a'))
    log = pushHarnessEvent(log, ev('opencode', 'b'))
    expect(log.codex.events.map((e) => e.method)).toEqual(['a'])
    expect(log.opencode.events.map((e) => e.method)).toEqual(['b'])
  })
})
