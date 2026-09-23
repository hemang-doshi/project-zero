import { create } from 'zustand'
import type { RuntimeConnState } from '../../../shared/protocol'

export type CockpitState = {
  snapshot: unknown | null
  state: RuntimeConnState
  lastError: string | null
  refreshAt: number | null
}

export const useCockpit = create<CockpitState>(() => ({
  snapshot: null,
  state: 'connecting',
  lastError: null,
  refreshAt: null
}))

export function bindCockpit(): void {
  window.zero.subscribe('cockpit', (u) =>
    useCockpit.setState({
      snapshot: u.snapshot,
      state: u.state,
      lastError: u.lastError,
      refreshAt: u.receivedAt
    })
  )
}

export type Badge = 'LIVE' | 'STALE' | 'CONNECTING' | 'RECONNECTING' | 'OFFLINE'

export function badgeFor(
  state: RuntimeConnState,
  now: number,
  receivedAt: number | null,
  maxAgeMs: number
): Badge {
  if (state === 'offline') return 'OFFLINE'
  if (state === 'connecting') return 'CONNECTING'
  if (state === 'reconnecting') return receivedAt === null ? 'OFFLINE' : 'RECONNECTING'
  if (receivedAt == null || now - receivedAt > maxAgeMs) return 'STALE'
  return 'LIVE'
}
