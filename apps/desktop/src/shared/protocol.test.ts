import { describe, it, expect } from 'vitest'
import { SSEParser, parseRuntimeChange } from './protocol'

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('SSEParser', () => {
  it('parses event+data split across chunks', () => {
    const p = new SSEParser()
    const a = p.append(enc('event: runtime.changed\nda'))
    const b = p.append(enc('ta: {"revision":13,"domains":["spotify"],"timestamp":"t"}\n\n'))
    expect([...a, ...b]).toEqual([
      { name: 'runtime.changed', data: '{"revision":13,"domains":["spotify"],"timestamp":"t"}' }
    ])
  })
  it('joins multi-line data with \\n and emits on blank line', () => {
    const p = new SSEParser()
    const out = p.append(enc('data: one\ndata: two\n\n'))
    expect(out).toEqual([{ name: 'message', data: 'one\ntwo' }])
  })
  it('handles CRLF and skips comment lines', () => {
    const p = new SSEParser()
    const out = p.append(
      enc(': ping\r\nevent: keepalive\r\ndata: {"revision":1,"domains":[],"timestamp":"t"}\r\n\r\n')
    )
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('keepalive')
  })
  it('throws when a single event exceeds the byte cap', () => {
    const p = new SSEParser()
    expect(() => p.append(enc('data: ' + 'x'.repeat(70_000)))).toThrow()
  })
})

describe('parseRuntimeChange', () => {
  it('accepts the three known event names and bounded domains', () => {
    const change = parseRuntimeChange({
      name: 'ready',
      data: '{"revision":9,"domains":[],"timestamp":"t"}'
    })
    expect(change).toEqual({ name: 'ready', revision: 9, domains: [], timestamp: 't' })
  })
  it('rejects unknown names and oversized domains', () => {
    expect(() => parseRuntimeChange({ name: 'mystery', data: '{}' })).toThrow()
    expect(() =>
      parseRuntimeChange({
        name: 'keepalive',
        data: JSON.stringify({ revision: 1, domains: new Array(101).fill('x'), timestamp: 't' })
      })
    ).toThrow()
  })
})
