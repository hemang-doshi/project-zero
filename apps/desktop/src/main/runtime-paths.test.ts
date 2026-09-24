import { describe, expect, it } from 'vitest'
import { join } from 'path'
import { desktopRuntimePaths } from './runtime-paths'

describe('desktopRuntimePaths', () => {
  it('preserves the installed app support and user data paths', () => {
    const paths = desktopRuntimePaths('/Users/test', false)

    expect(paths.appSupport).toBe('/Users/test/Library/Application Support/ProjectZero')
    expect(paths.socketPath).toBe(join(paths.appSupport, 'zero.sock'))
    expect(paths.prefsStoreDir).toBe(join(paths.appSupport, 'desktop-electron'))
    expect(paths.userDataDir).toBe('/Users/test/Library/Application Support/desktop')
  })

  it('isolates the development socket, preferences, and Chromium profile', () => {
    const development = desktopRuntimePaths('/Users/test', true)
    const production = desktopRuntimePaths('/Users/test', false)

    expect(development.appSupport).toBe(join(production.appSupport, 'dev-electron'))
    expect(development.socketPath).not.toBe(production.socketPath)
    expect(development.prefsStoreDir).not.toBe(production.prefsStoreDir)
    expect(development.userDataDir).not.toBe(production.userDataDir)
    expect(development.sessionDataDir).toBe(join(development.userDataDir, 'session-data'))
  })
})
