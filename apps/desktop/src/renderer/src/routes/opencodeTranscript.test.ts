import { describe, expect, it } from 'vitest'
import { parseOpenCodeTranscript } from './opencodeTranscript'

describe('OpenCode session export', () => {
  it('renders messages, reasoning, shell runs and tool calls from an exported session', () => {
    const result = parseOpenCodeTranscript({
      info: { id: 'ses_1' },
      messages: [
        { info: { id: 'm1', role: 'user' }, parts: [{ id: 'p1', type: 'text', text: 'Fix it' }] },
        {
          info: { id: 'm2', role: 'assistant' },
          parts: [
            { id: 'p2', type: 'reasoning', text: 'Check the failure' },
            {
              id: 'p3',
              type: 'tool',
              tool: 'bash',
              state: {
                status: 'completed',
                input: { command: 'pwd' },
                output: '/tmp',
                metadata: { exitCode: 0 }
              }
            },
            {
              id: 'p4',
              type: 'tool',
              tool: 'read',
              state: { status: 'completed', input: { filePath: 'a.ts' }, output: 'content' }
            },
            { id: 'p5', type: 'text', text: 'Done' }
          ]
        }
      ]
    })
    expect(result.items.map((item) => item.kind)).toEqual([
      'message',
      'thinking',
      'exec',
      'tool',
      'message'
    ])
    expect(result.items[2]).toMatchObject({ kind: 'exec', command: 'pwd', output: '/tmp' })
    expect(result.items[3]).toMatchObject({
      kind: 'tool',
      tool: 'read',
      detail: '{"filePath":"a.ts"}'
    })
  })

  it('rejects malformed export and bounds visible history', () => {
    expect(parseOpenCodeTranscript(null).items).toEqual([])
    const messages = Array.from({ length: 405 }, (_, i) => ({
      info: { id: `m${i}`, role: 'user' },
      parts: [{ type: 'text', text: `${i}` }]
    }))
    const result = parseOpenCodeTranscript({ messages })
    expect(result.items).toHaveLength(400)
    expect(result.dropped).toBe(5)
  })

  it('reports verified session usage and cost from the local store projection', () => {
    const result = parseOpenCodeTranscript({
      info: { tokens_input: 120, tokens_output: 45, tokens_reasoning: 10, cost: 0.25 },
      messages: []
    })
    expect(result.usage).toEqual({ input: 120, output: 45, reasoning: 10, cost: 0.25 })
  })
})
