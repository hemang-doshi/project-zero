import type { RuntimeConnState } from '../../../shared/protocol'

export type Tone = 'neutral' | 'healthy' | 'attention' | 'error'

export type CockpitSession = {
  id: string | null
  project_id: string | null
  project: string
  state: string
  elapsed_ms: number
  since_ms: number
  revision: number
}

export type CockpitIntegration = {
  id: string
  enabled: boolean
  status: string
  data: Record<string, string>
}

export type CockpitNode = {
  id: string
  revoked: boolean
  capabilities: string[]
  last_seen: string | null
  status: string
}

export type CockpitEvent = {
  seq: number
  id: string
  kind: string
  time: string
}

export type CockpitAudit = {
  seq: number
  time: string
  action: string
  decision: string
  principal: string | null
  target: string | null
  correlation: string | null
}

export type CockpitTruncated = Record<string, boolean>

export type CockpitSnapshot = {
  version: string
  revision: number
  timestamp: string
  session: CockpitSession
  integrations: CockpitIntegration[]
  nodes: CockpitNode[]
  events: CockpitEvent[]
  audit: CockpitAudit[]
  truncated: CockpitTruncated
}

export type MachineSample = {
  cpu: number | null
  ram: number | null
  ssd: number | null
  gpu: number | null
}

export const EMPTY_MACHINE_SAMPLE: MachineSample = {
  cpu: null,
  ram: null,
  ssd: null,
  gpu: null
}

const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null

export function selectSession(value: unknown): CockpitSession | null {
  const root = asRecord(value)
  const s = root === null ? null : asRecord(root.session)
  if (s === null) return null
  if (!isStr(s.project) || !isStr(s.state)) return null
  if (!isNum(s.elapsed_ms) || !isNum(s.since_ms) || !isNum(s.revision)) return null
  return {
    id: isStr(s.id) ? s.id : null,
    project_id: isStr(s.project_id) ? s.project_id : null,
    project: s.project,
    state: s.state,
    elapsed_ms: s.elapsed_ms,
    since_ms: s.since_ms,
    revision: s.revision
  }
}

const parseNode = (v: unknown): CockpitNode | null => {
  const r = asRecord(v)
  if (r === null || !isStr(r.id) || !isStr(r.status)) return null
  const caps = r.capabilities
  return {
    id: r.id,
    revoked: r.revoked === true || r.revoked === 1,
    capabilities: Array.isArray(caps) ? caps.filter(isStr) : [],
    last_seen: isStr(r.last_seen) ? r.last_seen : null,
    status: r.status
  }
}

const parseEvents = (v: unknown): CockpitEvent[] => {
  if (!Array.isArray(v)) return []
  const events: CockpitEvent[] = []
  for (const item of v) {
    const r = asRecord(item)
    if (r === null || !isNum(r.seq) || !isStr(r.id) || !isStr(r.kind) || !isStr(r.time)) continue
    events.push({ seq: r.seq, id: r.id, kind: r.kind, time: r.time })
  }
  return events
}

const parseAudit = (v: unknown): CockpitAudit[] => {
  if (!Array.isArray(v)) return []
  const audit: CockpitAudit[] = []
  for (const item of v) {
    const r = asRecord(item)
    if (r === null || !isNum(r.seq) || !isStr(r.time) || !isStr(r.action) || !isStr(r.decision)) {
      continue
    }
    audit.push({
      seq: r.seq,
      time: r.time,
      action: r.action,
      decision: r.decision,
      principal: isStr(r.principal) ? r.principal : null,
      target: isStr(r.target) ? r.target : null,
      correlation: isStr(r.correlation) ? r.correlation : null
    })
  }
  return audit
}

const parseTruncated = (v: unknown): CockpitTruncated => {
  const r = asRecord(v)
  const flags: CockpitTruncated = {}
  if (r === null) return flags
  for (const [k, value] of Object.entries(r)) if (typeof value === 'boolean') flags[k] = value
  return flags
}

const parseIntegration = (v: unknown): CockpitIntegration | null => {
  const r = asRecord(v)
  if (r === null || !isStr(r.id) || !isStr(r.status)) return null
  const data = asRecord(r.data)
  const strings: Record<string, string> = {}
  if (data !== null) {
    for (const [k, v] of Object.entries(data)) if (isStr(v)) strings[k] = v
  }
  return { id: r.id, enabled: r.enabled === true, status: r.status, data: strings }
}

export function parseSnapshot(value: unknown): CockpitSnapshot | null {
  const root = asRecord(value)
  if (root === null || root.version !== '0.1') return null
  if (!isNum(root.revision) || !isStr(root.timestamp)) return null
  const session = selectSession(value)
  if (session === null || !Array.isArray(root.integrations) || !Array.isArray(root.nodes)) {
    return null
  }
  const integrations: CockpitIntegration[] = []
  for (const item of root.integrations) {
    const parsed = parseIntegration(item)
    if (parsed === null) return null
    integrations.push(parsed)
  }
  const nodes: CockpitNode[] = []
  for (const item of root.nodes) {
    const parsed = parseNode(item)
    if (parsed === null) return null
    nodes.push(parsed)
  }
  return {
    version: root.version,
    revision: root.revision,
    timestamp: root.timestamp,
    session,
    integrations,
    nodes,
    events: parseEvents(root.events),
    audit: parseAudit(root.audit),
    truncated: parseTruncated(root.truncated)
  }
}

export type Connectivity = { label: string; detail: string; tone: Tone }

const DISPLAY_CAPS = ['display.render', 'display.clear']

export const displayNodes = (snapshot: unknown): CockpitNode[] => {
  const parsed = parseSnapshot(snapshot)
  if (parsed === null) return []
  return parsed.nodes.filter(
    (n) => !n.revoked && n.capabilities.some((c) => DISPLAY_CAPS.includes(c))
  )
}

export function connectivity(conn: RuntimeConnState, snapshot: unknown): Connectivity {
  if (conn === 'connecting' || conn === 'reconnecting') {
    return { label: 'RECONNECTING', detail: 'Runtime reconnecting', tone: 'attention' }
  }
  if (conn !== 'live') {
    return { label: 'OFFLINE', detail: 'Runtime offline', tone: 'error' }
  }
  const parsed = parseSnapshot(snapshot)
  if (parsed === null) {
    return { label: 'OFFLINE', detail: 'Runtime unavailable', tone: 'error' }
  }
  const nodes = displayNodes(snapshot)
  if (nodes.length === 0) {
    return { label: 'OFFLINE', detail: 'No display node connected', tone: 'error' }
  }
  const online = nodes.filter((n) => n.status === 'ONLINE')
  if (online.length === 0) {
    return { label: 'STALE', detail: 'No display node online', tone: 'attention' }
  }
  return {
    label: 'CONNECTED',
    detail: nodes.map((n) => `${n.id} ${n.status.toLowerCase()}`).join(' · '),
    tone: 'healthy'
  }
}

export function sessionTone(state: string | null): Tone {
  switch (state) {
    case 'RUNNING':
      return 'healthy'
    case 'PAUSED':
      return 'attention'
    case 'IDLE':
      return 'neutral'
    default:
      return 'error'
  }
}

export function sessionChipTone(conn: RuntimeConnState, state: string | null): Tone {
  if (state === null) return 'error'
  if (conn !== 'live') return 'neutral'
  return sessionTone(state)
}

export function activeProjectLabel(conn: RuntimeConnState, project: string): string {
  return conn === 'live' && project !== '' ? project : 'No active project'
}

export function extrapolate(
  baseMs: number | null,
  ticking: boolean,
  receivedAt: number | null,
  now: number
): number | null {
  if (baseMs === null) return null
  if (!ticking || receivedAt === null) return baseMs
  return baseMs + Math.max(0, now - receivedAt)
}

export type GitLine = { branch: string | null; dirty: string | null }

export function gitLine(snapshot: unknown): GitLine | null {
  const parsed = parseSnapshot(snapshot)
  if (parsed === null) return null
  const git = parsed.integrations.find((i) => i.id === 'git')
  if (git === undefined) return null
  const branch = isStr(git.data.branch) && git.data.branch !== '' ? git.data.branch : null
  const dirty = isStr(git.data.dirty) && git.data.dirty !== '' ? git.data.dirty : null
  if (branch === null && dirty === null) return null
  return { branch, dirty }
}

export type LoadedKey = 'cpu' | 'ram' | 'gpu'

export function mostLoaded(sample: MachineSample): LoadedKey | null {
  let best: LoadedKey | null = null
  let bestValue = -1
  for (const key of ['cpu', 'ram', 'gpu'] as const) {
    const v = sample[key]
    if (typeof v === 'number' && Number.isFinite(v) && v > bestValue) {
      best = key
      bestValue = v
    }
  }
  return best
}

// Flight noise taxonomy pinned from the daemon's actual stream taxonomy
// (core/runtime events-table kinds and audit actions; SSE-level names included
// as a guard): render/clock/keepalive rows are hidden by default.
export function isFlightNoise(channel: string): boolean {
  const kind = channel.toLowerCase()
  return (
    kind.startsWith('display.') ||
    kind === 'clock.tick' ||
    kind === 'sse.keepalive' ||
    kind === 'ready'
  )
}

export type FlightRow = {
  id: string
  source: 'event' | 'audit'
  seq: number
  time: string
  channel: string
  actor: string
  outcome: string
  tone: Tone
  noise: boolean
}

const FLIGHT_OUTCOME_WORDS: Record<string, Tone> = {
  ALLOW: 'healthy',
  ALLOWED: 'healthy',
  APPROVED: 'healthy',
  APPROVED_EXECUTION: 'healthy',
  SUCCEEDED: 'healthy',
  SUCCESS: 'healthy',
  PASS: 'healthy',
  PASSED: 'healthy',
  COMPLETED: 'healthy',
  DENY: 'attention',
  DENIED: 'attention',
  REJECTED: 'attention',
  FAILED: 'attention',
  CANCELLED: 'attention',
  EXPIRED: 'attention',
  TIMED_OUT: 'attention',
  QUEUED: 'attention',
  DISPATCHED: 'attention',
  WAITING: 'attention',
  WAITING_APPROVAL: 'attention',
  QUARANTINE: 'attention',
  QUARANTINED: 'attention'
}

export function flightOutcomeTone(outcome: string): Tone {
  return FLIGHT_OUTCOME_WORDS[outcome.toUpperCase()] ?? 'neutral'
}

export function flightRows(snapshot: unknown): FlightRow[] {
  const parsed = parseSnapshot(snapshot)
  if (parsed === null) return []
  const events: FlightRow[] = parsed.events.map((e) => ({
    id: `event-${e.seq}-${e.id}`,
    source: 'event',
    seq: e.seq,
    time: e.time,
    channel: e.kind,
    actor: 'zerod',
    outcome: 'RECORDED',
    tone: 'neutral',
    noise: isFlightNoise(e.kind)
  }))
  const audit: FlightRow[] = parsed.audit.map((a) => ({
    id: `audit-${a.seq}`,
    source: 'audit',
    seq: a.seq,
    time: a.time,
    channel: a.action,
    actor: a.principal ?? '—',
    outcome: a.decision,
    tone: flightOutcomeTone(a.decision),
    noise: isFlightNoise(a.action)
  }))
  return [...events, ...audit]
}

export function visibleFlightRows(rows: FlightRow[], showAll: boolean): FlightRow[] {
  return showAll ? rows : rows.filter((r) => !r.noise)
}

export function flightNotice(snapshot: unknown): string {
  const parsed = parseSnapshot(snapshot)
  if (parsed === null) return 'No runtime snapshot is available.'
  const bounded = ['events', 'audit'].filter((k) => parsed.truncated[k] === true)
  if (bounded.length === 0) {
    return 'Runtime rows are the complete current bounded projection.'
  }
  return `Runtime ${bounded.join(', ')} history is truncated; visible counts are a lower bound.`
}

export function freshnessChip(
  conn: RuntimeConnState,
  snapshot: unknown
): { label: string; tone: Tone } {
  const parsed = parseSnapshot(snapshot)
  if (parsed === null) return { label: 'NO SNAPSHOT', tone: 'neutral' }
  if (conn !== 'live') return { label: 'CACHED', tone: 'neutral' }
  return { label: `LIVE · REV ${parsed.revision}`, tone: 'healthy' }
}

export function nodeTone(conn: RuntimeConnState, status: string): Tone {
  if (conn !== 'live') return 'neutral'
  switch (status.toUpperCase()) {
    case 'ONLINE':
      return 'healthy'
    case 'OFFLINE':
    case 'REVOKED':
      return 'error'
    case 'SUSPECT':
      return 'attention'
    default:
      return 'neutral'
  }
}
