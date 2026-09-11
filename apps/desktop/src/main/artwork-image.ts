import { deflateSync } from 'node:zlib'

// The daemon caches Spotify artwork as negotiated 32x32 RGB565
// (core/runtime/integrations.go artwork ingest, Swift Artwork.rgb565): 2048
// bytes, 2 per pixel, BIG-endian (high byte first). The desk display firmware
// renders those bytes directly; the desktop renders the cached asset by
// converting to a PNG data URL so the renderer's CSP (img-src data:) needs no
// new scheme. Encoding here is deterministic: PNG IHDR/IDAT/IEND with stored
// (uncompressed) deflate blocks — 3168 raw bytes fit in one block.

export const ARTWORK_SIZE = 32
export const ARTWORK_PIXELS = ARTWORK_SIZE * ARTWORK_SIZE
export const ARTWORK_BYTES = ARTWORK_PIXELS * 2

const SIGNATURE = Buffer.from([137, 0x50, 0x4e, 0x47, 13, 10, 26, 10])

const crcTable = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[i] = c >>> 0
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const b of data) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), 4 + body.length)
  return out
}

// RGB565 -> 8-bit RGB channel expansion, matching the Swift encoder's 5/6-bit
// loss round-trip ((v*255+31)/63 style rounding is not required; scale by the
// channel max is the visual equivalent at 32x32 cover size).
function pixel(p: number): [number, number, number] {
  const r = (p >> 11) & 0x1f
  const g = (p >> 5) & 0x3f
  const b = p & 0x1f
  return [(r * 255) / 31, (g * 255) / 63, (b * 255) / 31].map(Math.round) as [
    number,
    number,
    number
  ]
}

export function artworkDataUrl(base64: string): string | null {
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.length !== ARTWORK_BYTES) return null
  const stride = ARTWORK_SIZE * 3 + 1
  const raw = Buffer.alloc(ARTWORK_SIZE * stride)
  for (let y = 0; y < ARTWORK_SIZE; y++) {
    raw[y * stride] = 0 // filter type none
    for (let x = 0; x < ARTWORK_SIZE; x++) {
      const index = (y * ARTWORK_SIZE + x) * 2
      const p = (bytes[index] << 8) | bytes[index + 1]
      const [r, g, b] = pixel(p)
      const at = y * stride + 1 + x * 3
      raw[at] = r
      raw[at + 1] = g
      raw[at + 2] = b
    }
  }
  // PNG IDAT carries a zlib stream (header + stored deflate blocks + adler).
  const stored = deflateSync(raw, { level: 0 })
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(ARTWORK_SIZE, 0)
  ihdr.writeUInt32BE(ARTWORK_SIZE, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type RGB
  const png = Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', stored),
    chunk('IEND', Buffer.alloc(0))
  ])
  return `data:image/png;base64,${png.toString('base64')}`
}
