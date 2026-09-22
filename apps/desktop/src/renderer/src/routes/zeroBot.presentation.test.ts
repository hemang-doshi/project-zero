import { describe, expect, it } from 'vitest'
import {
  countPathParts,
  formatViaAttribution,
  summarizeExecItem,
  summarizeToolItem,
  streamingLabel,
  turnItemCounts,
  projectErrorMessage
} from './zeroBot.presentation'
import type { ChatItem } from './chat.model'

it('explains a missing Zero daemon without hiding independent chat history', () => {
  expect(projectErrorMessage(new Error('connect ENOENT /Users/me/Library/Application Support/ProjectZero/zero.sock'))).toContain('Codex and OpenCode history')
})

describe('formatViaAttribution', () => {
  it('keeps the Zero author voice with muted verbatim provider attribution', () => {
    expect(formatViaAttribution('codex', 'gpt-5.6-sol')).toEqual({
      author: 'Zero',
      via: 'via Codex · gpt-5.6-sol'
    })
  })

  it('attributes opencode turns without inventing model names', () => {
    expect(formatViaAttribution('opencode', 'muse-spark-1.3')).toEqual({
      author: 'Zero',
      via: 'via OpenCode · muse-spark-1.3'
    })
  })

  it('omits the via line when no model is known', () => {
    expect(formatViaAttribution('codex', null)).toEqual({ author: 'Zero', via: null })
  })
})

describe('summarizeToolItem', () => {
  it('summarizes multi-file changes semantically', () => {
    expect(
      summarizeToolItem({
        kind: 'tool',
        tool: 'fileChange',
        server: null,
        detail: 'src/a.ts · src/b.ts · src/c.ts · src/d.ts',
        result: null,
        status: 'completed',
        id: 't1'
      })
    ).toBe('Modified 4 files')
  })

  it('summarizes file reads semantically', () => {
    expect(
      summarizeToolItem({
        kind: 'tool',
        tool: 'read_file',
        server: 'fs',
        detail: '{"path":"/a.txt"} · {"path":"/b.txt"}',
        result: 'bodies',
        status: 'completed',
        id: 't2'
      })
    ).toBe('Read 2 files')
    expect(
      summarizeToolItem({
        kind: 'tool',
        tool: 'read_file',
        server: 'fs',
        detail: '{"path":"/a.txt"}',
        result: 'body',
        status: 'completed',
        id: 't2b'
      })
    ).toBe('Read 1 file')
  })

  it('summarizes web searches with the query', () => {
    expect(
      summarizeToolItem({
        kind: 'tool',
        tool: 'webSearch',
        server: null,
        detail: 'codex app-server thread schema',
        result: null,
        status: '',
        id: 't3'
      })
    ).toBe('Searched “codex app-server thread schema”')
  })

  it('falls back to the verbatim tool name, never an invented verb', () => {
    expect(
      summarizeToolItem({
        kind: 'tool',
        tool: 'mystery_widget',
        server: null,
        detail: '',
        result: null,
        status: '',
        id: 't4'
      })
    ).toBe('mystery_widget')
  })
})

describe('summarizeExecItem', () => {
  it('summarizes a finished run with its exit code', () => {
    expect(
      summarizeExecItem({
        kind: 'exec',
        command: 'npm test',
        cwd: '/repo',
        output: 'all green',
        exitCode: 0,
        status: 'completed',
        id: 'e1'
      })
    ).toBe('Ran npm test · EXIT 0')
  })

  it('marks an in-flight execution as running', () => {
    expect(
      summarizeExecItem({
        kind: 'exec',
        command: 'npm test',
        cwd: '',
        output: null,
        exitCode: null,
        status: 'inProgress',
        id: 'e2'
      })
    ).toBe('Running npm test')
  })
})

describe('streamingLabel', () => {
  it('reports running while an execution has no exit code', () => {
    const items: ChatItem[] = [
      { kind: 'message', role: 'user', text: 'hi', id: 'u1' },
      {
        kind: 'exec',
        command: 'npm test',
        cwd: '',
        output: '…',
        exitCode: null,
        status: 'inProgress',
        id: 'e1'
      }
    ]
    expect(streamingLabel(items)).toBe('Running…')
  })

  it('reports inspecting while reasoning is the latest evidence', () => {
    const items: ChatItem[] = [
      { kind: 'message', role: 'user', text: 'hi', id: 'u1' },
      { kind: 'thinking', text: 'hmm', summary: 'plan', id: 'r1' }
    ]
    expect(streamingLabel(items)).toBe('Inspecting…')
  })

  it('reports writing while tool work is in progress', () => {
    const items: ChatItem[] = [
      {
        kind: 'tool',
        tool: 'read_file',
        server: null,
        detail: '',
        result: null,
        status: 'inProgress',
        id: 't1'
      }
    ]
    expect(streamingLabel(items)).toBe('Working…')
  })

  it('stays honestly idle on settled transcripts', () => {
    const items: ChatItem[] = [
      { kind: 'message', role: 'user', text: 'hi', id: 'u1' },
      { kind: 'message', role: 'assistant', text: 'done', id: 'a1' }
    ]
    expect(streamingLabel(items)).toBeNull()
    expect(streamingLabel([])).toBeNull()
  })
})

describe('turnItemCounts', () => {
  it('counts messages, thinking, tools and execs', () => {
    const items: ChatItem[] = [
      { kind: 'message', role: 'user', text: 'hi', id: 'u1' },
      { kind: 'message', role: 'assistant', text: 'yo', id: 'a1' },
      { kind: 'thinking', text: '', summary: '', id: 'r1' },
      { kind: 'tool', tool: 'x', server: null, detail: '', result: null, status: '', id: 't1' },
      { kind: 'exec', command: 'ls', cwd: '', output: null, exitCode: 0, status: '', id: 'e1' },
      { kind: 'notice', text: 'plan', id: 'n1' }
    ]
    expect(turnItemCounts(items)).toEqual({ messages: 2, thinking: 1, tools: 2, notices: 1 })
  })
})

describe('countPathParts', () => {
  it('counts middle-dot separated paths', () => {
    expect(countPathParts('a.ts · b.ts')).toBe(2)
    expect(countPathParts('')).toBe(0)
  })
})
