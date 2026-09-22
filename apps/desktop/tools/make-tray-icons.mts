// Generates the tray companion PNGs as real retina-capable build assets:
// a black alpha-only template glyph (16px + 32px @2x) and a non-template
// fallback rendered from ZERO_TOKENS.brandOrange, parsed from tokens.ts at
// build time so the icon color stays tied to the single token source.
// Emits filter-type-0 RGBA PNGs (stdlib only) so tests can decode pixels.
import { deflateSync } from 'node:zlib'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const tokens = readFileSync(join(appRoot, 'src/shared/tokens.ts'), 'utf8')
const token = tokens.match(/brandOrange:\s*'#([0-9A-Fa-f]{6})'/)
if (token === null) {
  throw new Error('brandOrange token not found in src/shared/tokens.ts')
}
const fallbackColor = token[1]

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

const crc32 = (buf: Buffer): number => {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const chunk = (type: string, data: Buffer): Buffer => {
  const head = Buffer.alloc(4)
  head.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([head, body, crc])
}

const png = (width: number, height: number, raw: Buffer): Buffer =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk(
      'IHDR',
      (() => {
        const b = Buffer.alloc(8)
        b.writeUInt32BE(width)
        b.writeUInt32BE(height, 4)
        return Buffer.concat([b, Buffer.from([8, 6, 0, 0, 0])])
      })()
    ),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])

// Filled circle with a 1px margin and an anti-aliased alpha edge.
const circle = (size: number, [r, g, b]: [number, number, number]): Buffer => {
  const rows: Buffer[] = []
  const center = (size - 1) / 2
  const radius = size / 2 - 1
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4)
    row[0] = 0 // filter type none
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - center, y - center)
      const a = Math.max(0, Math.min(1, radius - d + 0.5))
      const o = 1 + x * 4
      row[o] = r
      row[o + 1] = g
      row[o + 2] = b
      row[o + 3] = Math.round(a * 255)
    }
    rows.push(row)
  }
  return png(size, size, Buffer.concat(rows))
}

const hex = (s: string): [number, number, number] => [
  parseInt(s.slice(0, 2), 16),
  parseInt(s.slice(2, 4), 16),
  parseInt(s.slice(4, 6), 16)
]

const outDir = join(appRoot, 'src/main/assets/tray')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'trayTemplate.png'), circle(16, [0, 0, 0]))
writeFileSync(join(outDir, 'trayTemplate@2x.png'), circle(32, [0, 0, 0]))
writeFileSync(join(outDir, 'trayOrange.png'), circle(16, hex(fallbackColor)))
writeFileSync(join(outDir, 'trayOrange@2x.png'), circle(32, hex(fallbackColor)))
