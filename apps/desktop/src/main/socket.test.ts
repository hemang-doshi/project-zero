import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import * as http from 'node:http'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fetchSnapshot, openStream } from './socket'

const sockPath = path.join(os.tmpdir(), `zero-test-${process.pid}.sock`)

const server = http.createServer((req, res) => {
  if (req.url === '/v0.1/cockpit') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  } else if (req.url === '/v0.1/cockpit/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write('event: ready\ndata: {"revision":1,"domains":[],"timestamp":"t"}\n\n')
  } else {
    res.writeHead(404)
    res.end()
  }
})

function startServer(): Promise<void> {
  return new Promise((resolve) => server.listen(sockPath, () => resolve()))
}

beforeAll(async () => {
  try {
    fs.unlinkSync(sockPath)
  } catch {
    /* no stale socket */
  }
  await startServer()
})

afterAll(() => {
  server.close()
  try {
    fs.unlinkSync(sockPath)
  } catch {
    /* already gone */
  }
})

describe('fetchSnapshot', () => {
  it('reads JSON over the unix socket', async () => {
    const value = await fetchSnapshot(sockPath)
    expect(value).toEqual({ ok: true })
  })
  it('rejects non-200 responses', async () => {
    await expect(fetchSnapshot(sockPath, { path: '/v0.1/nope' })).rejects.toThrow()
  })
})

describe('openStream', () => {
  it('delivers parsed events and ends cleanly', async () => {
    const events: unknown[] = []
    let ended = false
    const stop = openStream(
      sockPath,
      (e) => events.push(e),
      () => {
        ended = true
      }
    )
    await new Promise((r) => setTimeout(r, 100))
    server.closeAllConnections?.()
    await new Promise((r) => setTimeout(r, 100))
    expect(events[0]).toMatchObject({ name: 'ready' })
    expect(ended).toBe(true)
    stop()
  })
})
