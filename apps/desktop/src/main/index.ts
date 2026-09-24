import { app, shell, BrowserWindow, protocol, net, dialog } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { CockpitModel } from './cockpit-model'
import { fetchSnapshot, openStream, postCommand } from './socket'
import { registerIpcHandlers, attachCockpitPush, attachBridgePush, bridgePair } from './ipc'
import { PrefsStore, startupMigrate } from './prefs'
import {
  createWallpaperImageHandler,
  ensureManagedWallpaper,
  importWallpaper,
  IMAGE_EXTENSIONS
} from './wallpaper-image'
import { createSkillDiscoverer } from './skills'
import { createSkillLearningStore } from './skills-learning'
import { createDeviceLister } from './devices'
import { createTelemetrySampler } from './telemetry'
import { createTray } from './tray'
import { desktopRuntimePaths } from './runtime-paths'

const development = is.dev || process.env.ZERO_DESKTOP_DEV_PROFILE === '1'
const runtimePaths = desktopRuntimePaths(process.env.HOME ?? '', development)
if (development) {
  mkdirSync(runtimePaths.userDataDir, { recursive: true })
  mkdirSync(runtimePaths.sessionDataDir, { recursive: true })
  app.setPath('userData', runtimePaths.userDataDir)
  app.setPath('sessionData', runtimePaths.sessionDataDir)
}
const { socketPath, prefsStoreDir } = runtimePaths

protocol.registerSchemesAsPrivileged([
  { scheme: 'zero-img', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

const pickImage = async (): Promise<string | null> => {
  const res = await dialog.showOpenDialog({
    filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }],
    properties: ['openFile']
  })
  return res.canceled ? null : (res.filePaths[0] ?? null)
}

const serveWallpaperImage = createWallpaperImageHandler((fileUrl) => net.fetch(fileUrl))

function createWindow(model: CockpitModel): void {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

  // One app-lifetime model: windows attach pushes, the tray subscribes.
  attachCockpitPush(model, mainWindow)
  attachBridgePush(bridgePair(), mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  protocol.handle('zero-img', serveWallpaperImage)
  const store = new PrefsStore(prefsStoreDir)
  const prefs = startupMigrate(store.load())
  const managedWallpaperDir = join(prefsStoreDir, 'wallpapers')
  if (prefs.wallpaper.kind === 'custom' && prefs.wallpaper.path) {
    try {
      prefs.wallpaper = {
        ...prefs.wallpaper,
        path: ensureManagedWallpaper(prefs.wallpaper.path, managedWallpaperDir)
      }
    } catch {
      // Keep the saved path so the renderer can use its neutral wallpaper fallback.
    }
  }
  store.save(prefs)
  // Main owns a short ring buffer so opening Runtime can replay samples already
  // measured while the desktop window was visible.
  const telemetry = createTelemetrySampler()
  void telemetry.sample().catch(() => {})
  const telemetryTimer = setInterval(() => {
    const visible = BrowserWindow.getAllWindows().some(
      (win) => win.isVisible() && !win.isMinimized()
    )
    if (visible) void telemetry.sample().catch(() => {})
  }, 2_000)
  telemetryTimer.unref()
  app.on('before-quit', () => clearInterval(telemetryTimer))
  // Local devices: USB via fast ioreg on every list call; Bluetooth names
  // via the slow system_profiler path once per launch + explicit refresh
  // (cached inside the lister).
  const deviceLister = createDeviceLister()
  // Skill grid: one app-lifetime discoverer over the real skill roots, cached
  // per launch; the route rescans explicitly via { refresh: true }.
  const learnedSkillsDir = join(prefsStoreDir, 'skills-learned')
  const skillDiscoverer = createSkillDiscoverer(undefined, process.env.HOME ?? '', learnedSkillsDir)
  const skillLearning = createSkillLearningStore({
    stateFile: join(prefsStoreDir, 'skills-learning.json'),
    learnedRoot: learnedSkillsDir
  })
  registerIpcHandlers({
    socketPath,
    fetchSnapshot,
    postCommand,
    store,
    pickImage,
    importWallpaper: (source) => importWallpaper(source, managedWallpaperDir),
    skillLearning,
    sampleTelemetry: () => telemetry.sample(),
    telemetryHistory: () => telemetry.history(),
    listDevices: (refreshBt: boolean) => deviceLister.list(refreshBt),
    discoverSkills: (refresh: boolean) => Promise.resolve(skillDiscoverer.discover(refresh))
  })

  // One app-lifetime CockpitModel shared by window pushes and the tray
  // companion — no second model, no second stream.
  const model = new CockpitModel(socketPath, fetchSnapshot, openStream, {
    reconnectDelayMs: 1_000,
    maxSnapshotAgeMs: 5_000,
    schedule: (fn, ms) => {
      const id = setTimeout(fn, ms)
      return () => clearTimeout(id)
    }
  })
  model.start()

  const openDesktop = (): void => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win === undefined) {
      createWindow(model)
      return
    }
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
  createTray(model, { openDesktop, quit: () => app.quit() })
  createWindow(model)

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(model)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
