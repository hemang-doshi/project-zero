import type { RuntimeConnState } from '../../../shared/protocol'
import type {
  TelemetryCpu,
  TelemetryIo,
  TelemetryMemory,
  TelemetryNet,
  TelemetrySample
} from '../../../shared/ipc'

export type Tone = 'neutral' | 'healthy' | 'attention' | 'error'

// Canonical Tone → token-color map shared by the chips and the panels.
export const TONE_COLOR: Record<Tone, string> = {
  neutral: 'var(--z-secondary-ink)',
  healthy: 'var(--z-status-green)',
  attention: 'var(--z-marker-yellow)',
  error: 'var(--z-error-red)'
}

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

export type CockpitApproval = {
  id: string
  node: string
  capability: string
  hash: string | null
  status: string
  deadline: string
  input: Record<string, string | number>
  input_omitted: boolean
}

export type CockpitPolicy = {
  id: string
  status: string
  enabled: boolean
}

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
  approvals: CockpitApproval[]
  policies: CockpitPolicy[]
  firings: number
}

export type MachineSample = TelemetrySample

export const EMPTY_MACHINE_SAMPLE: MachineSample = {
  cpu: null,
  memory: null,
  io: null,
  net: null,
  gpu: null
}

// Lenient parse of the telemetry.sample payload from the main-process
// sampler: malformed parts collapse to null (honest placeholders) instead of
// dropping the whole sample. Within a family, each cell collapses
// independently so one bad counter never blanks its siblings.
export function parseTelemetry(value: unknown): MachineSample {
  const root = asRecord(value)
  if (root === null) return EMPTY_MACHINE_SAMPLE
  const cpu = asRecord(root.cpu)
  const memory = asRecord(root.memory)
  const io = asRecord(root.io)
  const net = asRecord(root.net)
  const cpuFamily: TelemetryCpu | null =
    cpu === null
      ? null
      : {
          system: optNum(cpu.system),
          user: optNum(cpu.user),
          idle: optNum(cpu.idle),
          threads: optNum(cpu.threads),
          processes: optNum(cpu.processes)
        }
  const memoryFamily: TelemetryMemory | null =
    memory === null || !isNum(memory.total)
      ? null
      : {
          total: memory.total,
          used: optNum(memory.used) ?? 0,
          percent: optNum(memory.percent) ?? 0,
          pressure: optNum(memory.pressure) ?? 0,
          level: memoryLevel(memory.level),
          app: optNum(memory.app),
          wired: optNum(memory.wired),
          compressed: optNum(memory.compressed),
          cachedFiles: optNum(memory.cachedFiles),
          swapUsed: optNum(memory.swapUsed)
        }
  return {
    cpu: cpuFamily,
    memory: memoryFamily,
    io: io === null ? null : ioCell(io),
    net: net === null ? null : netCell(net),
    gpu: optNum(root.gpu)
  }
}

const optNum = (v: unknown): number | null => (isNum(v) ? v : null)

const IO_KEYS = [
  'reads',
  'writes',
  'readsPerSec',
  'writesPerSec',
  'dataRead',
  'dataWritten',
  'dataReadPerSec',
  'dataWrittenPerSec'
] as const

const NET_KEYS = [
  'packetsIn',
  'packetsOut',
  'packetsInPerSec',
  'packetsOutPerSec',
  'dataReceived',
  'dataSent',
  'dataReceivedPerSec',
  'dataSentPerSec'
] as const

const ioCell = (r: Record<string, unknown>): TelemetryIo => {
  const out = {} as Record<(typeof IO_KEYS)[number], number | null>
  for (const key of IO_KEYS) out[key] = optNum(r[key])
  return out
}

const netCell = (r: Record<string, unknown>): TelemetryNet => {
  const out = {} as Record<(typeof NET_KEYS)[number], number | null>
  for (const key of NET_KEYS) out[key] = optNum(r[key])
  return out
}

const memoryLevel = (v: unknown): 'low' | 'medium' | 'high' =>
  v === 'medium' ? 'medium' : v === 'high' ? 'high' : 'low'

export function pressureTone(level: 'low' | 'medium' | 'high'): Tone {
  if (level === 'low') return 'healthy'
  if (level === 'medium') return 'attention'
  return 'error'
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

const parseApproval = (v: unknown): CockpitApproval | null => {
  const r = asRecord(v)
  if (r === null || !isStr(r.id) || !isStr(r.node) || !isStr(r.capability)) return null
  if (!isStr(r.status) || !isStr(r.deadline)) return null
  const input = asRecord(r.input)
  const summary: Record<string, string | number> = {}
  if (input !== null) {
    for (const [k, value] of Object.entries(input)) {
      if (isStr(value) || isNum(value)) summary[k] = value
    }
  }
  return {
    id: r.id,
    node: r.node,
    capability: r.capability,
    hash: isStr(r.hash) ? r.hash : null,
    status: r.status,
    deadline: r.deadline,
    input: summary,
    input_omitted: r.input_omitted === true
  }
}

const parsePolicy = (v: unknown): CockpitPolicy | null => {
  const r = asRecord(v)
  if (r === null || !isStr(r.id) || !isStr(r.status)) return null
  return { id: r.id, status: r.status, enabled: r.enabled === true }
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

// Parse-once cache keyed by snapshot reference: every selector/projection
// helper that receives the same snapshot object shares one parse. The store
// pushes a fresh snapshot reference per update, so each push parses at most
// once regardless of how many routes/selectors read it (Task 10 Low-#2).
const snapshotCache = new WeakMap<object, CockpitSnapshot | null>()

export function parseSnapshot(value: unknown): CockpitSnapshot | null {
  if (typeof value !== 'object' || value === null) return null
  const cached = snapshotCache.get(value)
  if (cached !== undefined) return cached
  const parsed = parseSnapshotUncached(value)
  snapshotCache.set(value, parsed)
  return parsed
}

function parseSnapshotUncached(value: unknown): CockpitSnapshot | null {
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
    truncated: parseTruncated(root.truncated),
    approvals: Array.isArray(root.approvals)
      ? root.approvals
          .map((item) => parseApproval(item))
          .filter((a): a is CockpitApproval => a !== null)
      : [],
    policies: Array.isArray(root.policies)
      ? root.policies.map((item) => parsePolicy(item)).filter((p): p is CockpitPolicy => p !== null)
      : [],
    firings: Array.isArray(root.firings) ? root.firings.length : 0
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

// --- Airlock (single slate + stats + lower-bound notices) -------------------

export type ApprovalFreshness = 'live' | 'retained' | 'expired'

export type ApprovalActions = {
  canApprove: boolean
  canDeny: boolean
  reason: string | null
}

export function approvalIdentityComplete(a: CockpitApproval): boolean {
  return (
    a.id !== '' &&
    a.node !== '' &&
    a.capability !== '' &&
    a.deadline !== '' &&
    a.status === 'WAITING_APPROVAL'
  )
}

export function approvalExpired(a: CockpitApproval, now: number): boolean {
  const deadline = Date.parse(a.deadline)
  return Number.isFinite(deadline) && now >= deadline
}

export function approvalFreshness(
  conn: RuntimeConnState,
  a: CockpitApproval,
  now: number
): ApprovalFreshness {
  if (conn !== 'live') return 'retained'
  if (approvalExpired(a, now)) return 'expired'
  return 'live'
}

export function approvalActions(
  conn: RuntimeConnState,
  a: CockpitApproval,
  now: number
): ApprovalActions {
  const identity = approvalIdentityComplete(a)
  if (!identity) {
    return {
      canApprove: false,
      canDeny: false,
      reason:
        'Required runtime identity, state, or RFC3339 deadline fields are unavailable or have the wrong type.'
    }
  }
  if (conn !== 'live') {
    return {
      canApprove: false,
      canDeny: false,
      reason:
        'This is retained snapshot evidence while zerod is not live. Runtime actions are disabled until a fresh live snapshot arrives.'
    }
  }
  if (approvalExpired(a, now)) {
    return {
      canApprove: false,
      canDeny: true,
      reason:
        'The approval deadline has passed. Approval is disabled; the daemon’s exact deny operation remains available for this retained WAITING_APPROVAL row.'
    }
  }
  return { canApprove: true, canDeny: true, reason: null }
}

export function approvalNotice(conn: RuntimeConnState, a: CockpitApproval, now: number): string {
  const expired = approvalExpired(a, now)
  if (a.input_omitted && !expired) {
    return 'The live daemon retained the full invocation. This bounded display projection omits one or more input fields; actions route only the original invocation ID.'
  }
  if (expired) {
    return conn !== 'live'
      ? 'The approval deadline has passed while zerod is not live. This is retained snapshot evidence; runtime actions are disabled until a fresh live snapshot arrives.'
      : 'The approval deadline has passed. Approval is disabled; the daemon’s exact deny operation remains available for this retained WAITING_APPROVAL row, which is not treated as a terminal denial.'
  }
  return conn !== 'live'
    ? 'This is retained snapshot evidence while zerod is not live. Runtime actions are disabled until a fresh live snapshot arrives.'
    : 'The live daemon is holding this exact invocation for an explicit owner decision.'
}

export type AirlockStats = {
  pending: number
  runtime: number
  codex: number
  audited: string
}

export function airlockStats(snapshot: unknown): AirlockStats {
  const parsed = parseSnapshot(snapshot)
  const runtime = parsed?.approvals.length ?? 0
  const audited = approvalAuditRows(snapshot).length
  return {
    pending: runtime + (parsed?.firings ?? 0),
    runtime,
    codex: 0,
    audited: `${audited}${parsed?.truncated.audit === true ? '+' : ''}`
  }
}

export function approvalAuditRows(snapshot: unknown): CockpitAudit[] {
  const parsed = parseSnapshot(snapshot)
  if (parsed === null) return []
  return parsed.audit.filter((row) => row.action.startsWith('approvals.'))
}

// --- Zero Bot (harness lock + discovery + bridge event surface) -------------

export type Harness = 'codex' | 'opencode'

export type BridgeConnState = 'unknown' | 'disconnected' | 'connecting' | 'live'

export const HARNESS_MODELS: Record<Harness, string[]> = {
  codex: ['gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-6-astra'],
  opencode: ['muse-spark-1.3']
}

export const HARNESS_DEFAULT_MODEL: Record<Harness, string> = {
  codex: 'gpt-5.6-luna',
  opencode: 'muse-spark-1.3'
}

export const mirrorLabel = (harness: Harness): string => `zero-meta/${harness}/events.jsonl`

export function harnessLockWarning(model: string, harness: Harness): string | null {
  if (HARNESS_MODELS[harness].includes(model)) return null
  const home = harness === 'codex' ? 'Codex (GPT only)' : 'OpenCode (Muse Spark only)'
  return `Model ${model} is not allowed in the ${harness} harness. It stays locked to its home harness (${home}); this mismatch is mirrored, not sent.`
}

export type BridgeEvent = {
  harness: Harness
  method: string
  params: unknown
}

export type EventCategory =
  | 'OPERATOR'
  | 'ZERO BOT'
  | 'REASONING'
  | 'PLAN'
  | 'COMMAND'
  | 'FILE CHANGE'
  | 'TOOL'
  | 'PROTOCOL ITEM'

export function classifyBridgeEvent(method: string): EventCategory {
  const value = method.toLowerCase()
  if (value.includes('user') || value.includes('operator')) return 'OPERATOR'
  if (value.includes('agentmessage') || value.includes('assistant')) return 'ZERO BOT'
  if (value.includes('reasoning')) return 'REASONING'
  if (value.includes('plan')) return 'PLAN'
  if (value.includes('commandexecution') || value.includes('terminal')) return 'COMMAND'
  if (value.includes('filechange') || value.includes('diff')) return 'FILE CHANGE'
  if (value.includes('tool') || value.includes('search') || value.includes('image')) return 'TOOL'
  return 'PROTOCOL ITEM'
}

export function bridgeEventSummary(ev: BridgeEvent, limit = 96): string {
  const p =
    typeof ev.params === 'object' && ev.params !== null
      ? (ev.params as Record<string, unknown>)
      : null
  const raw =
    (p !== null &&
      [p.text, p.delta, p.command, p.name, p.title, p.threadId, p.sessionId, p.id].find(
        (v) => typeof v === 'string' && v !== ''
      )) ||
    ''
  const text = typeof raw === 'string' && raw !== '' ? raw : ev.method
  return text.length > limit ? `…${text.slice(-limit)}` : text
}

export type DiscoveryResult = {
  harness: Harness
  models: Array<{ id: string; label: string; advertised: boolean }>
  threads: Array<{ id: string; name: string }>
  note: string | null
}

const scalar = (v: unknown): string | null => {
  if (typeof v === 'string' && v !== '') return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

const modelOptions = (rows: unknown[]): DiscoveryResult['models'] => {
  const out: DiscoveryResult['models'] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const r = asRecord(row)
    if (r === null) continue
    const id = scalar(r['id']) ?? scalar(r['model']) ?? scalar(r['slug'])
    if (id === null || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      label: scalar(r['displayName']) ?? scalar(r['name']) ?? id,
      advertised: true
    })
  }
  return out
}

const threadOptions = (rows: unknown[]): DiscoveryResult['threads'] => {
  const out: DiscoveryResult['threads'] = []
  for (const row of rows) {
    const r = asRecord(row)
    if (r === null) continue
    const id = scalar(r['id']) ?? scalar(r['threadId'])
    if (id === null) continue
    out.push({ id, name: scalar(r['name']) ?? scalar(r['title']) ?? '' })
  }
  return out
}

export function parseDiscovery(value: unknown): DiscoveryResult | null {
  const r = asRecord(value)
  if (r === null) return null
  const harness = r['harness']
  if (harness !== 'codex' && harness !== 'opencode') return null
  return {
    harness,
    models: modelOptions(Array.isArray(r['models']) ? r['models'] : []),
    threads: threadOptions(Array.isArray(r['threads']) ? r['threads'] : []),
    note: isStr(r['note']) && r['note'] !== '' ? r['note'] : null
  }
}

export const SEND_BLOCKED_NOTICE =
  'Send is honestly blocked in this build: the daemon command path has no conversational send yet.'

export const VOICE_DISABLED_NOTICE =
  'Voice input is disabled in this build; use system dictation instead.'

export function visibleBridgeEvents(events: BridgeEvent[], harness: Harness): BridgeEvent[] {
  return events.filter((e) => e.harness === harness)
}

// --- Skill Lab (read-only fixture skills) -----------------------------------

export type SkillSourceLabel = 'learned-in-codex' | 'learned-in-opencode' | 'authored'

export type SkillFixture = {
  id: string
  name: string
  summary: string
  source: SkillSourceLabel
  enabled: boolean
  isUsable: boolean
  rejectionReason: string | null
}

export const SKILL_INJECTION_CONTRACT =
  'Skills enabled once apply to both providers’ future sessions (shared). Threads and projects stay namespaced per provider. A skill a provider rejects is shown as rejected — never silently dropped.'

// Read-only fixtures shaped after the SkillStore skill record
// (apps/macos/Sources/ZeroKit/SkillStore.swift). The daemon (core/) exposes
// no skill store and the sandboxed renderer has no filesystem op, so this
// lane renders fixtures only; enable toggles are not wired.
export const SKILL_FIXTURES: SkillFixture[] = [
  {
    id: 'daily-standup',
    name: 'Daily Standup Notes',
    summary: 'Summarizes the focus session and git state into a short standup note.',
    source: 'authored',
    enabled: false,
    isUsable: true,
    rejectionReason: null
  },
  {
    id: 'debug-ritual',
    name: 'Zero Debug Ritual',
    summary: 'Runs the root-cause-first debugging checklist against a reported defect.',
    source: 'learned-in-codex',
    enabled: false,
    isUsable: true,
    rejectionReason: null
  },
  {
    id: 'desk-display-notes',
    name: 'Desk Display Notes',
    summary: 'Explains the desk display render pipeline and honest state model.',
    source: 'learned-in-opencode',
    enabled: false,
    isUsable: true,
    rejectionReason: null
  },
  {
    id: 'broken-skill',
    name: 'broken-skill',
    summary: '',
    source: 'authored',
    enabled: false,
    isUsable: false,
    rejectionReason: 'Front-matter needs non-empty name and description.'
  }
]

export function skillSummary(s: SkillFixture): string {
  return s.isUsable ? s.summary : (s.rejectionReason ?? 'Unusable skill.')
}
