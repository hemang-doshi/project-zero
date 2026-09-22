import { describe, expect, it, vi } from 'vitest'
import { dispatchProviderPrompt } from './provider-dispatch'

const request = {
  provider: 'codex' as const,
  model: 'gpt-5.6-sol',
  text: 'synthetic prompt',
  threadId: 't1'
}
const project = { id: 'p1', name: 'Project One', path: '/repo/one' }

describe('dispatchProviderPrompt', () => {
  it('reads binding, verifies registered cwd, then starts one Codex turn with pinned schema', async () => {
    const send = vi.fn(async (method: string) =>
      method === 'thread/read'
        ? { thread: { id: 't1', projectId: 'p1', cwd: '/repo/one/sub' } }
        : { turn: { id: 'turn-1' } }
    )
    const result = await dispatchProviderPrompt(request, {
      codex: { state: 'live', send },
      projects: async () => [project],
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

  it('blocks missing binding, path escape and unsupported OpenCode without starting a turn', async () => {
    const send = vi.fn(async (method: string) => {
      expect(method).toBe('thread/read')
      return { thread: { id: 't1', projectId: 'p1', cwd: '/outside' } }
    })
    const deps = {
      codex: { state: 'live', send },
      projects: async () => [project],
      realpath: (path: string) => path
    }
    await expect(dispatchProviderPrompt(request, deps)).rejects.toThrow(
      'outside registered project'
    )
    await expect(
      dispatchProviderPrompt({ ...request, provider: 'opencode' }, deps)
    ).rejects.toThrow('unavailable')
    expect(send.mock.calls.every(([method]) => method !== 'turn/start')).toBe(true)
  })
})
