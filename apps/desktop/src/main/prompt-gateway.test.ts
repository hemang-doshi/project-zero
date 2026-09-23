import { describe, expect, it, vi } from 'vitest'
import { PromptGateway } from './prompt-gateway'
import { ProviderDispatchError } from './provider-dispatch'

const safe = {
  text: 'hello world',
  provider: 'codex' as const,
  model: 'test-model',
  threadId: 't1'
}
const sensitive = { ...safe, text: 'password = "synthetic-secret-123"' }

describe('PromptGateway', () => {
  it('dispatches a clean prompt exactly once', async () => {
    const dispatch = vi.fn(async () => ({ turnId: 'turn-1' }))
    const gateway = new PromptGateway(dispatch)
    expect((await gateway.submit(safe)).state).toBe('accepted')
    expect(dispatch).toHaveBeenCalledOnce()
  })

  it('screens a local draft before any provider session is created', async () => {
    const dispatch = vi.fn(async () => ({ turnId: 'turn-1', threadId: 'new-thread' }))
    const gateway = new PromptGateway(dispatch)
    const draft = {
      provider: 'codex' as const,
      model: 'test-model',
      cwd: '/repo/one',
      draftId: 'draft-1',
      text: 'password = synthetic-secret-123'
    }
    const held = await gateway.submit(draft)
    expect(held.state).toBe('held')
    expect(dispatch).not.toHaveBeenCalled()
    if (held.state !== 'held') return
    expect(await gateway.decide(held.holdId, 'cancel', draft)).toEqual({
      state: 'blocked',
      reason: 'expired-or-changed'
    })
    expect(dispatch).not.toHaveBeenCalled()
    const clean = await gateway.submit({ ...draft, text: 'hello world' })
    expect(clean).toEqual({ state: 'accepted', turnId: 'turn-1', threadId: 'new-thread' })
  })

  it('returns a bounded unavailable-thread reason when Codex cannot resume a thread', async () => {
    const gateway = new PromptGateway(async () => {
      throw new ProviderDispatchError('thread-unavailable')
    })
    expect(await gateway.submit(safe)).toEqual({
      state: 'blocked',
      reason: 'thread-unavailable'
    })
  })

  it('holds sensitive text and consumes one authorization atomically', async () => {
    const dispatch = vi.fn(async () => ({ turnId: 'turn-1' }))
    const gateway = new PromptGateway(dispatch)
    const held = await gateway.submit(sensitive)
    expect(held.state).toBe('held')
    expect(dispatch).not.toHaveBeenCalled()
    if (held.state !== 'held') return
    expect(JSON.stringify(held)).not.toContain('synthetic-secret')
    const [first, replay] = await Promise.all([
      gateway.decide(held.holdId, 'send-once', sensitive),
      gateway.decide(held.holdId, 'send-once', sensitive)
    ])
    expect([first.state, replay.state].sort()).toEqual(['accepted', 'blocked'])
    expect(dispatch).toHaveBeenCalledOnce()
  })

  it('rejects edit, provider switch, expiry, scanner errors and leaked provider errors', async () => {
    const dispatch = vi.fn(async () => {
      throw new Error(sensitive.text)
    })
    const gateway = new PromptGateway(dispatch, undefined, () => 0)
    const held = await gateway.submit(sensitive)
    if (held.state !== 'held') throw new Error('fixture must hold')
    expect(
      (await gateway.decide(held.holdId, 'send-once', { ...sensitive, model: 'changed' })).state
    ).toBe('blocked')
    expect(dispatch).not.toHaveBeenCalled()
    const failed = await gateway.submit(safe)
    expect(failed).toEqual({ state: 'blocked', reason: 'dispatch-unavailable' })
    expect(JSON.stringify(failed)).not.toContain(sensitive.text)
    const broken = new PromptGateway(dispatch, () => {
      throw new Error(sensitive.text)
    })
    expect(await broken.submit(sensitive)).toEqual({
      state: 'blocked',
      reason: 'scanner-unavailable'
    })
  })

  it('caps outstanding sensitive holds and expires old grants', async () => {
    const dispatch = vi.fn(async () => ({ turnId: 'turn-1' }))
    const gateway = new PromptGateway(dispatch)
    const ids: string[] = []
    for (let index = 0; index < 9; index++) {
      const held = await gateway.submit({ ...sensitive, text: `${sensitive.text}${index}` })
      if (held.state !== 'held') throw new Error('fixture must hold')
      ids.push(held.holdId)
    }
    expect(
      await gateway.decide(ids[0], 'send-once', { ...sensitive, text: `${sensitive.text}0` })
    ).toEqual({ state: 'blocked', reason: 'expired-or-changed' })
    expect(dispatch).not.toHaveBeenCalled()
  })
})
