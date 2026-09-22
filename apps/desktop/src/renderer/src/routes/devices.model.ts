import type { DeviceInfo, DeviceKind, DeviceTransport } from '../../../shared/ipc'

// Renderer-side view of the devices.list op (Task 36): lenient parsing,
// kind matching for the 3D keyboard/mouse labels, and the glyph/chip maps
// for the LOCAL DEVICES section.

export const DEVICE_KIND_GLYPH: Record<DeviceKind, string> = {
  keyboard: '⌨',
  mouse: '◉',
  audio: '♪',
  serial: '⇄',
  other: '○'
}

export const TRANSPORT_CHIP: Record<DeviceTransport, string> = {
  usb: 'USB',
  bluetooth: 'BT'
}

const KINDS: ReadonlySet<string> = new Set(['keyboard', 'mouse', 'audio', 'serial', 'other'])
const TRANSPORTS: ReadonlySet<string> = new Set(['usb', 'bluetooth'])

const isDevice = (v: unknown): v is DeviceInfo => {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r['id'] === 'string' &&
    typeof r['name'] === 'string' &&
    r['name'] !== '' &&
    typeof r['transport'] === 'string' &&
    TRANSPORTS.has(r['transport']) &&
    typeof r['kind'] === 'string' &&
    KINDS.has(r['kind']) &&
    (r['vendor'] === undefined || typeof r['vendor'] === 'string')
  )
}

export function parseDevices(raw: unknown): { devices: DeviceInfo[]; note: string | null } {
  if (typeof raw !== 'object' || raw === null) return { devices: [], note: null }
  const r = raw as Record<string, unknown>
  const devices = Array.isArray(r['devices']) ? r['devices'].filter(isDevice) : []
  const note = typeof r['note'] === 'string' ? r['note'] : null
  return { devices, note }
}

// Name-matching for the 3D models: the connected USB keyboard's product name
// labels the keyboard model, same for mouse. USB wins over Bluetooth (the
// wired device is the one on the desk). Null when absent — the caller must
// fall back to the generic label, never fabricate a name.
export function matchDeviceByKind(
  devices: DeviceInfo[],
  kind: 'keyboard' | 'mouse'
): DeviceInfo | null {
  const hits = devices.filter((d) => d.kind === kind)
  if (hits.length === 0) return null
  return hits.find((d) => d.transport === 'usb') ?? hits[0] ?? null
}
