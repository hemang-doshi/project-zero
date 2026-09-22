import { describe, expect, it } from 'vitest'
import { scanPrompt } from './airlock-scanner'

describe('scanPrompt', () => {
  it.each([
    ['password = "synthetic-secret-123"', 'secret-assignment'],
    ['Authorization: Bearer abcdefghijklmnopqrstuvwxyz123', 'bearer-token'],
    ['sk-abcdefghijklmnopqrstuvwxyz123456', 'known-token-prefix'],
    ['-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----', 'pem-private-key'],
    ['credit card 4111 1111 1111 1111', 'contextual-luhn-card'],
    ['contact me at sample@example.test', 'email-address'],
    ['phone: +1 (415) 555-0101', 'contextual-phone'],
    ['account number: 1234 5678 9012', 'contextual-account-id']
  ])('holds %s', (text, detector) => {
    const result = scanPrompt(text)
    expect(result.state).toBe('held')
    if (result.state === 'held')
      expect(result.hits.some((hit) => hit.detectorId === detector)).toBe(true)
  })

  it.each([
    'version 1.2.3',
    'date 2026-09-22',
    'issue 4111 1111 1111 1111',
    'const password = inputValue',
    'sha256 0123456789abcdef'
  ])('leaves ordinary text clear: %s', (text) => {
    expect(scanPrompt(text)).toEqual({ state: 'clear', hits: [] })
  })

  it('fails closed on invalid or oversized input', () => {
    expect(scanPrompt(null)).toEqual({ state: 'blocked', reason: 'invalid-input' })
    expect(scanPrompt('x'.repeat(32001))).toEqual({ state: 'blocked', reason: 'too-large' })
  })
})
