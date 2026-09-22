import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AirlockApprovalRow, AirlockRoute, AirlockSlate } from './AirlockRoute'
import {
  airlockStats,
  approvalActions,
  approvalExpired,
  approvalFreshness,
  approvalIdentityComplete,
  approvalNotice,
  approvalAuditRows,
  parseSnapshot,
  type CockpitApproval
} from './runtime.types'

const NOW = Date.parse('2026-01-01T06:00:00.000Z')

const approval = (overrides: Partial<CockpitApproval>): CockpitApproval => ({
  id: 'inv-1',
  node: 'desk-display-01',
  capability: 'display.render',
  hash: 'h1',
  status: 'WAITING_APPROVAL',
  deadline: '2026-01-01T06:01:00.000Z',
  input: { project: 'project-zero' },
  input_omitted: false,
  ...overrides
})

const snapshotWith = (a: CockpitApproval): unknown => ({
  version: '0.1',
  revision: 5,
  timestamp: '2026-01-01T06:00:00.000Z',
  session: {
    id: 's1',
    project_id: 'p1',
    project: 'project-zero',
    state: 'RUNNING',
    elapsed_ms: 1000,
    since_ms: 1000,
    revision: 1
  },
  integrations: [],
  nodes: [],
  events: [],
  audit: [
    {
      seq: 10,
      time: '2026-01-01T05:00:00.000Z',
      action: 'approvals.approve',
      decision: 'APPROVED',
      principal: 'owner',
      target: 'inv-9',
      correlation: null
    },
    {
      seq: 11,
      time: '2026-01-01T05:00:01.000Z',
      action: 'integration.observed',
      decision: 'SUCCEEDED',
      principal: 'zerod',
      target: 'git',
      correlation: null
    }
  ],
  truncated: { approvals: false, audit: true },
  approvals: [a],
  policies: [{ id: 'git-refresh', status: 'READY', enabled: true }],
  firings: [1, 2, 3]
})

describe('parseSnapshot airlock fields', () => {
  it('parses approvals, policies, and the firing count from the projection', () => {
    const s = parseSnapshot(snapshotWith(approval({})))
    expect(s?.approvals).toHaveLength(1)
    expect(s?.approvals[0]).toMatchObject({
      id: 'inv-1',
      node: 'desk-display-01',
      capability: 'display.render',
      status: 'WAITING_APPROVAL'
    })
    expect(s?.policies).toEqual([{ id: 'git-refresh', status: 'READY', enabled: true }])
    expect(s?.firings).toBe(3)
  })

  it('tolerates a snapshot without the airlock fields', () => {
    const value = snapshotWith(approval({})) as Record<string, unknown>
    const { approvals, policies, firings, ...rest } = value
    void approvals
    void policies
    void firings
    const s = parseSnapshot(rest)
    expect(s).not.toBeNull()
    expect(s?.approvals).toEqual([])
    expect(s?.policies).toEqual([])
    expect(s?.firings).toBe(0)
  })

  it('skips malformed approval rows without dropping the snapshot', () => {
    const value = snapshotWith(approval({})) as Record<string, unknown>
    const s = parseSnapshot({
      ...value,
      approvals: [null, { id: 'x' }, { ...approval({}), status: 5 }, approval({ id: 'ok' })]
    })
    expect(s?.approvals).toHaveLength(1)
    expect(s?.approvals[0]?.id).toBe('ok')
  })
})

describe('approval authority', () => {
  it('completes identity only for fully populated WAITING_APPROVAL rows', () => {
    expect(approvalIdentityComplete(approval({}))).toBe(true)
    expect(approvalIdentityComplete(approval({ status: 'CANCELLED' }))).toBe(false)
    expect(approvalIdentityComplete(approval({ deadline: '' }))).toBe(false)
    expect(approvalIdentityComplete(approval({ node: '' }))).toBe(false)
    expect(approvalIdentityComplete(approval({ capability: '' }))).toBe(false)
    expect(approvalIdentityComplete(approval({ id: '' }))).toBe(false)
  })

  it('reads expiry from the RFC3339 deadline', () => {
    expect(approvalExpired(approval({}), NOW)).toBe(false)
    expect(approvalExpired(approval({ deadline: '2026-01-01T05:59:00.000Z' }), NOW)).toBe(true)
    expect(approvalExpired(approval({ deadline: 'unparseable' }), NOW)).toBe(false)
  })

  it('gates approve on live connection, identity, and deadline; deny only on live plus identity', () => {
    const fresh = approval({})
    expect(approvalActions('live', fresh, NOW)).toEqual({
      canApprove: true,
      canDeny: true,
      reason: null
    })
    expect(approvalActions('offline', fresh, NOW)).toEqual({
      canApprove: false,
      canDeny: false,
      reason: expect.stringContaining('retained snapshot evidence')
    })
    const expired = approval({ deadline: '2026-01-01T05:59:00.000Z' })
    expect(approvalActions('live', expired, NOW)).toEqual({
      canApprove: false,
      canDeny: true,
      reason: expect.stringContaining('deadline has passed')
    })
    const incomplete = approval({ id: '' })
    expect(approvalActions('live', incomplete, NOW).canApprove).toBe(false)
    expect(approvalActions('live', incomplete, NOW).canDeny).toBe(false)
  })

  it('names the freshness honestly: retained wins over expired while not live', () => {
    expect(approvalFreshness('live', approval({}), NOW)).toBe('live')
    expect(approvalFreshness('live', approval({ deadline: '2026-01-01T05:59:00.000Z' }), NOW)).toBe(
      'expired'
    )
    expect(approvalFreshness('offline', approval({}), NOW)).toBe('retained')
    expect(approvalFreshness('reconnecting', approval({}), NOW)).toBe('retained')
  })

  it('writes the retained-vs-live truth into the notice', () => {
    expect(approvalNotice('live', approval({}), NOW)).toContain('explicit owner decision')
    expect(approvalNotice('offline', approval({}), NOW)).toContain('retained snapshot evidence')
    expect(approvalNotice('live', approval({ input_omitted: true }), NOW)).toContain(
      'omits one or more input fields'
    )
    expect(
      approvalNotice('live', approval({ deadline: '2026-01-01T05:59:00.000Z' }), NOW)
    ).toContain('deadline has passed')
  })
})

describe('airlock stats', () => {
  it('counts every approval plus firing rows as pending evidence', () => {
    const stats = airlockStats(snapshotWith(approval({})))
    expect(stats.pending).toBe(4)
    expect(stats.runtime).toBe(1)
    expect(stats.codex).toBe(0)
    expect(stats.audited).toBe('1+')
  })

  it('stays at zero without a snapshot', () => {
    expect(airlockStats(null)).toEqual({
      pending: 0,
      runtime: 0,
      codex: 0,
      audited: '0'
    })
  })
})

describe('approval audit ledger', () => {
  it('keeps only approvals.* audit rows, events first ordering preserved', () => {
    const rows = approvalAuditRows(snapshotWith(approval({})))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ action: 'approvals.approve', decision: 'APPROVED' })
  })
})

describe('AirlockApprovalRow', () => {
  it('enables exact-ID approve and deny for a fresh live approval', () => {
    const html = renderToString(
      createElement(AirlockApprovalRow, {
        item: approval({}),
        conn: 'live',
        now: NOW
      })
    )
    expect(html).toContain('inv-1')
    expect(html).toContain('Approve exact request')
    expect(html).toContain('Deny exact request')
    expect(html).toContain('LIVE REQUEST')
    expect(html).not.toContain('disabled=""')
  })

  it('disables approve but keeps the daemon deny for an expired live approval', () => {
    const html = renderToString(
      createElement(AirlockApprovalRow, {
        item: approval({ deadline: '2026-01-01T05:59:00.000Z' }),
        conn: 'live',
        now: NOW
      })
    )
    expect(html).toContain('EXPIRED')
    expect(html).toContain('deadline has passed')
    expect(html.match(/disabled=""/g)).toHaveLength(1)
  })

  it('shows retained cached evidence with both actions disabled while offline', () => {
    const html = renderToString(
      createElement(AirlockApprovalRow, { item: approval({}), conn: 'offline', now: NOW })
    )
    expect(html).toContain('CACHED EVIDENCE')
    expect(html).toContain('retained snapshot evidence')
    expect(html.match(/disabled=""/g)).toHaveLength(2)
  })
})

describe('AirlockSlate', () => {
  it('renders the boundary slate with the exact approval id and stats', () => {
    const html = renderToString(
      createElement(AirlockSlate, { conn: 'live', snapshot: snapshotWith(approval({})), now: NOW })
    )
    expect(html).toContain('Airlock')
    expect(html).toContain('EXPLICIT LOCAL AUTHORITY')
    expect(html).toContain('ZEROD LIVE')
    expect(html).toContain('inv-1')
    expect(html).toContain('PENDING')
  })

  it('renders the lower-bound notice when approvals history is truncated', () => {
    const html = renderToString(
      createElement(AirlockSlate, { conn: 'live', snapshot: snapshotWith(approval({})), now: NOW })
    )
    expect(html).toContain('lower bound')
  })

  it('renders the idle state honestly while connecting', () => {
    const html = renderToString(
      createElement(AirlockSlate, { conn: 'connecting', snapshot: null, now: NOW })
    )
    expect(html).toContain('Boundary idle')
    expect(html).toContain('No current runtime decision can be inferred')
    expect(html).toContain('ZEROD CONNECTING')
  })
})

describe('AirlockRoute', () => {
  it('renders from the live store without contacting the daemon', () => {
    const html = renderToString(createElement(AirlockRoute))
    expect(html).toContain('EXPLICIT LOCAL AUTHORITY')
    expect(html).toContain('ZEROD CONNECTING')
    expect(html).toContain('Boundary idle')
  })
})
