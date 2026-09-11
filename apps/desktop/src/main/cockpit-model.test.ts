import { describe, it, expect, vi } from 'vitest'
import { CockpitModel } from './cockpit-model'
import type { SSEEvent } from '../shared/protocol'

type StreamCtl = {
  emit: (e: SSEEvent) => void
  end: (err?: Error) => void
}
type FetchSlot = { resolve: (v: unknown) => void; reject: (e: Error) => void }
type UpdateRec = { snapshot: unknown | null; state: string; receivedAt: number | null }
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
  model.subscribe((u) =>
    updates.push({ snapshot: u.snapshot, state: u.state, receivedAt: u.receivedAt })
  )
  return { model, streams, fetches, timers, updates }
}

const ready = (rev = 1): SSEEvent => ({
  name: 'ready',
  data: JSON.stringify({ revision: rev, domains: [], timestamp: 't' })
})
const changed = (rev = 2): SSEEvent => ({
  name: 'runtime.changed',
  data: JSON.stringify({ revision: rev, domains: ['spotify'], timestamp: 't' })
})

describe('CockpitModel', () => {
  it('ready opens an epoch then fetches; runtime.changed keeps it live', async () => {
    const h = harness()
    h.model.start()
    await vi.waitFor(() => expect(h.streams).toHaveLength(1))
    h.streams[0].emit(ready())
    await vi.waitFor(() => expect(h.fetches).toHaveLength(1))
    h.fetches[0].resolve({ revision: 1 })
    await vi.waitFor(() => expect(h.updates.at(-1)?.state).toBe('live'))
    h.streams[0].emit(changed())
    await vi.waitFor(() => expect(h.fetches).toHaveLength(2))
    h.fetches[1].resolve({ revision: 2 })
    await vi.waitFor(() => expect(h.updates.at(-1)?.snapshot).toEqual({ revision: 2 }))
  })

  it('coalesces a burst into at most one active + one trailing fetch', async () => {
    const h = harness()
    h.model.start()
    await vi.waitFor(() => expect(h.streams).toHaveLength(1))
    h.streams[0].emit(ready())
    h.streams[0].emit(changed(3))
    h.streams[0].emit(changed(4))
    await vi.waitFor(() => expect(h.fetches).toHaveLength(1))
    h.fetches[0].resolve({ revision: 4 })
    await vi.waitFor(() => expect(h.fetches).toHaveLength(2))
    h.fetches[1].resolve({ revision: 4 })
    await vi.waitFor(() => expect(h.fetches).toHaveLength(2))
  })

  it('stream end invalidates in-flight fetch results and reconnects', async () => {
    const h = harness()
    h.model.start()
    await vi.waitFor(() => expect(h.streams).toHaveLength(1))
    h.streams[0].emit(ready())
    await vi.waitFor(() => expect(h.fetches).toHaveLength(1))
    h.streams[0].end(new Error('reset'))
    h.fetches[0].resolve({ revision: 99 }) // stale: must be discarded
    await vi.waitFor(() => expect(h.streams).toHaveLength(2)) // reconnect loop opened a second stream
    h.streams[1].emit(ready())
    h.fetches[1].resolve({ revision: 1 })
    await vi.waitFor(() => expect(h.updates.at(-1)?.snapshot).toEqual({ revision: 1 }))
  })

  it('age timer refreshes while live', async () => {
    const h = harness()
    h.model.start()
    await vi.waitFor(() => expect(h.streams).toHaveLength(1))
    h.streams[0].emit(ready())
    await vi.waitFor(() => expect(h.timers).toHaveLength(1))
    h.timers[0]() // simulate 5 s freshness expiry
    h.fetches.at(-1)!.resolve({ revision: 2 })
    await vi.waitFor(() => expect(h.updates.at(-1)?.snapshot).toEqual({ revision: 2 }))
  })
})
