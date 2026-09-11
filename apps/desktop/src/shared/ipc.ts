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
  'telemetry.sample': true
} as const

export type OpName = keyof typeof OPS
export const validateOp = (op: string): op is OpName => Object.hasOwn(OPS, op)
export type CommandPayload = { op: string; body?: Record<string, unknown> }
export type ProjectPayload = { id: string }
export type CodexSendPayload = { method: string; params?: unknown }
export type ThreadGetPayload = { threadId: string }

// Wire payload of the telemetry.sample op, produced by the main-process
// sampler. Percentages are 0-100; byte counts are raw bytes; gpu is always
// null on macOS (no cheap portable read — see src/main/telemetry.ts).
export type TelemetryResource = { used: number; total: number; percent: number }
export type TelemetrySample = {
  cpu: number | null
  ram: TelemetryResource | null
  ssd: TelemetryResource | null
  gpu: number | null
}
