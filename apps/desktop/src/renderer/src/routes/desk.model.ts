import type { BridgeEvent, Harness } from './runtime.types'

// --- Bass waveform (desk display trace, Task 26) -----------------------------
//
// Ports the desk firmware's narrow bass-trace VISUAL behavior as a fresh SVG
// renderer, per the handoff: samples arrive coarse (the daemon's cockpit
// projection carries one damped level/bass pair per snapshot), the trace
// interpolates between samples with a one-pole damp, and input that is stale,
// paused or disconnected FLATTENS to the baseline instead of freezing the last
// shape. No firmware code is reused.

export type BassSample = { bass: number | null; status: string }

export type BassTrace = { points: number[] }

export const TRACE_WINDOW = 48

// One-pole damping factor: the newest sample moves the last plotted point
// 60% toward its target, smoothing the coarse per-snapshot steps.
const DAMP = 0.6
const FLAT_EPSILON = 1 / 255

export function initBass(): BassTrace {
  return { points: Array<number>(TRACE_WINDOW).fill(0) }
}

export function pushBass(
  prev: BassTrace,
  sample: BassSample,
  live: boolean,
  playing: boolean
): BassTrace {
  if (!live) return initBass()
  const points = prev.points.slice(1)
  const last = points[points.length - 1] ?? 0
  const active = playing && sample.status.toUpperCase() === 'ACTIVE' && sample.bass !== null
  let next: number
  if (!active) {
    next = last * DAMP
  } else {
    const target = (sample.bass as number) / 255
    next = last + DAMP * (target - last)
  }
  if (Math.abs(next) < FLAT_EPSILON) next = 0
  points.push(next)
  return { points }
}

export function bassPolyline(points: number[], width: number, height: number): string {
  const baseline = height - 4
  const amplitude = height - 8
  const count = Math.max(2, points.length)
  return points
    .map((p, i) => {
      const x = 1 + (i * (width - 2)) / (count - 1)
      const y = baseline - p * amplitude
      return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`
    })
    .join(' ')
}

// --- Active agent runs (harness bridges, Task 26) -----------------------------
//
// Current active agent runs derive ONLY from the desktop harness bridges:
// a run is active while the owning bridge is live and its newest lifecycle
// marker is a start (codex turn/started; opencode session/update — ACP
// streams no turn-completion notification in this build, so an opencode run
// stays active until the bridge leaves live). Retained event memory while a
// bridge is disconnected is never rendered as a live run.

export type BridgeStatePair = Record<Harness, 'unknown' | 'disconnected' | 'connecting' | 'live'>

export type AgentRun = {
  id: string
  harness: Harness
  label: string
  state: 'ACTIVE'
}

const RUN_MARKER: Record<Harness, { start: string; end: string | null }> = {
  codex: { start: 'turn/started', end: 'turn/completed' },
  opencode: { start: 'session/update', end: null }
}

const MAX_RUNS = 8

const runKey = (params: unknown): string => {
  if (typeof params === 'object' && params !== null) {
    const p = params as Record<string, unknown>
    for (const key of ['threadId', 'sessionId', 'sessionID']) {
      if (typeof p[key] === 'string' && (p[key] as string) !== '') return p[key] as string
    }
  }
  return 'default'
}

export function agentRuns(events: BridgeEvent[], states: BridgeStatePair): AgentRun[] {
  const order: Array<{ harness: Harness; key: string }> = []
  const open = new Set<string>()
  for (const event of events) {
    const marker = RUN_MARKER[event.harness]
    if (marker === undefined) continue
    const key = runKey(event.params)
    const id = `${event.harness}:${key}`
    if (event.method === marker.start) {
      if (!open.has(id)) {
        open.add(id)
        order.push({ harness: event.harness, key })
      }
    } else if (marker.end !== null && event.method === marker.end) {
      open.delete(id)
      const at = order.findIndex((r) => `${r.harness}:${r.key}` === id)
      if (at >= 0) order.splice(at, 1)
    }
  }
  const bounded = order.slice(-MAX_RUNS)
  return bounded
    .filter((run) => states[run.harness] === 'live')
    .map(({ harness, key }) => ({
      id: `${harness}:${key}`,
      harness,
      label: key,
      state: 'ACTIVE' as const
    }))
}
