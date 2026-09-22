/// <reference types="electron-vite/node" />
import { readFileSync } from 'node:fs'
import { Tray, Menu, nativeImage } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { elapsed } from '../shared/format'
import type { RuntimeConnState } from '../shared/protocol'
import type { CockpitModel, ModelUpdate } from './cockpit-model'
import trayTemplate from './assets/tray/trayTemplate.png?asset'
import trayTemplate2x from './assets/tray/trayTemplate@2x.png?asset'
import trayOrange from './assets/tray/trayOrange.png?asset'
import trayOrange2x from './assets/tray/trayOrange@2x.png?asset'

// Compact tray companion: runtime status, focus timer, delivery/attention,
// Open Zero Desktop, Quit. Nothing else — no project selection, no intent
// entry, no coding actions (product rule).

export type TrayActions = {
  openDesktop(): void
  quit(): void
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null

const asString = (v: unknown): string | null => (typeof v === 'string' ? v : null)

export function trayStatusLabel(conn: RuntimeConnState): string {
  switch (conn) {
    case 'connecting':
      return 'Connecting'
    case 'live':
      return 'Runtime live'
    case 'reconnecting':
      return 'Reconnecting'
    case 'offline':
      return 'Runtime offline'
  }
}

// Focus line: `H:MM:SS` (shared elapsed helper) or `No focus session`.
// Honest-state gate mirrors the renderer's extrapolate()/sessionChipTone
// discipline: a cached session never extrapolates (never reads as live) while
// the runtime is connecting/reconnecting/offline.
export function trayFocusLine(
  conn: RuntimeConnState,
  snapshot: unknown,
  now: number,
  receivedAt: number | null
): string {
  const session = readSession(snapshot)
  if (session === null || session.state === 'IDLE') return 'No focus session'
  const ticking = conn === 'live' && session.state === 'RUNNING'
  const ms =
    ticking && receivedAt !== null
      ? session.elapsedMs + Math.max(0, now - receivedAt)
      : session.elapsedMs
  return elapsed(ms)
}

// Delivery/attention line from the snapshot when present. Gated on `live`:
// cached delivery evidence never claims freshness while reconnecting/offline.
export function trayDetailLine(conn: RuntimeConnState, snapshot: unknown): string | null {
  if (conn !== 'live') return null
  const root = asRecord(snapshot)
  if (root === null) return null
  const session = readSession(snapshot)
  if (session === null) return null
  const delivery = deliveryLabel(root, session.state)
  const attention = attentionCount(root)
  return `${delivery} · Attention ${attention.count}${attention.lowerBound ? '+' : ''}`
}

type SessionLite = { state: string; elapsedMs: number }

function readSession(snapshot: unknown): SessionLite | null {
  const root = asRecord(snapshot)
  const s = root === null ? null : asRecord(root.session)
  if (s === null) return null
  const state = asString(s.state)
  const ms = s.elapsed_ms
  if (state === null || typeof ms !== 'number' || !Number.isFinite(ms)) return null
  return { state, elapsedMs: ms }
}

const DISPLAY_CAPS = ['display.render', 'display.clear']

// Delivery label from the latest display invocation, mapped after the Swift
// companion's deliveryState presentation; without display invocations the
// Swift fallback applies (idle → stale, otherwise committed locally).
function deliveryLabel(root: Record<string, unknown>, sessionState: string): string {
  const invocations = Array.isArray(root.invocations) ? root.invocations : []
  const latest = invocations.map(asRecord).find((r): r is Record<string, unknown> => {
    if (r === null) return false
    const capability = asString(r.capability)
    return capability !== null && DISPLAY_CAPS.includes(capability)
  })
  if (latest === undefined) {
    return sessionState === 'IDLE' ? 'Stale or uncertain' : 'Committed locally'
  }
  switch (asString(latest.status)?.toUpperCase()) {
    case 'SUCCEEDED':
      return 'Delivered'
    case 'DISPATCHED':
      return 'Awaiting delivery'
    case 'QUEUED':
    case 'WAITING_APPROVAL':
      return 'Queued'
    default:
      return 'Stale or uncertain'
  }
}

// Owner-attention count: snapshot approvals plus PENDING policy firings; a
// truncated collection yields a lower-bound count (`+` suffix).
function attentionCount(root: Record<string, unknown>): { count: number; lowerBound: boolean } {
  const approvals = Array.isArray(root.approvals) ? root.approvals.length : 0
  const firings = Array.isArray(root.firings) ? root.firings : []
  const pendingFirings = firings.reduce((n, f) => {
    const r = asRecord(f)
    return r !== null && asString(r.state) === 'PENDING' ? n + 1 : n
  }, 0)
  const truncated = asRecord(root.truncated)
  const lowerBound =
    truncated !== null && (truncated.approvals === true || truncated.firings === true)
  return { count: approvals + pendingFirings, lowerBound }
}

export function trayMenuItems(
  update: ModelUpdate,
  now: number,
  actions: TrayActions
): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [
    { label: trayStatusLabel(update.state), enabled: false },
    {
      label: trayFocusLine(update.state, update.snapshot, now, update.receivedAt),
      enabled: false
    }
  ]
  const detail = trayDetailLine(update.state, update.snapshot)
  if (detail !== null) items.push({ label: detail, enabled: false })
  items.push(
    { type: 'separator' },
    { label: 'Open Zero Desktop', click: () => actions.openDesktop() },
    { label: 'Quit', click: () => actions.quit() }
  )
  return items
}

// Tray icon sourced from real build assets (Task 16): a 16×16 black-alpha
// template PNG plus an explicitly added 32×32 @2x representation — hashed
// asset filenames defeat Electron's sibling `@2x` convention, so the retina
// representation is added by hand. The non-template fallback is rendered at
// icon-generation time from ZERO_TOKENS.brandOrange (see tools/make-icon.sh).
export function trayIcon(): Electron.NativeImage {
  const img = nativeImage.createFromPath(trayTemplate)
  if (!img.isEmpty()) {
    img.addRepresentation({ scaleFactor: 2, buffer: readFileSync(trayTemplate2x) })
    img.setTemplateImage(true)
    return img
  }
  const fallback = nativeImage.createFromPath(trayOrange)
  if (!fallback.isEmpty()) {
    fallback.addRepresentation({ scaleFactor: 2, buffer: readFileSync(trayOrange2x) })
  }
  return fallback
}

export function createTray(model: CockpitModel, actions: TrayActions): Tray {
  const tray = new Tray(trayIcon())
  tray.setToolTip('Zero')
  let last: ModelUpdate = { snapshot: null, state: 'connecting', receivedAt: null, lastError: null }
  let lastSignature: string | null = null
  const signature = (): string =>
    trayMenuItems(last, Date.now(), actions)
      .map((i) => (typeof i.label === 'string' ? i.label : ''))
      .join('\n')
  const rebuild = (): void => {
    const sig = signature()
    if (sig === lastSignature) return
    lastSignature = sig
    tray.setContextMenu(Menu.buildFromTemplate(trayMenuItems(last, Date.now(), actions)))
  }
  model.subscribe((u) => {
    last = u
    rebuild()
  })
  // The focus timer ticks between model pushes (daemon events arrive in
  // bursts); the label signature keeps this 1 s check cheap: while live and
  // RUNNING the H:MM:SS line changes each tick and the menu rebuilds, while
  // offline/IDLE pushes and ticks with unchanged labels skip setContextMenu.
  setInterval(rebuild, 1_000)
  return tray
}
