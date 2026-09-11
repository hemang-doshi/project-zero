import { app, shell, BrowserWindow, protocol, net, dialog } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { is } from '@electron-toolkit/utils'
import { CockpitModel } from './cockpit-model'
import { fetchSnapshot, openStream, postCommand } from './socket'
import { registerIpcHandlers, attachCockpitPush, attachBridgePush, bridgePair } from './ipc'
import { PrefsStore, startupMigrate } from './prefs'

const appSupport = join(process.env.HOME ?? '', 'Library', 'Application Support', 'ProjectZero')
const socketPath = join(appSupport, 'zero.sock')
const prefsStoreDir = join(appSupport, 'desktop-electron')

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif']

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

const serveWallpaperImage = (request: Request): Response | Promise<Response> => {
  try {
    const file = decodeURIComponent(new URL(request.url).pathname.slice(1))
    const ext = file.split('.').pop()?.toLowerCase() ?? ''
    if (!IMAGE_EXTENSIONS.includes(ext)) {
      return new Response('not an image', { status: 403 })
    }
    return net.fetch(pathToFileURL(file).toString())
  } catch (err) {
    return new Response(`bad request: ${String(err)}`, { status: 404 })
  }
}

function createWindow(): void {
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

  const model = new CockpitModel(socketPath, fetchSnapshot, openStream, {
    reconnectDelayMs: 1_000,
    maxSnapshotAgeMs: 5_000,
    schedule: (fn, ms) => {
      const id = setTimeout(fn, ms)
      return () => clearTimeout(id)
    }
  })
  attachCockpitPush(model, mainWindow)
  attachBridgePush(bridgePair(), mainWindow)
  model.start()
  mainWindow.on('closed', () => model.stop())

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
  registerIpcHandlers({ socketPath, fetchSnapshot, postCommand, store, pickImage })
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
