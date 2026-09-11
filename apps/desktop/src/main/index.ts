import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { CockpitModel } from './cockpit-model'
import { fetchSnapshot, openStream, postCommand } from './socket'
import { registerIpcHandlers, attachCockpitPush } from './ipc'

const socketPath = join(
  process.env.HOME ?? '',
  'Library',
  'Application Support',
  'ProjectZero',
  'zero.sock'
)

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
  registerIpcHandlers({ socketPath, fetchSnapshot, postCommand })
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
