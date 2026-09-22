import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { ARTWORK_PIXELS, artworkDataUrl } from './artwork-image'

const crc32 = (bytes: Buffer): number => {
  let crc = 0xffffffff
  for (const b of bytes) {
    crc ^= b
    for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

const parsePng = (
  url: string
): { width: number; height: number; bitDepth: number; colorType: number; pixels: Buffer } => {
  expect(url.startsWith('data:image/png;base64,')).toBe(true)
  const png = Buffer.from(url.slice('data:image/png;base64,'.length), 'base64')
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  expect(png.subarray(0, 8).equals(signature)).toBe(true)
  expect(png.readUInt32BE(8)).toBe(13) // IHDR data length
  expect(png.toString('ascii', 12, 16)).toBe('IHDR')
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  const bitDepth = png[24]
  const colorType = png[25]
  // find IDAT chunk by walking chunks from offset 8
  let offset = 8
  let idat = Buffer.alloc(0)
  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('ascii', offset + 4, offset + 8)
    const data = png.subarray(offset + 8, offset + 8 + length)
    if (type === 'IDAT') idat = Buffer.concat([idat, data])
    offset += 12 + length
  }
  const pixels = inflateSync(idat)
  return { width, height, bitDepth, colorType, pixels }
}

describe('artworkDataUrl', () => {
  it('decodes RGB565 big-endian pixels into a 32x32 RGB PNG data URL', () => {
    const pixels = Buffer.alloc(2048)
    // pixel 0: r=31,g=63,b=31 -> 0xFFFF (0xFF 0xFF big endian)
    pixels.writeUInt8(0xff, 0)
    pixels.writeUInt8(0xff, 1)
    // pixel 1: r=0,g=0,b=0 -> 0x0000
    // pixel 1023 (last): r=1,g=0,b=0 -> 0x0800 (0x08 0x00)
    pixels.writeUInt8(0x08, 2046)
    pixels.writeUInt8(0x00, 2047)
    const url = artworkDataUrl(pixels.toString('base64'))
    const png = parsePng(url as string)
    expect(png.width).toBe(32)
    expect(png.height).toBe(32)
    expect(png.bitDepth).toBe(8)
    expect(png.colorType).toBe(2)
    expect(png.pixels.length).toBe(32 * (32 * 3 + 1))
    // first row, pixel 0 -> white; scanline starts with filter 0
    expect(png.pixels[1]).toBe(255)
    expect(png.pixels[2]).toBe(255)
    expect(png.pixels[3]).toBe(255)
    // first row, pixel 1 -> black
    expect(png.pixels[4]).toBe(0)
    // last row, last pixel -> (8,0,0) 5-bit red scaled
    const lastRow = 31
    const lastPixelIndex = lastRow * (32 * 3 + 1) + 1 + 31 * 3
    expect(png.pixels[lastPixelIndex]).toBe(8)
    expect(png.pixels[lastPixelIndex + 1]).toBe(0)
    expect(png.pixels[lastPixelIndex + 2]).toBe(0)
  })

  it('scales 5-bit and 6-bit channels to 8 bits', () => {
    const pixels = Buffer.alloc(2048)
    // r=15 g=31 b=15 -> (15<<11)|(31<<5)|15 = 0x7FAF
    const value = (15 << 11) | (31 << 5) | 15
    pixels.writeUInt8((value >> 8) & 0xff, 2)
    pixels.writeUInt8(value & 0xff, 3)
    const url = artworkDataUrl(pixels.toString('base64')) as string
    const png = parsePng(url)
    const r = Math.round((15 * 255) / 31)
    const g = Math.round((31 * 255) / 63)
    expect(png.pixels[1 + 3]).toBe(r)
    expect(png.pixels[1 + 4]).toBe(g)
    expect(png.pixels[1 + 5]).toBe(r)
  })

  it('rejects payloads that are not exactly 2048 bytes', () => {
    expect(artworkDataUrl('AAAA')).toBeNull()
    expect(artworkDataUrl(Buffer.alloc(2047).toString('base64'))).toBeNull()
    expect(artworkDataUrl(Buffer.alloc(2049).toString('base64'))).toBeNull()
    expect(artworkDataUrl('!!!')).toBeNull()
  })

  it('keeps the mandated 32x32 pixel count constant', () => {
    expect(ARTWORK_PIXELS).toBe(1024)
    expect(ARTWORK_PIXELS * 2).toBe(2048)
  })

  it('matches the CRC32 of a known input (PNG chunk integrity helper)', () => {
    expect(crc32(Buffer.from('123456789', 'ascii'))).toBe(0xcbf43926)
  })
})
