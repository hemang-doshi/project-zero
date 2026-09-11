import { describe, it, expect, vi, type Mock } from 'vitest'
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
  cancels: Array<Mock<() => void>>
  updates: UpdateRec[]
}
function harness(): Harness {
  const streams: StreamCtl[] = []
  const fetches: FetchSlot[] = []
  const timers: Array<() => void> = []
  const cancels: Array<Mock<() => void>> = []
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
        let armed = true
        const wrapped = (): void => {
          if (armed) fn()
        }
        timers.push(wrapped)
        const cancel = vi.fn(() => {
          armed = false
        })
        cancels.push(cancel)
        return () => cancel()
      }
    }
  )
  const updates: UpdateRec[] = []
  model.subscribe((u) =>
    updates.push({ snapshot: u.snapshot, state: u.state, receivedAt: u.receivedAt })
  )
  return { model, streams, fetches, timers, cancels, updates }
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

  it('re-arms the age timer with a single pending timer (no accumulation)', async () => {
    const h = harness()
    h.model.start()
    await vi.waitFor(() => expect(h.streams).toHaveLength(1))
    h.streams[0].emit(ready())
    await vi.waitFor(() => expect(h.timers).toHaveLength(1))
    h.fetches[0].resolve({ revision: 1 })
    await vi.waitFor(() => expect(h.updates.at(-1)?.state).toBe('live'))
    await vi.waitFor(() => expect(h.timers).toHaveLength(2))
    for (let i = 1; i <= 3; i++) {
      h.streams[0].emit(changed(2 + i))
      await vi.waitFor(() => expect(h.fetches).toHaveLength(i + 1))
      h.fetches[i].resolve({ revision: 2 + i })
      await vi.waitFor(() => expect(h.timers).toHaveLength(i + 2))
    }
    // Four successes re-armed four times: each re-arm cancelled the previous
    // timer instead of stacking it, so only the newest timer is live.
    expect(h.timers).toHaveLength(5)
    expect(h.cancels.filter((c) => c.mock.calls.length > 0)).toHaveLength(4)
    h.timers[0]()
    h.timers[1]()
    h.timers[2]()
    expect(h.fetches).toHaveLength(4) // stale timer fns never schedule a refresh
    h.timers[4]() // the live timer still refreshes while streaming
    await vi.waitFor(() => expect(h.fetches).toHaveLength(5))
  })

  it('stop cancels the pending age timer', async () => {
    const h = harness()
    h.model.start()
    await vi.waitFor(() => expect(h.streams).toHaveLength(1))
    h.streams[0].emit(ready())
    await vi.waitFor(() => expect(h.timers).toHaveLength(1))
    h.model.stop()
    await vi.waitFor(() => expect(h.updates.at(-1)?.state).toBe('offline'))
    h.timers[0]() // cancelled: must not schedule a refresh
    expect(h.fetches).toHaveLength(1)
  })
})
