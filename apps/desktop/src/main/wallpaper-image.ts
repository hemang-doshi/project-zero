import { pathToFileURL } from 'node:url'

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif']

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
