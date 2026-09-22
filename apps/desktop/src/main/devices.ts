import { execFile } from 'node:child_process'
import type { DeviceInfo, DeviceKind } from '../shared/ipc'

// Local USB + Bluetooth device enumeration (Task 36). Cheap, cached, never
// sudo, fail-soft to empty with an honest note.
//
// Sources: ioreg provides the USB tree; system_profiler supplies Bluetooth
// product names and connection state. Bluetooth enumeration is cached because
// the system_profiler path is slower than the USB refresh path.
// USB is refreshed more frequently; Bluetooth is loaded at launch and on
// explicit refresh, then cached in the lister.

type UsbFlags = { hid: boolean; serial: boolean; net: boolean }

const DEVICE_CLASSES = new Set(['IOUSBHostDevice', 'IOUSBDevice'])

const strField = (block: string, key: string): string | null => {
  const m = new RegExp(`"${key}"\\s*=\\s*"([^"]*)"`).exec(block)
  return m !== null ? (m[1] ?? '') : null
}

const numField = (block: string, key: string): number | null => {
  const m = new RegExp(`"${key}"\\s*=\\s*(\\d+)`).exec(block)
  if (m === null) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

export function classifyUsb(name: string, flags: UsbFlags): DeviceKind {
  if (/keyboard/i.test(name)) return 'keyboard'
  if (/mouse|trackpad|trackball/i.test(name)) return 'mouse'
  // 2.4 GHz HID dongles report generic names ("Example Receiver"); with HID
  // children they drive the pointer, so they label the mouse model.
  if (/receiver/i.test(name) && flags.hid) return 'mouse'
  if (/serial|uart|cp210|ch340|ch9102|ftdi|ft232|pl2303|modem/i.test(name) || flags.serial)
    return 'serial'
  if (/audio|headset|headphone|speaker|microphone|dac|sound/i.test(name)) return 'audio'
  return 'other'
}

export function classifyBt(minorType: string | null): DeviceKind {
  if (minorType === null || minorType === '') return 'other'
  if (/keyboard/i.test(minorType)) return 'keyboard'
  if (/mouse|trackpad|trackball/i.test(minorType)) return 'mouse'
  if (/headset|headphone|speaker|audio/i.test(minorType)) return 'audio'
  return 'other'
}

// First balanced {...} block in s (device property dicts nest one level via
// IOPowerManagement = {...}). Returns null when unbalanced/missing.
const firstBlock = (s: string): string | null => {
  const open = s.indexOf('{')
  if (open === -1) return null
  let depth = 0
  for (let i = open; i < s.length; i += 1) {
    if (s[i] === '{') depth += 1
    else if (s[i] === '}') {
      depth -= 1
      if (depth === 0) return s.slice(open, i + 1)
    }
  }
  return null
}

type Header = { cls: string; start: number; end: number }

const collectHeaders = (text: string): Header[] => {
  const re = /^[ |]*\+-o\s+.+?\s+<class\s+([^,>]+)[^>]*>/gm
  const out: Header[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    out.push({ cls: (m[1] ?? '').trim(), start: m.index, end: m.index + m[0].length })
  }
  return out
}

export function parseUsbIoreg(text: string): DeviceInfo[] {
  if (text === '') return []
  const headers = collectHeaders(text)
  const devices: DeviceInfo[] = []
  const devicePositions = headers
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => DEVICE_CLASSES.has(h.cls))
  for (const { h, i } of devicePositions) {
    // Children (HID/serial/net interfaces) sit between this device header
    // and the next device header; hubs never nest devices inside devices.
    const next = devicePositions.find((d) => d.i > i)
    const span = text.slice(h.end, next !== undefined ? headers[next.i].start : text.length)
    const block = firstBlock(span)
    if (block === null) continue
    const name = strField(block, 'USB Product Name') ?? strField(block, 'kUSBProductString')
    if (name === null || name === '') continue
    // Hubs (class 9) and DisplayPort billboards carry no user device.
    if (numField(block, 'bDeviceClass') === 9) continue
    if (/billboard/i.test(name)) continue
    const vendor =
      strField(block, 'USB Vendor Name') ?? strField(block, 'kUSBVendorString') ?? undefined
    const idVendor = numField(block, 'idVendor')
    const idProduct = numField(block, 'idProduct')
    const locationID = numField(block, 'locationID')
    const flags: UsbFlags = {
      hid: /AppleUserUSBHostHIDDevice/.test(span),
      serial: /AppleUSBCHCOM|IOUserSerial/.test(span),
      net: /AppleUserECM|IOSkywalkLegacyEthernet|AppleUSBCDC/.test(span)
    }
    const id =
      idVendor !== null && idProduct !== null && locationID !== null
        ? `usb-${idVendor}-${idProduct}-${locationID}`
        : `usb-index-${devices.length}`
    const info: DeviceInfo = {
      id,
      name,
      transport: 'usb',
      kind: classifyUsb(name, flags)
    }
    if (vendor !== undefined && vendor !== '') info.vendor = vendor
    devices.push(info)
  }
  return devices
}

// system_profiler SPBluetoothDataType -json: only device_connected entries
// are connected hardware; device_not_connected is the remembered list and
// stays out (the mandate shows connected devices only).
export function parseBluetoothProfiler(jsonText: string): DeviceInfo[] {
  let root: unknown
  try {
    root = JSON.parse(jsonText) as unknown
  } catch {
    return []
  }
  if (typeof root !== 'object' || root === null) return []
  const arr = (root as Record<string, unknown>)['SPBluetoothDataType']
  if (!Array.isArray(arr)) return []
  const devices: DeviceInfo[] = []
  for (const entry of arr) {
    if (typeof entry !== 'object' || entry === null) continue
    const connected = (entry as Record<string, unknown>)['device_connected']
    if (!Array.isArray(connected)) continue
    for (const item of connected) {
      if (typeof item !== 'object' || item === null) continue
      for (const [name, info] of Object.entries(item as Record<string, unknown>)) {
        if (name === '' || typeof info !== 'object' || info === null) continue
        const detail = info as Record<string, unknown>
        const address =
          typeof detail['device_address'] === 'string' ? detail['device_address'] : null
        const minor =
          typeof detail['device_minorType'] === 'string' ? detail['device_minorType'] : null
        const device: DeviceInfo = {
          id: `bt-${address ?? name}`,
          name,
          transport: 'bluetooth',
          kind: classifyBt(minor)
        }
        devices.push(device)
      }
    }
  }
  return devices
}

export type DeviceListerDeps = {
  spawnUsb: () => Promise<string | null>
  readBluetooth: () => Promise<string | null>
}

export type DeviceListResult = { devices: DeviceInfo[]; note: string | null }

const runCmd = (cmd: string, args: string[], timeout: number): Promise<string | null> =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? null : stdout)
    })
  })

const defaultDeps = (): DeviceListerDeps => ({
  spawnUsb: () => runCmd('ioreg', ['-r', '-c', 'IOUSBDevice'], 2_000),
  readBluetooth: () => runCmd('system_profiler', ['SPBluetoothDataType', '-json'], 15_000)
})

// The BT (slow) read runs at most once per launch; later lists reuse the
// cache unless refreshBt is true (explicit refresh button). The USB (fast,
// ~15 ms) read runs on every list call. Nothing here ever throws: a failed
// spawn yields an honest note, never a rejection.
export function createDeviceLister(deps: DeviceListerDeps = defaultDeps()): {
  list: (refreshBt: boolean) => Promise<DeviceListResult>
} {
  let btCache: DeviceInfo[] | null = null
  let btFailed = false
  const list = async (refreshBt: boolean): Promise<DeviceListResult> => {
    const usbText = await deps.spawnUsb()
    const usb = usbText === null ? [] : parseUsbIoreg(usbText)
    if (refreshBt || btCache === null) {
      const btText = await deps.readBluetooth()
      if (btText === null) {
        if (btCache === null) {
          btCache = []
          btFailed = true
        }
        // Otherwise keep the stale cache: one failed refresh must not wipe
        // already-known Bluetooth names.
      } else {
        btCache = parseBluetoothProfiler(btText)
        btFailed = false
      }
    }
    const devices = [...usb, ...(btCache ?? [])]
    const notes: string[] = []
    if (usbText === null) notes.push('USB enumeration unavailable on this read.')
    if (btFailed) notes.push('Bluetooth names unavailable; USB only.')
    if (devices.length === 0) notes.push('No local USB or Bluetooth devices seen.')
    return { devices, note: notes.length > 0 ? notes.join(' ') : null }
  }
  return { list }
}
