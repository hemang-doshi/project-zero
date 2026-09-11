import { defineConfig, type Plugin } from 'vitest/config'

// electron-vite's `?asset` imports resolve to real file paths in builds, but
// vitest has no such plugin — resolve them to the absolute fs path so
// main-process tests exercise the same asset files the packaged app loads.
const assetPaths = (): Plugin => ({
  name: 'zero-test-asset-paths',
  enforce: 'pre',
  async resolveId(id, importer, options) {
    if (!id.endsWith('?asset')) return null
    const resolved = await this.resolve(id, importer, { ...options, skipSelf: true })
    return resolved?.id ?? null
  },
  load(id) {
    if (id.endsWith('?asset')) {
      return `export default ${JSON.stringify(id.slice(0, -'?asset'.length))}`
    }
    return null
  }
})

export default defineConfig({
  plugins: [assetPaths()],
  test: {
    include: [
      'src/main/**/*.test.ts',
      'src/shared/**/*.test.ts',
      'src/renderer/**/*.test.ts',
      'tools/**/*.test.ts'
    ],
    environment: 'node'
  }
})
