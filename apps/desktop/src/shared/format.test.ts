import { describe, expect, it } from 'vitest'
import { byteRate, elapsed } from './format'

describe('elapsed', () => {
  it('formats zero as 0:00:00', () => {
    expect(elapsed(0)).toBe('0:00:00')
  })

  it('formats milliseconds as H:MM:SS', () => {
    expect(elapsed(3_723_456)).toBe('1:02:03')
  })

  it('clamps negatives to 0:00:00', () => {
    expect(elapsed(-1_500)).toBe('0:00:00')
  })

  it('clamps non-finite values to 0:00:00', () => {
    expect(elapsed(Number.NaN)).toBe('0:00:00')
  })

  it('drops sub-second remainder', () => {
    expect(elapsed(59_999)).toBe('0:00:59')
  })

  it('keeps hours unbounded above 99', () => {
    expect(elapsed(100 * 3_600_000)).toBe('100:00:00')
  })
})

describe('byteRate', () => {
  it('formats bytes per second tiers', () => {
    expect(byteRate(500)).toBe('500 B/s')
    expect(byteRate(1_500)).toBe('1.5 KB/s')
    expect(byteRate(2_400_000)).toBe('2.4 MB/s')
    expect(byteRate(1_250_000_000)).toBe('1.3 GB/s')
  })
})
