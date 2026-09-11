import { app, shell, BrowserWindow, protocol, net, dialog } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { CockpitModel } from './cockpit-model'
import { fetchSnapshot, openStream, postCommand } from './socket'
import { registerIpcHandlers, attachCockpitPush, attachBridgePush, bridgePair } from './ipc'
import { PrefsStore, startupMigrate } from './prefs'
import { createWallpaperImageHandler, IMAGE_EXTENSIONS } from './wallpaper-image'
import { createTelemetrySampler } from './telemetry'
import { createTray } from './tray'

const appSupport = join(process.env.HOME ?? '', 'Library', 'Application Support', 'ProjectZero')
const socketPath = join(appSupport, 'zero.sock')
const prefsStoreDir = join(appSupport, 'desktop-electron')

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
  store.save(startupMigrate(store.load()))
  // Lazy on-demand machine telemetry: the sampler only reads counters when
  // the renderer asks (at most 1 Hz), no background loop (Task 18 preserved).
  const telemetry = createTelemetrySampler()
  registerIpcHandlers({
    socketPath,
    fetchSnapshot,
    postCommand,
    store,
    pickImage,
    sampleTelemetry: () => telemetry.sample()
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
