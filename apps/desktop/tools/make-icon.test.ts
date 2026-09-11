// Pins the packaging icon pipeline (Task 16): make-icon.sh renders the
// supplied Stitch app icon into a valid multi-size icns and regenerates the
// tray companion assets as real retina-capable PNGs whose fallback color is
// tied to ZERO_TOKENS.brandOrange at build time.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { beforeAll, describe, expect, it } from 'vitest'

const APP = join(__dirname, '..')

const idat = (b: Buffer): Buffer => {
  const parts: Buffer[] = []
  let o = 8
  while (o < b.length) {
    const len = b.readUInt32BE(o)
    const type = b.subarray(o + 4, o + 8).toString('ascii')
    if (type === 'IDAT') parts.push(b.subarray(o + 8, o + 8 + len))
    o += 12 + len
  }
  return Buffer.concat(parts)
}

// The generator emits filter-type-0 RGBA PNGs, so pixels decode directly.
const pngPixel = (file: string, x: number, y: number): [number, number, number, number] => {
  const b = readFileSync(file)
  expect(b.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const width = b.readUInt32BE(16)
  const raw = inflateSync(idat(b))
  const stride = 1 + width * 4
  const o = y * stride + 1 + x * 4
  return [raw[o], raw[o + 1], raw[o + 2], raw[o + 3]]
}

describe('make-icon.sh', () => {
  let out: string
  beforeAll(() => {
    out = mkdtempSync(join(tmpdir(), 'zero-icon-'))
    execFileSync('sh', [join(APP, 'tools/make-icon.sh'), '--out', out], { cwd: APP })
  })

  it('renders a valid multi-size icns from the Stitch app icon', () => {
    const icns = join(out, 'ProjectZero.icns')
    expect(existsSync(icns)).toBe(true)
    const b = readFileSync(icns)
    expect(b.subarray(0, 4).toString('ascii')).toBe('icns')
    expect(b.length).toBeGreaterThan(10_000)
  })

  it('generates real 16/32 retina tray template assets', () => {
    const tray = join(APP, 'src/main/assets/tray')
    const dims = (file: string): { width: number; height: number } => {
      const b = readFileSync(file)
      return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
    }
    expect(dims(join(tray, 'trayTemplate.png'))).toEqual({ width: 16, height: 16 })
    expect(dims(join(tray, 'trayTemplate@2x.png'))).toEqual({ width: 32, height: 32 })
    expect(dims(join(tray, 'trayOrange.png'))).toEqual({ width: 16, height: 16 })
    expect(dims(join(tray, 'trayOrange@2x.png'))).toEqual({ width: 32, height: 32 })
  })

  it('renders the template as a black alpha-only glyph', () => {
    const tray = join(APP, 'src/main/assets/tray')
    expect(pngPixel(join(tray, 'trayTemplate.png'), 8, 8)).toEqual([0, 0, 0, 255])
    expect(pngPixel(join(tray, 'trayTemplate.png'), 0, 0)[3]).toBe(0)
  })

  it('ties the fallback tray color to the brandOrange token at build time', () => {
    const tokens = readFileSync(join(APP, 'src/shared/tokens.ts'), 'utf8')
    const token = tokens.match(/brandOrange:\s*'#([0-9A-Fa-f]{6})'/)
    expect(token).not.toBeNull()
    const tray = join(APP, 'src/main/assets/tray')
    const [r, g, b] = pngPixel(join(tray, 'trayOrange.png'), 8, 8)
    expect([r, g, b]).toEqual([
      parseInt(token![1].slice(0, 2), 16),
      parseInt(token![1].slice(2, 4), 16),
      parseInt(token![1].slice(4, 6), 16)
    ])
  })
})
