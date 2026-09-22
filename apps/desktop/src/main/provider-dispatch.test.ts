import { describe, expect, it, vi } from 'vitest'
import { dispatchProviderPrompt } from './provider-dispatch'

const request = {
  provider: 'codex' as const,
  model: 'gpt-5.6-sol',
  text: 'synthetic prompt',
  threadId: 't1'
}
describe('dispatchProviderPrompt', () => {
  it('reads the provider-owned cwd then starts one Codex turn without a daemon projectId', async () => {
    const send = vi.fn(async (method: string) =>
      method === 'thread/read'
        ? { thread: { id: 't1', cwd: '/repo/one/sub' } }
        : { turn: { id: 'turn-1' } }
    )
    const result = await dispatchProviderPrompt(request, {
      codex: { state: 'live', send },
      opencode: { state: 'disconnected', send: vi.fn() },
      openCodeSession: () => null,
      realpath: (path) => path
    })
    expect(result).toEqual({ turnId: 'turn-1' })
    expect(send.mock.calls).toEqual([
      ['thread/read', { threadId: 't1', includeTurns: false }],
      [
        'turn/start',
        {
          threadId: 't1',
          input: [{ type: 'text', text: 'synthetic prompt', text_elements: [] }],
          model: 'gpt-5.6-sol',
          effort: 'medium'
        }
      ]
    ])
  })

  it('blocks a missing or non-absolute Codex cwd without starting a turn', async () => {
    const send = vi.fn(async (method: string, _params: unknown) => {
      void _params
      expect(method).toBe('thread/read')
      return { thread: { id: 't1', cwd: 'relative/path' } }
    })
    const deps = {
      codex: { state: 'live', send },
      opencode: { state: 'disconnected', send: vi.fn() },
      openCodeSession: () => null,
      realpath: (path: string) => path
    }
    await expect(dispatchProviderPrompt(request, deps)).rejects.toThrow('verified cwd')
    expect(send.mock.calls.every(([method]) => method !== 'turn/start')).toBe(true)
  })

  it('loads an existing OpenCode ACP session, selects its advertised model, and waits for prompt completion', async () => {
    const send = vi.fn(async (method: string, _params: unknown) => {
      void _params
      if (method === 'session/load')
        return {
          sessionId: 's1',
          configOptions: [
            {
              id: 'model',
              type: 'select',
              currentValue: 'anthropic/old',
              options: [{ value: 'anthropic/claude-sonnet-4-5' }]
            }
          ]
        }
      if (method === 'session/set_config_option') return { configOptions: [] }
      if (method === 'session/prompt') return { stopReason: 'end_turn' }
      return {}
    })
    const result = await dispatchProviderPrompt(
      { provider: 'opencode', model: 'anthropic/claude-sonnet-4-5', text: 'hello', threadId: 's1' },
      {
        codex: { state: 'disconnected', send: vi.fn() },
        opencode: { state: 'live', send },
        openCodeSession: () => ({ id: 's1', directory: '/repo/one' }),
        realpath: (path) => path
      }
    )
    expect(result.turnId).toMatch(/^ocp-/)
    expect(send.mock.calls.map(([method]) => method)).toEqual([
      'session/load',
      'session/set_config_option',
      'session/prompt'
    ])
    expect(send.mock.calls[1]?.[1]).toMatchObject({
      sessionId: 's1',
      configId: 'model',
      type: 'id',
      value: 'anthropic/claude-sonnet-4-5'
    })
  })

  it('rejects an OpenCode model the active session did not advertise before prompting', async () => {
    const send = vi.fn(async (_method: string, _params: unknown) => {
      void _method
      void _params
      return {
        sessionId: 's1',
        configOptions: [{ id: 'model', options: [{ value: 'allowed/model' }] }]
      }
    })
    await expect(
      dispatchProviderPrompt(
        { provider: 'opencode', model: 'other/model', text: 'hello', threadId: 's1' },
        {
          codex: { state: 'disconnected', send: vi.fn() },
          opencode: { state: 'live', send },
          openCodeSession: () => ({ id: 's1', directory: '/repo/one' }),
          realpath: (path) => path
        }
      )
    ).rejects.toThrow('Model unavailable')
    expect(send.mock.calls.map(([method]) => method)).toEqual(['session/load'])
  })
})
