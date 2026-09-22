import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { scanPrompt, type ScanResult } from './airlock-scanner'

export type PromptDestination = { provider: 'codex' | 'opencode'; model: string; threadId: string }
export type PromptRequest = PromptDestination & { text: string }
export type PromptDecision =
  | { state: 'held'; holdId: string; categories: string[]; positions: number[] }
  | { state: 'accepted'; turnId: string }
  | {
      state: 'blocked'
      reason:
        'invalid-request' | 'scanner-unavailable' | 'expired-or-changed' | 'dispatch-unavailable'
    }

type Hold = {
  request: PromptRequest
  digest: string
  expiresAt: number
  categories: string[]
  positions: number[]
}

export class PromptGateway {
  private readonly key = randomBytes(32)
  private readonly holds = new Map<string, Hold>()

  constructor(
    private readonly dispatch: (request: PromptRequest) => Promise<{ turnId: string }>,
    private readonly scan: (text: unknown) => ScanResult = scanPrompt,
    private readonly now: () => number = Date.now
  ) {}

  private digest(request: PromptRequest): string {
    return createHmac('sha256', this.key)
      .update(JSON.stringify([request.text, request.provider, request.model, request.threadId]))
      .digest('hex')
  }

  private valid(request: PromptRequest): boolean {
    return (
      typeof request.text === 'string' &&
      request.text.trim() !== '' &&
      Buffer.byteLength(request.text, 'utf8') <= 32_000 &&
      (request.provider === 'codex' || request.provider === 'opencode') &&
      typeof request.model === 'string' &&
      request.model.length > 0 &&
      request.model.length <= 120 &&
      typeof request.threadId === 'string' &&
      request.threadId.length > 0 &&
      request.threadId.length <= 120
    )
  }

  async submit(request: PromptRequest): Promise<PromptDecision> {
    if (!this.valid(request)) return { state: 'blocked', reason: 'invalid-request' }
    let scan: ScanResult
    try {
      scan = this.scan(request.text)
    } catch {
      return { state: 'blocked', reason: 'scanner-unavailable' }
    }
    if (scan.state === 'blocked') return { state: 'blocked', reason: 'scanner-unavailable' }
    if (scan.state === 'held') {
      for (const [id, hold] of this.holds) {
        if (this.now() >= hold.expiresAt) this.holds.delete(id)
      }
      while (this.holds.size >= 8) this.holds.delete(this.holds.keys().next().value as string)
      const holdId = randomUUID()
      const categories = Array.from(new Set(scan.hits.map((hit) => hit.category)))
      const positions = scan.hits.map((hit) => hit.start + 1)
      this.holds.set(holdId, {
        request: { ...request },
        digest: this.digest(request),
        expiresAt: this.now() + 120_000,
        categories,
        positions
      })
      return { state: 'held', holdId, categories, positions }
    }
    return this.dispatchOnce(request)
  }

  async decide(
    holdId: string,
    action: 'cancel' | 'send-once',
    current: PromptRequest
  ): Promise<PromptDecision> {
    const hold = this.holds.get(holdId)
    this.holds.delete(holdId) // consume before await; concurrent/replayed decisions cannot dispatch
    if (!hold || action === 'cancel') return { state: 'blocked', reason: 'expired-or-changed' }
    if (
      !this.valid(current) ||
      this.now() >= hold.expiresAt ||
      this.digest(current) !== hold.digest
    ) {
      return { state: 'blocked', reason: 'expired-or-changed' }
    }
    return this.dispatchOnce(hold.request)
  }

  private async dispatchOnce(request: PromptRequest): Promise<PromptDecision> {
    try {
      const result = await this.dispatch(request)
      if (typeof result.turnId !== 'string' || result.turnId === '')
        throw new Error('Invalid acceptance')
      return { state: 'accepted', turnId: result.turnId }
    } catch {
      // Provider errors may echo sensitive prompt text. Never forward them.
      return { state: 'blocked', reason: 'dispatch-unavailable' }
    }
  }
}
