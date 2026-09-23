import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  createWallpaperImageHandler,
  ensureManagedWallpaper,
  importWallpaper
} from './wallpaper-image'

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

const fileFetchFromDisk = async (fileUrl: string): Promise<Response> => {
  const file = decodeURIComponent(new URL(fileUrl).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  const bytes = await fs.promises.readFile(file)
  return new Response(new Uint8Array(bytes), {
    headers: { 'content-type': 'image/png' }
  })
}

let tempFile: string | null = null

afterEach(() => {
  if (tempFile) {
    fs.rmSync(tempFile, { force: true })
    tempFile = null
  }
})

const writeTempImage = (): string => {
  tempFile = path.join(os.tmpdir(), `zero-img-test-${process.pid}.png`)
  fs.writeFileSync(tempFile, PNG_BYTES)
  return tempFile
}

const request = (p: string): Request => ({ url: p }) as unknown as Request

describe('zero-img protocol handler', () => {
  it('serves a real image file from tmpdir', async () => {
    const file = writeTempImage()
    const handler = createWallpaperImageHandler(fileFetchFromDisk)
    const res = await handler(request(`zero-img://local/${encodeURIComponent(file)}`))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.equals(PNG_BYTES)).toBe(true)
  })

  it('rejects non-image extensions without touching the filesystem', async () => {
    const fileFetch = vi.fn(() => Promise.resolve(new Response('', { status: 200 })))
    const handler = createWallpaperImageHandler(fileFetch)
    const res = await handler(request('zero-img://local/%2Ftmp%2Fnotes.txt'))
    expect(res.status).toBe(403)
    expect(fileFetch).not.toHaveBeenCalled()
  })

  it('fails soft with 404 on an unparseable path', async () => {
    const fileFetch = vi.fn(() => Promise.resolve(new Response('', { status: 200 })))
    const handler = createWallpaperImageHandler(fileFetch)
    const res = await handler(request('zero-img://local/%zz'))
    expect(res.status).toBe(404)
    expect(fileFetch).not.toHaveBeenCalled()
  })
})

describe('managed wallpaper import', () => {
  it('keeps a profile copy when the original source is removed', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-wallpaper-test-'))
    try {
      const source = path.join(root, 'source.png')
      const profile = path.join(root, 'profile', 'wallpapers')
      fs.writeFileSync(source, PNG_BYTES)
      const managed = importWallpaper(source, profile)
      expect(managed).toContain(`${path.sep}wallpapers${path.sep}wallpaper-`)
      expect(fs.readFileSync(managed).equals(PNG_BYTES)).toBe(true)
      fs.unlinkSync(source)
      expect(fs.readFileSync(managed).equals(PNG_BYTES)).toBe(true)
      expect(ensureManagedWallpaper(managed, profile)).toBe(managed)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects files without a supported image extension', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-wallpaper-test-'))
    try {
      const source = path.join(root, 'image.txt')
      fs.writeFileSync(source, 'no image')
      expect(() => importWallpaper(source, path.join(root, 'managed'))).toThrow(
        'Unsupported wallpaper format'
      )
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
