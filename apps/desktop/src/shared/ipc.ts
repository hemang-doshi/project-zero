export const OPS = {
  'prefs.get': true,
  'prefs.set': true,
  'snapshot.fetch': true,
  'command.send': true,
  'project.get': true,
  'projects.list': true,
  'skills.discover': true,
  'skills.search': true,
  'prompt.submit': true,
  'prompt.decide': true,
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
  'ocp.thread.get': true,
  'wallpaper.pick': true,
  'telemetry.sample': true,
  'artwork.fetch': true,
  'devices.list': true
} as const

export type OpName = keyof typeof OPS
export const validateOp = (op: string): op is OpName => Object.hasOwn(OPS, op)
export type CommandPayload = { op: string; body?: Record<string, unknown> }
export type ProjectPayload = { id: string }
export type ProjectListItem = { id: string; name: string; path: string }
export type ArtworkPayload = { id: string }
export type CodexSendPayload = { method: string; params?: unknown }
export type ThreadGetPayload = { threadId: string }
export type SkillsDiscoverPayload = { refresh?: boolean }
export type PromptSubmitPayload = {
  provider: 'codex' | 'opencode'
  model: string
  threadId: string
  text: string
}
export type PromptDecidePayload = PromptSubmitPayload & {
  holdId: string
  action: 'cancel' | 'send-once'
}

// Wire result of the skills.discover op, produced by the main-process skill
// discoverer (Task 37D) over lane B's pure discovery layer. Shapes mirror
// renderer skillPlugins' PluginGroup/SkillSummary structurally; the route
// parses them leniently and renders honest-empty states on failure. `ok` is
// false only when no skill root was readable — an empty-but-readable scan is
// ok:true with empty groups (honest absence, not failure).
export type DiscoveredSkill = {
  id: string
  name: string
  source: 'installed' | 'self-learnt'
  pluginId: string | null
  description?: string
  icon?: string
}
export type DiscoveredPluginGroup = {
  id: string
  name: string
  color: string
  glyph: 'flask' | 'masks' | 'stack' | 'bolt' | 'orb'
  skills: DiscoveredSkill[]
}
export type SkillsDiscoverResult = {
  ok: boolean
  groups: DiscoveredPluginGroup[]
  selfLearnt: DiscoveredSkill[]
  note: string | null
}

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
