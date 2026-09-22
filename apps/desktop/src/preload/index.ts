import { contextBridge, ipcRenderer } from 'electron'

// The `zero` contextBridge is this app's only preload surface (Task 1
// ruling): no @electron-toolkit/preload (its externalized import cannot be
// resolved by a sandboxed preload inside app.asar), no template `electron`
// or `api` globals.
const zero = {
  invoke: (op: string, payload?: unknown): Promise<unknown> =>
    ipcRenderer.invoke('zero:invoke', op, payload),
  subscribe: (channel: 'cockpit' | 'bridge', cb: (u: unknown) => void): (() => void) => {
    const h = (_: unknown, u: unknown): void => cb(u)
    const on = channel === 'bridge' ? 'zero:bridge' : 'zero:cockpit'
    ipcRenderer.on(on, h)
    return () => ipcRenderer.removeListener(on, h)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('zero', zero)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.zero = zero
}
