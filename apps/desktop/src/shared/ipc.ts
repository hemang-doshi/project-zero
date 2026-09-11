export const OPS = {
  'prefs.get': true,
  'prefs.set': true,
  'snapshot.fetch': true,
  'command.send': true,
  'project.get': true,
  'codex.connect': true,
  'codex.disconnect': true,
  'codex.send': true,
  'codex.state': true,
  'codex.discover': true,
  'codex.threads': true,
  'codex.thread.get': true,
  'ocp.connect': true,
  'ocp.disconnect': true,
  'ocp.send': true,
  'ocp.state': true,
  'ocp.discover': true,
  'wallpaper.pick': true,
  'telemetry.sample': true,
  'artwork.fetch': true,
  'devices.list': true
} as const

export type OpName = keyof typeof OPS
export const validateOp = (op: string): op is OpName => Object.hasOwn(OPS, op)
export type CommandPayload = { op: string; body?: Record<string, unknown> }
export type ProjectPayload = { id: string }
export type ArtworkPayload = { id: string }
export type CodexSendPayload = { method: string; params?: unknown }
export type ThreadGetPayload = { threadId: string }

// Local-device enumeration (Task 36): real USB + Bluetooth product names
// from the main process. Transports are exactly 'usb' | 'bluetooth'; kinds
// are a coarse HID/audio/serial split used for 3D name-matching.
export type DeviceTransport = 'usb' | 'bluetooth'
export type DeviceKind = 'keyboard' | 'mouse' | 'audio' | 'serial' | 'other'
export type DeviceInfo = {
  id: string
  name: string
  transport: DeviceTransport
  kind: DeviceKind
  vendor?: string
}
export type DevicesListPayload = { refreshBt?: boolean }
export type DevicesListResult = { devices: DeviceInfo[]; note: string | null }

// Wire payload of the telemetry.sample op, produced by the main-process
// sampler. Percentages are 0-100; byte counts are raw bytes; rates are deltas
// between consecutive samples divided by elapsed seconds. Sources are all
// fail-soft: a section that cannot be read leaves its family fields null and
// the route renders the honest '—' placeholder.
export type TelemetryCpu = {
  system: number | null
  user: number | null
  idle: number | null
  threads: number | null
  processes: number | null
}
export type TelemetryMemory = {
  total: number
  used: number
  percent: number
  pressure: number
  level: 'low' | 'medium' | 'high'
  app: number | null
  wired: number | null
  compressed: number | null
  cachedFiles: number | null
  swapUsed: number | null
}
export type TelemetryIo = {
  reads: number | null
  writes: number | null
  readsPerSec: number | null
  writesPerSec: number | null
  dataRead: number | null
  dataWritten: number | null
  dataReadPerSec: number | null
  dataWrittenPerSec: number | null
}
export type TelemetryNet = {
  packetsIn: number | null
  packetsOut: number | null
  packetsInPerSec: number | null
  packetsOutPerSec: number | null
  dataReceived: number | null
  dataSent: number | null
  dataReceivedPerSec: number | null
  dataSentPerSec: number | null
}
export type TelemetrySample = {
  cpu: TelemetryCpu | null
  memory: TelemetryMemory | null
  io: TelemetryIo | null
  net: TelemetryNet | null
  gpu: number | null
}
