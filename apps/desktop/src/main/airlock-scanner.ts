export type SensitiveCategory =
  'credential' | 'payment-card' | 'private-key' | 'personal-contact' | 'financial-id'
export type ScanHit = {
  category: SensitiveCategory
  detectorId: string
  confidence: 'high' | 'medium'
  start: number
  end: number
}
export type ScanResult =
  | { state: 'clear'; hits: [] }
  | { state: 'held'; hits: ScanHit[] }
  | { state: 'blocked'; reason: 'too-large' | 'invalid-input' }

const MAX_PROMPT_CHARS = 32_000
const MAX_HITS = 20

function luhn(digits: string): boolean {
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let value = digits.charCodeAt(i) - 48
    if (double) value = value * 2 > 9 ? value * 2 - 9 : value * 2
    sum += value
    double = !double
  }
  return sum % 10 === 0
}

export function scanPrompt(text: unknown): ScanResult {
  if (typeof text !== 'string') return { state: 'blocked', reason: 'invalid-input' }
  if (text.length > MAX_PROMPT_CHARS) return { state: 'blocked', reason: 'too-large' }
  const hits: ScanHit[] = []
  const add = (
    category: SensitiveCategory,
    detectorId: string,
    start: number,
    end: number,
    confidence: 'high' | 'medium' = 'high'
  ): void => {
    if (hits.length < MAX_HITS && !hits.some((h) => start < h.end && end > h.start))
      hits.push({ category, detectorId, confidence, start, end })
  }

  for (const match of text.matchAll(
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]{0,8192}?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g
  )) {
    add('private-key', 'pem-private-key', match.index, match.index + match[0].length)
  }
  for (const match of text.matchAll(
    /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/g
  )) {
    add('credential', 'known-token-prefix', match.index, match.index + match[0].length)
  }
  for (const match of text.matchAll(
    /\b(?:password|passwd|api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*["']?([^\s"';,]{8,})/gi
  )) {
    const value = match[1]
    if (/^(?:inputValue|passwordValue|secretValue|your[_-]?\w+|<[^>]+>)$/i.test(value)) continue
    const start = match.index + match[0].lastIndexOf(value)
    add('credential', 'secret-assignment', start, start + value.length)
  }
  for (const match of text.matchAll(/\bBearer\s+([A-Za-z0-9._~-]{16,})\b/gi)) {
    const value = match[1]
    const start = match.index + match[0].lastIndexOf(value)
    add('credential', 'bearer-token', start, start + value.length)
  }
  for (const match of text.matchAll(/(?:\d[ -]?){13,19}/g)) {
    const digits = match[0].replace(/[^0-9]/g, '')
    if (digits.length < 13 || digits.length > 19 || !luhn(digits)) continue
    const before = text.slice(Math.max(0, match.index - 40), match.index).toLowerCase()
    if (!/(?:card|credit|debit|visa|mastercard|amex|payment|pan)\b/.test(before)) continue
    add(
      'payment-card',
      'contextual-luhn-card',
      match.index,
      match.index + match[0].length,
      'medium'
    )
  }
  for (const match of text.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)) {
    add('personal-contact', 'email-address', match.index, match.index + match[0].length, 'medium')
  }
  for (const match of text.matchAll(
    /\b(?:phone|mobile|contact|tel)\s*[:=]?\s*(\+?\d[\d ()-]{8,18}\d)/gi
  )) {
    const value = match[1]
    const digits = value.replace(/\D/g, '')
    if (digits.length < 10 || digits.length > 15) continue
    const start = match.index + match[0].lastIndexOf(value)
    add('personal-contact', 'contextual-phone', start, start + value.length, 'medium')
  }
  for (const match of text.matchAll(
    /\b(?:account|iban|routing|ssn|tax[_ -]?id)\s*(?:number|no\.?|#|[:=])[:=]?\s*([A-Z0-9 -]{8,34})/gi
  )) {
    const value = match[1].trimEnd()
    if (value.replace(/[^A-Z0-9]/gi, '').length < 8) continue
    const start = match.index + match[0].lastIndexOf(match[1])
    add('financial-id', 'contextual-account-id', start, start + value.length, 'medium')
  }
  hits.sort((a, b) => a.start - b.start)
  return hits.length ? { state: 'held', hits } : { state: 'clear', hits: [] }
}
