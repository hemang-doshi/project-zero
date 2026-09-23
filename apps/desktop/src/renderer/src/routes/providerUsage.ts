export type VerifiedUsage = {
  source: 'codex-live' | 'opencode-saved'
  threadId: string
  observedAt: number
  input: number | null
  cachedInput: number | null
  output: number | null
  reasoningOutput: number | null
  total: number | null
  cost: number | null
}

type RecordValue = Record<string, unknown>
const record = (value: unknown): RecordValue | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as RecordValue)
    : null
const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
const amount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

export function codexUsageFromEvent(value: unknown, observedAt: number): VerifiedUsage | null {
  const root = record(value)
  if (typeof root?.threadId !== 'string' || root.threadId === '') return null
  const total = record(record(root.tokenUsage)?.total)
  if (total === null) return null
  return {
    source: 'codex-live',
    threadId: root.threadId,
    observedAt,
    input: count(total.inputTokens),
    cachedInput: count(total.cachedInputTokens),
    output: count(total.outputTokens),
    reasoningOutput: count(total.reasoningOutputTokens),
    total: count(total.totalTokens),
    cost: null
  }
}

function sumAll(values: Array<number | null>): number | null {
  return values.length > 0 && values.every((value) => value !== null)
    ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null
}

export function openCodeUsageFromSession(value: unknown, observedAt: number): VerifiedUsage | null {
  const root = record(value)
  const session = record(root?.info)
  if (typeof session?.id !== 'string' || session.id === '') return null
  const messages = Array.isArray(root?.messages) ? root.messages : []
  const assistant = messages
    .map((entry) => record(record(entry)?.info))
    .filter((info): info is RecordValue => info?.role === 'assistant')
  const tokens = assistant.map((info) => record(info.tokens))
  const input = sumAll(tokens.map((value) => count(value?.input)))
  const cachedInput = sumAll(tokens.map((value) => count(record(value?.cache)?.read)))
  const output = sumAll(tokens.map((value) => count(value?.output)))
  const reasoningOutput = sumAll(tokens.map((value) => count(value?.reasoning)))
  const total = sumAll(tokens.map((value) => count(value?.total)))
  const cost = sumAll(assistant.map((info) => amount(info.cost)))
  if ([input, cachedInput, output, reasoningOutput, total, cost].every((field) => field === null))
    return null
  return {
    source: 'opencode-saved',
    threadId: session.id,
    observedAt,
    input,
    cachedInput,
    output,
    reasoningOutput,
    total,
    cost
  }
}
