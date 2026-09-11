import { describe, it, expect } from 'vitest'
import { badgeFor } from './cockpit'

describe('badgeFor', () => {
  const now = 1_000_000
  it('live when fresh snapshot and live state', () => {
    expect(badgeFor('live', now, now, 5_000)).toBe('LIVE')
  })
  it('stale when snapshot ages past max age while live', () => {
    expect(badgeFor('live', now, now - 6_000, 5_000)).toBe('STALE')
  })
  it('reconnecting/offline reflect state', () => {
    expect(badgeFor('reconnecting', now, now, 5_000)).toBe('RECONNECTING')
    expect(badgeFor('offline', now, null, 5_000)).toBe('OFFLINE')
  })
})
