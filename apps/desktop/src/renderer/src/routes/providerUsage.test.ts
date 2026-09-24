import { describe, expect, it } from 'vitest'
import { codexUsageFromEvent, formatProviderCost, openCodeUsageFromSession } from './providerUsage'

describe('provider usage', () => {
  it('formats only provider-reported cost precision without adding a currency', () => {
    expect(formatProviderCost(Number('2.7237485199999993'))).toBe('2.723749')
    expect(formatProviderCost(0)).toBe('0.00')
    expect(formatProviderCost(null)).toBeNull()
  })

  it('parses Codex thread totals without inventing cost or missing fields', () => {
    expect(
      codexUsageFromEvent(
        {
          threadId: 't1',
          tokenUsage: {
            total: {
              inputTokens: 100,
              cachedInputTokens: 20,
              outputTokens: 40,
              reasoningOutputTokens: 10,
              totalTokens: 140
            }
          }
        },
        123
      )
    ).toEqual({
      source: 'codex-live',
      threadId: 't1',
      observedAt: 123,
      input: 100,
      cachedInput: 20,
      output: 40,
      reasoningOutput: 10,
      total: 140,
      cost: null
    })
    expect(
      codexUsageFromEvent({ threadId: 't2', tokenUsage: { total: { inputTokens: 2 } } }, 124)
    ).toMatchObject({
      threadId: 't2',
      input: 2,
      output: null,
      total: null,
      cost: null
    })
    expect(codexUsageFromEvent({ threadId: '', tokenUsage: { total: {} } }, 1)).toBeNull()
  })

  it('sums saved OpenCode assistant usage and preserves unknown cost', () => {
    expect(
      openCodeUsageFromSession(
        {
          info: { id: 's1' },
          messages: [
            { info: { role: 'user' } },
            {
              info: {
                role: 'assistant',
                tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 3 } },
                cost: 0.01
              }
            },
            {
              info: {
                role: 'assistant',
                tokens: { input: 20, output: 6, reasoning: 1, cache: { read: 5 } },
                cost: 0.02
              }
            }
          ]
        },
        456
      )
    ).toEqual({
      source: 'opencode-saved',
      threadId: 's1',
      observedAt: 456,
      input: 30,
      cachedInput: 8,
      output: 10,
      reasoningOutput: 3,
      total: null,
      cost: 0.03
    })
    expect(
      openCodeUsageFromSession(
        {
          info: { id: 's2' },
          messages: [{ info: { role: 'assistant', tokens: { input: 3 } } }]
        },
        457
      )
    ).toMatchObject({ input: 3, output: null, cost: null })
  })
})
