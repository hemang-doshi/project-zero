import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {}

const zero = {
  invoke: (op: string, payload?: unknown): Promise<unknown> =>
    ipcRenderer.invoke('zero:invoke', op, payload),
  subscribe: (_channel: 'cockpit', cb: (u: unknown) => void): (() => void) => {
    const h = (_: unknown, u: unknown): void => cb(u)
    ipcRenderer.on('zero:cockpit', h)
    return () => ipcRenderer.removeListener('zero:cockpit', h)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('zero', zero)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
  // @ts-ignore (define in dts)
  window.zero = zero
}
