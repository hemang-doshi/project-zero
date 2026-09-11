import { describe, expect, it } from 'vitest'
import { elapsed, formatBytes, formatBytesPerSec, formatGib } from './format'

const GIB = 1024 ** 3
const MIB = 1024 ** 2
const KIB = 1024

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

describe('formatGib (binary units fix)', () => {
  it("formats a 16 GiB machine as '16.00 GB' like Activity Monitor", () => {
    expect(formatGib(16 * GIB)).toBe('16.00 GB')
  })

  it('formats an exact multiple without drift', () => {
    expect(formatGib(8 * GIB)).toBe('8.00 GB')
  })

  it('rounds to two decimals', () => {
    expect(formatGib(11.7374 * GIB)).toBe('11.74 GB')
  })

  it('formats zero as 0.00 GB', () => {
    expect(formatGib(0)).toBe('0.00 GB')
  })

  it('treats non-finite values as 0.00 GB', () => {
    expect(formatGib(Number.NaN)).toBe('0.00 GB')
  })
})

describe('formatBytes (binary autoscale)', () => {
  it('reports plain bytes below a kibibyte', () => {
    expect(formatBytes(512)).toBe('512 B')
  })

  it('uses kibibytes below one mebibyte', () => {
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  it('uses mebibytes below one gibibyte', () => {
    expect(formatBytes(512 * MIB)).toBe('512.0 MB')
  })

  it('uses gibibytes above one gibibyte', () => {
    expect(formatBytes(2.34 * GIB)).toBe('2.34 GB')
  })

  it('clamps negatives to 0 B', () => {
    expect(formatBytes(-10)).toBe('0 B')
  })

  it('clamps non-finite values to 0 B', () => {
    expect(formatBytes(Number.NaN)).toBe('0 B')
  })
})

describe('formatBytesPerSec', () => {
  it('scales the rate with binary units', () => {
    expect(formatBytesPerSec(5.85 * MIB)).toBe('5.8 MB/s')
  })

  it('formats zero rate', () => {
    expect(formatBytesPerSec(0)).toBe('0 B/s')
  })

  it('formats kibibyte rates', () => {
    expect(formatBytesPerSec(20 * KIB)).toBe('20.0 KB/s')
  })
})
