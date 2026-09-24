import * as fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { extname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif']
export const MAX_WALLPAPER_BYTES = 20 * 1024 * 1024

export function importWallpaper(source: string, managedDir: string): string {
  const extension = extname(source).slice(1).toLowerCase()
  if (!IMAGE_EXTENSIONS.includes(extension)) throw new Error('Unsupported wallpaper format')
  const stat = fs.statSync(source)
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_WALLPAPER_BYTES) {
    throw new Error('Wallpaper must be a non-empty image no larger than 20 MB')
  }
  fs.mkdirSync(managedDir, { recursive: true })
  const destination = join(managedDir, `wallpaper-${randomUUID()}.${extension}`)
  const temporary = `${destination}.tmp`
  try {
    fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL)
    fs.renameSync(temporary, destination)
    return destination
  } catch (error) {
    try {
      fs.unlinkSync(temporary)
    } catch {
      // Preserve the original copy or rename failure if cleanup also fails.
    }
    throw error
  }
}

export function ensureManagedWallpaper(source: string, managedDir: string): string {
  const managedRoot = resolve(managedDir) + sep
  const resolvedSource = resolve(source)
  return resolvedSource.startsWith(managedRoot)
    ? resolvedSource
    : importWallpaper(resolvedSource, managedDir)
}

export function createWallpaperImageHandler(
  fileFetch: (fileUrl: string) => Promise<Response>
): (request: Request) => Response | Promise<Response> {
  return (request: Request): Response | Promise<Response> => {
    try {
      const file = decodeURIComponent(new URL(request.url).pathname.slice(1))
      const ext = file.split('.').pop()?.toLowerCase() ?? ''
      if (!IMAGE_EXTENSIONS.includes(ext)) {
        return new Response('not an image', { status: 403 })
      }
      return fileFetch(pathToFileURL(file).toString())
    } catch (err) {
      return new Response(`bad request: ${String(err)}`, { status: 404 })
    }
  }
}
