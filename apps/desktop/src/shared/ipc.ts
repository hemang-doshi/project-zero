export const OPS = {
  'prefs.get': true,
  'prefs.set': true,
  'snapshot.fetch': true,
  'command.send': true,
  'project.get': true,
  'codex.connect': true,
  'codex.disconnect': true,
  'codex.send': true,
  'ocp.connect': true,
  'ocp.disconnect': true,
  'ocp.send': true,
  'wallpaper.pick': true
} as const

export type OpName = keyof typeof OPS
export const validateOp = (op: string): op is OpName => op in OPS
export type CommandPayload = { op: string; body?: Record<string, unknown> }
export type ProjectPayload = { id: string }
export type CodexSendPayload = { method: string; params?: unknown }
