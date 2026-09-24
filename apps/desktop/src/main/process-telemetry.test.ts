import { describe, expect, it } from 'vitest'
import { parseProcessRows } from './process-telemetry'

describe('parseProcessRows', () => {
  it('parses CPU and resident memory, strips paths, and keeps the top ten CPU rows', () => {
    const rows = Array.from(
      { length: 12 },
      (_, i) => `${i + 1} ${i * 2}.5 ${100 + i} /Applications/Editor ${i}`
    )
    const parsed = parseProcessRows(rows.join('\n'))
    expect(parsed).toHaveLength(10)
    expect(parsed[0]).toMatchObject({
      pid: 12,
      name: 'Editor 11',
      cpuPercent: 22.5,
      residentBytes: 113664
    })
  })

  it('keeps unavailable counters null and discards malformed rows', () => {
    expect(parseProcessRows('bad row\n22 nope nope /usr/bin/example')).toEqual([
      { pid: 22, name: 'example', cpuPercent: null, residentBytes: null }
    ])
  })
})
