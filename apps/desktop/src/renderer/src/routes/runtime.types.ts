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

export type CockpitSnapshot = {
  version: string
  revision: number
  timestamp: string
  session: CockpitSession
  integrations: CockpitIntegration[]
  nodes: CockpitNode[]
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
    nodes
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
