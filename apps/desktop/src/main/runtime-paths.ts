import { join } from 'path'

export type DesktopRuntimePaths = {
  appSupport: string
  socketPath: string
  prefsStoreDir: string
  userDataDir: string
  sessionDataDir: string
}

export function desktopRuntimePaths(home: string, development: boolean): DesktopRuntimePaths {
  const productionSupport = join(home, 'Library', 'Application Support', 'ProjectZero')
  const appSupport = development ? join(productionSupport, 'dev-electron') : productionSupport
  const userDataDir = development
    ? join(appSupport, 'electron-profile')
    : join(home, 'Library', 'Application Support', 'desktop')

  return {
    appSupport,
    socketPath: join(appSupport, 'zero.sock'),
    prefsStoreDir: join(appSupport, 'desktop-electron'),
    userDataDir,
    sessionDataDir: join(userDataDir, 'session-data')
  }
}
