import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ZeroBotRoute } from './ZeroBotRoute'
import {
  HARNESS_DEFAULT_MODEL,
  HARNESS_MODELS,
  SEND_BLOCKED_NOTICE,
  VOICE_DISABLED_NOTICE,
  bridgeEventSummary,
  classifyBridgeEvent,
  harnessLockWarning,
  mirrorLabel,
  parseDiscovery,
  visibleBridgeEvents,
  type BridgeEvent
} from './runtime.types'

describe('harness lock', () => {
  it('maps each harness to its pinned model roster', () => {
    expect(HARNESS_MODELS.codex).toEqual([
      'gpt-5.6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-6-astra'
    ])
    expect(HARNESS_MODELS.opencode).toEqual(['muse-spark-1.3'])
    expect(HARNESS_DEFAULT_MODEL.codex).toBe('gpt-5.6-luna')
    expect(HARNESS_DEFAULT_MODEL.opencode).toBe('muse-spark-1.3')
  })

  it('warns on a foreign model and names the mirror path of the selected harness', () => {
    const warning = harnessLockWarning('muse-spark-1.3', 'codex')
    expect(warning).toContain('muse-spark-1.3')
    expect(warning).toContain('not allowed in the codex harness')
    expect(warning).toContain('mirrored, not sent')
    expect(harnessLockWarning('gpt-5.6-luna', 'codex')).toBeNull()
    expect(harnessLockWarning('muse-spark-1.3', 'opencode')).toBeNull()
    expect(harnessLockWarning('gpt-5.6-sol', 'opencode')).toContain('gpt-5.6-sol')
  })

  it('labels the jsonl mirror from the bridge identity', () => {
    expect(mirrorLabel('codex')).toBe('zero-meta/codex/events.jsonl')
    expect(mirrorLabel('opencode')).toBe('zero-meta/opencode/events.jsonl')
  })
})

describe('bridge event surface', () => {
  it('classifies streamed bridge methods with the pinned taxonomy', () => {
    expect(classifyBridgeEvent('item/agentMessage/delta')).toBe('ZERO BOT')
    expect(classifyBridgeEvent('item/agentMessage/completed')).toBe('ZERO BOT')
    expect(classifyBridgeEvent('user/message')).toBe('OPERATOR')
    expect(classifyBridgeEvent('item/reasoning/summary')).toBe('REASONING')
    expect(classifyBridgeEvent('item/plan/update')).toBe('PLAN')
    expect(classifyBridgeEvent('item/commandExecution/requestApproval')).toBe('COMMAND')
    expect(classifyBridgeEvent('item/fileChange/start')).toBe('FILE CHANGE')
    expect(classifyBridgeEvent('item/toolCall/start')).toBe('TOOL')
    expect(classifyBridgeEvent('thread/started')).toBe('PROTOCOL ITEM')
    expect(classifyBridgeEvent('error/encountered')).toBe('PROTOCOL ITEM')
  })

  it('summarizes events from bounded display fields only', () => {
    expect(
      bridgeEventSummary({
        harness: 'codex',
        method: 'item/agentMessage/delta',
        params: { delta: 'hello world' }
      })
    ).toBe('hello world')
    expect(
      bridgeEventSummary({
        harness: 'codex',
        method: 'thread/started',
        params: { threadId: 't-9' }
      })
    ).toBe('t-9')
    expect(
      bridgeEventSummary({ harness: 'codex', method: 'session/update', params: undefined })
    ).toBe('session/update')
    const long = 'x'.repeat(120)
    expect(bridgeEventSummary({ harness: 'codex', method: 'm', params: { text: long } })).toBe(
      `…${'x'.repeat(96)}`
    )
  })

  it('caps retained events at 100 per harness with per-harness drop counters (chat.model)', async () => {
    const { pushHarnessEvent, EMPTY_HARNESS_LOG, MAX_BRIDGE_EVENTS } = await import('./chat.model')
    let log = EMPTY_HARNESS_LOG
    for (let i = 0; i < 102; i++)
      log = pushHarnessEvent(log, { harness: 'codex', method: `m${i}`, params: undefined })
    expect(log.codex.events).toHaveLength(MAX_BRIDGE_EVENTS)
    expect(log.codex.events[0].method).toBe('m2')
    expect(log.codex.dropped).toBe(2)
    expect(log.opencode.events).toHaveLength(0)
  })

  it('shows only the selected harness events under the strict harness lock', () => {
    const events: BridgeEvent[] = [
      { harness: 'codex', method: 'a', params: undefined },
      { harness: 'opencode', method: 'b', params: undefined },
      { harness: 'codex', method: 'c', params: undefined }
    ]
    expect(visibleBridgeEvents(events, 'codex').map((e) => e.method)).toEqual(['a', 'c'])
    expect(visibleBridgeEvents(events, 'opencode').map((e) => e.method)).toEqual(['b'])
  })
})

describe('parseDiscovery', () => {
  it('parses codex model and thread discovery results', () => {
    const d = parseDiscovery({
      harness: 'codex',
      models: [
        { id: 'gpt-5.6-luna', displayName: 'Luna' },
        { id: 'gpt-5.6-luna', displayName: 'Dup' }
      ],
      threads: [{ id: 't1', name: 'One' }]
    })
    expect(d).toEqual({
      harness: 'codex',
      models: [{ id: 'gpt-5.6-luna', label: 'Luna', advertised: true }],
      threads: [{ id: 't1', name: 'One' }],
      folders: [],
      note: null
    })
  })

  it('parses opencode folder-grouped sessions newest-first and skips malformed rows', () => {
    const d = parseDiscovery({
      harness: 'opencode',
      models: [],
      threads: [],
      folders: [
        {
          folder: 'beta',
          path: '/repo/beta',
          count: 99,
          sessions: [{ id: 'b1', title: 'Beta', updatedAt: 200 }]
        },
        {
          folder: 'alpha',
          path: '/repo/alpha',
          count: 2,
          sessions: [
            { id: 'a-old', title: 'Old', directory: '/repo/alpha', updatedAt: 10 },
            {
              id: 'a-new',
              title: 'New',
              directory: '/repo/alpha',
              agent: 'build',
              model: 'muse-spark-1.3',
              createdAt: 5,
              updatedAt: 300
            },
            { id: '', title: 'Missing id' },
            'junk'
          ]
        },
        { folder: 'nodir', sessions: [] },
        null
      ],
      note: null
    })
    expect(d?.folders.map((f) => f.path)).toEqual(['/repo/alpha', '/repo/beta'])
    expect(d?.folders[0]).toEqual({
      folder: 'alpha',
      path: '/repo/alpha',
      count: 2,
      sessions: [
        {
          id: 'a-new',
          title: 'New',
          directory: '/repo/alpha',
          agent: 'build',
          model: 'muse-spark-1.3',
          createdAt: 5,
          updatedAt: 300
        },
        {
          id: 'a-old',
          title: 'Old',
          directory: '/repo/alpha',
          agent: null,
          model: null,
          createdAt: 0,
          updatedAt: 10
        }
      ]
    })
    expect(d?.folders[1]?.sessions.map((s) => s.id)).toEqual(['b1'])
    expect(d?.note).toBeNull()
  })

  it('keeps the opencode store note and tolerates malformed rows', () => {
    const d = parseDiscovery({
      harness: 'opencode',
      models: [],
      threads: [],
      folders: [],
      note: 'No OpenCode sessions found (session store unreadable at /nowhere/opencode.db).'
    })
    expect(d?.note).toContain('No OpenCode sessions found')
    expect(d?.folders).toEqual([])
    expect(parseDiscovery({ harness: 'shell', models: [] })).toBeNull()
    expect(parseDiscovery(null)).toBeNull()
    expect(parseDiscovery({ harness: 'codex', models: [null, 5], threads: ['x'] })).toEqual({
      harness: 'codex',
      models: [],
      threads: [],
      folders: [],
      note: null
    })
  })
})

describe('ZeroBotRoute', () => {
  it('renders the harness picker with codex selected by default', () => {
    const html = renderToString(createElement(ZeroBotRoute))
    expect(html).toContain('ZERO BOT')
    expect(html).toContain('Codex')
    expect(html).toContain('OpenCode')
    expect(html).toContain('Connect Codex')
  })

  it('pins the honest send block and voice placeholder in the UI path', () => {
    const html = renderToString(createElement(ZeroBotRoute))
    expect(html).toContain(SEND_BLOCKED_NOTICE)
    expect(html).toContain(VOICE_DISABLED_NOTICE)
    expect(html.match(/disabled=""/g)?.length ?? 0).toBeGreaterThan(0)
  })

  it('starts from the honest unknown bridge state without any probe', () => {
    const html = renderToString(createElement(ZeroBotRoute))
    expect(html).toContain('STATE UNKNOWN')
    expect(html).toContain('Bridge state resolves on first check')
  })

  it('renders the read-only discovery and conversation surfaces', () => {
    const html = renderToString(createElement(ZeroBotRoute))
    expect(html).toContain('REGISTERED PROJECTS')
    expect(html).toContain('CONVERSATION')
    expect(html).toContain('No bridge events in this window yet')
  })
})
