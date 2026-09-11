import { describe, expect, it } from 'vitest'
import { elapsed } from './format'

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
