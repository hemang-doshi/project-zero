import { describe, it, expect, vi } from 'vitest'
import { OPS, validateOp } from './ipc'
import { CockpitModel } from '../main/cockpit-model'
import type { SSEEvent } from './protocol'

describe('validateOp', () => {
  it('accepts whitelisted ops and rejects unknown ones', () => {
    expect(validateOp('command.send')).toBe(true)
    expect(validateOp('prefs.get')).toBe(true)
    expect(validateOp('fs.read')).toBe(false)
    expect(validateOp('exec')).toBe(false)
  })
  it('rejects prototype-inherited keys, not just unknown strings', () => {
    expect(validateOp('toString')).toBe(false)
    expect(validateOp('constructor')).toBe(false)
    expect(validateOp('hasOwnProperty')).toBe(false)
  })
  it('exposes exactly the planned op set', () => {
    expect(Object.keys(OPS).sort()).toEqual(
      [
        'codex.connect',
        'codex.disconnect',
        'codex.discover',
        'codex.send',
        'codex.state',
        'command.send',
        'ocp.connect',
        'ocp.disconnect',
        'ocp.discover',
        'ocp.send',
        'ocp.state',
        'prefs.get',
        'prefs.set',
        'project.get',
        'snapshot.fetch',
        'wallpaper.pick'
      ].sort()
    )
  })
})

type StreamCtl = {
  emit: (e: SSEEvent) => void
  end: (err?: Error) => void
}
type FetchSlot = { resolve: (v: unknown) => void; reject: (e: Error) => void }
type UpdateRec = { state: string; lastError: string | null }
type Harness = {
  model: CockpitModel
  streams: StreamCtl[]
  fetches: FetchSlot[]
  timers: Array<() => void>
  updates: UpdateRec[]
}
function harness(): Harness {
  const streams: StreamCtl[] = []
  const fetches: FetchSlot[] = []
  const timers: Array<() => void> = []
  const model = new CockpitModel(
    '/tmp/fake.sock',
    () => new Promise((resolve, reject) => fetches.push({ resolve, reject })),
    (_socket, onEvent, onEnd) => {
      const ctl: StreamCtl = {
        emit: (e) => {
          try {
            onEvent(e)
          } catch (err) {
            onEnd(err instanceof Error ? err : undefined)
          }
        },
        end: (e) => onEnd(e)
      }
      streams.push(ctl)
      return () => {}
    },
    {
      schedule: (fn) => {
        timers.push(fn)
        return () => {}
      }
    }
  )
  const updates: UpdateRec[] = []
  model.subscribe((u) => updates.push({ state: u.state, lastError: u.lastError }))
  return { model, streams, fetches, timers, updates }
}

const ready = (rev = 1): SSEEvent => ({
  name: 'ready',
  data: JSON.stringify({ revision: rev, domains: [], timestamp: 't' })
})

describe('CockpitModel fetch failure and stop', () => {
  it('fetch failure surfaces offline with lastError and stays age-scheduled', async () => {
    const h = harness()
    h.model.start()
    await vi.waitFor(() => expect(h.streams).toHaveLength(1))
    h.streams[0].emit(ready())
    await vi.waitFor(() => expect(h.fetches).toHaveLength(1))
    const timersAfterReady = h.timers.length
    expect(timersAfterReady).toBeGreaterThanOrEqual(1)
    h.fetches[0].reject(new Error('ECONNREFUSED'))
    await vi.waitFor(() => expect(h.updates.at(-1)?.state).toBe('offline'))
    expect(h.updates.at(-1)?.lastError).toBe('ECONNREFUSED')
    expect(h.timers.length).toBeGreaterThan(timersAfterReady)
  })

  it('stop() drops state to offline and later stream events trigger nothing', async () => {
    const h = harness()
    h.model.start()
    await vi.waitFor(() => expect(h.streams).toHaveLength(1))
    h.model.stop()
    await vi.waitFor(() => expect(h.updates.at(-1)?.state).toBe('offline'))
    h.streams[0].emit(ready())
    h.streams[0].end(new Error('late end'))
    await new Promise((r) => setTimeout(r, 20))
    expect(h.fetches).toHaveLength(0)
    expect(h.streams).toHaveLength(1)
    expect(h.updates.at(-1)?.state).toBe('offline')
  })
})
