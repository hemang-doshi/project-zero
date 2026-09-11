import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { CodexBridge, JsonRpcStdio, OpenCodeBridge } from './bridges'

type ParsedReq = { id?: unknown; method?: string; params?: unknown }
type SpawnRecord = { cmd: string; args: string[]; opts: Record<string, unknown> }
type FakeChild = {
  child: ChildProcess
  writes: string[]
  kills: string[]
  stdinEnded: boolean
  out: (line: string) => void
  err: (line: string) => void
  exit: (code: number) => void
  spawnError: (err: Error) => void
}

function fakeChild(script?: (req: ParsedReq, fake: FakeChild) => void): {
  fake: FakeChild
  spawnFn: (cmd: string, args: string[], opts: { cwd?: string }) => ChildProcess
  records: SpawnRecord[]
} {
  const writes: string[] = []
  const records: SpawnRecord[] = []
  const kills: string[] = []
  let stdinEnded = false
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  const child = new EventEmitter() as unknown as ChildProcess
  const stdin = new EventEmitter() as unknown as NodeJS.WritableStream
  const api: FakeChild = {
    child,
    writes,
    kills,
    get stdinEnded(): boolean {
      return stdinEnded
    },
    out: (line: string): void => {
      stdout.emit('data', Buffer.from(line + '\n', 'utf8'))
    },
    err: (line: string): void => {
      stderr.emit('data', Buffer.from(line + '\n', 'utf8'))
    },
    exit: (code: number): void => {
      child.emit('exit', code, 'SIGTERM')
    },
    spawnError: (e: Error): void => {
      child.emit('error', e)
    }
  }
  ;(stdin as unknown as { write: (d: string) => boolean }).write = (d: string): boolean => {
    writes.push(d)
    try {
      script?.(JSON.parse(d) as ParsedReq, api)
    } catch {
      return true
    }
    return true
  }
  ;(stdin as unknown as { end: (cb?: () => void) => void }).end = (cb?: () => void): void => {
    stdinEnded = true
    if (cb) cb()
  }
  ;(child as unknown as { kill: (signal?: string) => boolean }).kill = (
    signal?: string
  ): boolean => {
    kills.push(signal ?? 'SIGTERM')
    return true
  }
  Object.assign(child, { stdin, stdout, stderr })
  const spawnFn = (cmd: string, args: string[], opts: { cwd?: string }): ChildProcess => {
    records.push({ cmd, args, opts })
    return child
  }
  return { fake: api, spawnFn, records }
}

function writeCodexToolchain(dir: string, version: string): void {
  fs.mkdirSync(path.join(dir, `codex-${version}`), { recursive: true })
  fs.writeFileSync(path.join(dir, `codex-${version}`, 'codex'), '', { mode: 0o755 })
}

const codexInitialize = (req: ParsedReq, fake: FakeChild): void => {
  if (req.method === 'initialize' && req.id !== undefined) {
    fake.out(JSON.stringify({ id: req.id, result: {} }))
  }
}

const ocpInitialize = (req: ParsedReq, fake: FakeChild): void => {
  if (req.method === 'initialize' && req.id !== undefined) {
    fake.out(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: {} }))
  }
}

describe('JsonRpcStdio request correlation', () => {
  it('correlates a response id and resolves the send', async () => {
    const { fake, spawnFn } = fakeChild()
    const io = new JsonRpcStdio({ harness: 'codex', prefsDir: os.tmpdir(), spawnFn })
    await io.connect('codex', ['app-server', '--stdio'])
    expect(io.state).toBe('live')
    const p = io.send('ping', { x: 1 })
    const req = JSON.parse(fake.writes[0]) as { id: number; method: string; jsonrpc?: string }
    expect(req.method).toBe('ping')
    expect(req.jsonrpc).toBeUndefined()
    fake.out(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { ok: true } }))
    await expect(p).resolves.toEqual({ ok: true })
  })

  it('includes the jsonrpc field for the ACP wire', async () => {
    const ocp = fakeChild()
    const ocpIo = new JsonRpcStdio({
      harness: 'opencode',
      prefsDir: os.tmpdir(),
      spawnFn: ocp.spawnFn,
      jsonrpc: true
    })
    await ocpIo.connect('opencode', ['acp'])
    const p = ocpIo.send('ping')
    const ocpReq = JSON.parse(ocp.fake.writes[0]) as Record<string, unknown>
    expect(ocpReq['jsonrpc']).toBe('2.0')
    ocp.fake.out(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }))
    await expect(p).resolves.toEqual({})
    ocpIo.disconnect()
  })

  it('ignores a response for an unknown id without resolving the pending send', async () => {
    const { fake, spawnFn } = fakeChild()
    const io = new JsonRpcStdio({ harness: 'codex', prefsDir: os.tmpdir(), spawnFn })
    await io.connect('codex', ['app-server', '--stdio'])
    const p = io.send('ping')
    fake.out(JSON.stringify({ jsonrpc: '2.0', id: 999, result: { wrong: true } }))
    let settled = false
    void p.then(() => {
      settled = true
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(settled).toBe(false)
    fake.out(JSON.stringify({ id: 1, result: { right: true } }))
    await expect(p).resolves.toEqual({ right: true })
  })
})

describe('JsonRpcStdio process lifecycle', () => {
  it('rejects pending sends with disconnected on exit and sets state disconnected', async () => {
    const { fake, spawnFn } = fakeChild()
    const io = new JsonRpcStdio({ harness: 'codex', prefsDir: os.tmpdir(), spawnFn })
    await io.connect('codex', ['app-server', '--stdio'])
    const errors: string[] = []
    const p1 = io.send('a').catch((e: Error) => {
      errors.push(e.message)
    })
    const p2 = io.send('b').catch((e: Error) => {
      errors.push(e.message)
    })
    fake.exit(1)
    await p1
    await p2
    expect(errors).toEqual(['disconnected', 'disconnected'])
    expect(io.state).toBe('disconnected')
    expect(io.disconnect()).toBe('disconnected')
  })

  it('kills the child and closes stdin on disconnect', async () => {
    const { fake, spawnFn } = fakeChild()
    const io = new JsonRpcStdio({ harness: 'codex', prefsDir: os.tmpdir(), spawnFn })
    await io.connect('codex', ['app-server', '--stdio'])
    io.disconnect()
    expect(fake.kills).toEqual(['SIGTERM'])
    expect(fake.stdinEnded).toBe(true)
  })

  it('refuses a second connect while connected', async () => {
    const { spawnFn } = fakeChild()
    const io = new JsonRpcStdio({ harness: 'codex', prefsDir: os.tmpdir(), spawnFn })
    await io.connect('codex', ['app-server', '--stdio'])
    await expect(io.connect('codex', ['app-server', '--stdio'])).rejects.toThrow(
      /already connected/
    )
    io.disconnect()
  })

  it('surfaces a spawn error and leaves the bridge disconnected', async () => {
    const { fake, spawnFn } = fakeChild()
    const io = new JsonRpcStdio({
      harness: 'opencode',
      prefsDir: os.tmpdir(),
      spawnFn,
      handshake: async () => {
        await new Promise((r) => setTimeout(r, 10))
      }
    })
    const p = io.connect('opencode', ['acp'])
    fake.spawnError(new Error('spawn ENOENT'))
    await expect(p).rejects.toThrow(/spawn ENOENT/)
    expect(io.state).toBe('disconnected')
    await expect(io.send('ping')).rejects.toThrow(/^disconnected$/)
  })
})

describe('JsonRpcStdio response bounds', () => {
  it('rejects an oversized response over 1 MiB and disconnects', async () => {
    const { fake, spawnFn } = fakeChild()
    const io = new JsonRpcStdio({ harness: 'codex', prefsDir: os.tmpdir(), spawnFn })
    await io.connect('codex', ['app-server', '--stdio'])
    const p = io.send('thread/list')
    const oversized = JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'x'.repeat(1_100_000) })
    fake.out(oversized)
    await expect(p).rejects.toThrow(/too large/)
    expect(io.state).toBe('disconnected')
  })

  it('rejects an rpc error response such as an unknown method', async () => {
    const { fake, spawnFn } = fakeChild()
    const io = new JsonRpcStdio({ harness: 'codex', prefsDir: os.tmpdir(), spawnFn })
    await io.connect('codex', ['app-server', '--stdio'])
    const p = io.send('nope')
    const req = JSON.parse(fake.writes[0]) as { id: number }
    fake.out(
      JSON.stringify({
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32601, message: 'unknown method' }
      })
    )
    await expect(p).rejects.toThrow(/unknown method/)
    expect(io.state).toBe('live')
  })

  it('rejects a malformed response with neither result nor error', async () => {
    const { fake, spawnFn } = fakeChild()
    const io = new JsonRpcStdio({ harness: 'codex', prefsDir: os.tmpdir(), spawnFn })
    await io.connect('codex', ['app-server', '--stdio'])
    const p = io.send('ping')
    fake.out(JSON.stringify({ jsonrpc: '2.0', id: 1 }))
    await expect(p).rejects.toThrow(/invalid response/)
    expect(io.state).toBe('disconnected')
  })
})

describe('JsonRpcStdio event mirror', () => {
  it('appends one jsonl line per provider event under zero-meta/<harness>', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-mirror-'))
    const { fake, spawnFn } = fakeChild()
    const io = new JsonRpcStdio({ harness: 'codex', prefsDir: dir, spawnFn })
    await io.connect('codex', ['app-server', '--stdio'])
    const seen: string[] = []
    io.onEvent((ev) => {
      seen.push(ev.method)
    })
    fake.out(JSON.stringify({ method: 'turn/started', params: { x: 1 } }))
    fake.out(JSON.stringify({ method: 'thread/started', params: {} }))
    await new Promise((r) => setTimeout(r, 10))
    expect(seen).toEqual(['turn/started', 'thread/started'])
    const file = path.join(dir, 'zero-meta', 'codex', 'events.jsonl')
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    const first = JSON.parse(lines[0]) as { harness: string; event: { method: string } }
    expect(first.harness).toBe('codex')
    expect(first.event.method).toBe('turn/started')
  })

  it('keeps operating when the mirror cannot be written', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-ro-'))
    const blocker = path.join(dir, 'occupied')
    fs.writeFileSync(blocker, '')
    const { fake, spawnFn } = fakeChild()
    const io = new JsonRpcStdio({ harness: 'codex', prefsDir: blocker, spawnFn })
    await io.connect('codex', ['app-server', '--stdio'])
    const seen: string[] = []
    io.onEvent((ev) => {
      seen.push(ev.method)
    })
    fake.out(JSON.stringify({ method: 'turn/started', params: {} }))
    await new Promise((r) => setTimeout(r, 10))
    expect(seen).toEqual(['turn/started'])
    expect(io.state).toBe('live')
  })
})

describe('Harness lock', () => {
  it('refuses params that declare a foreign harness identity', async () => {
    const codex = fakeChild()
    const codexIo = new JsonRpcStdio({
      harness: 'codex',
      prefsDir: os.tmpdir(),
      spawnFn: codex.spawnFn
    })
    await codexIo.connect('codex', ['app-server', '--stdio'])
    await expect(codexIo.send('ping', { harness: 'opencode' })).rejects.toThrow(/harness mismatch/)

    const ocp = fakeChild()
    const ocpIo = new JsonRpcStdio({
      harness: 'opencode',
      prefsDir: os.tmpdir(),
      spawnFn: ocp.spawnFn,
      jsonrpc: true
    })
    await ocpIo.connect('opencode', ['acp'])
    await expect(ocpIo.send('ping', { harness: 'codex' })).rejects.toThrow(/harness mismatch/)
    codexIo.disconnect()
    ocpIo.disconnect()
  })

  it('mirrors opencode events under the opencode namespace', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-ocp-'))
    const { fake, spawnFn } = fakeChild()
    const io = new JsonRpcStdio({ harness: 'opencode', prefsDir: dir, spawnFn, jsonrpc: true })
    await io.connect('opencode', ['acp'])
    fake.out(JSON.stringify({ jsonrpc: '2.0', method: 'session.updated', params: {} }))
    await new Promise((r) => setTimeout(r, 10))
    const file = path.join(dir, 'zero-meta', 'opencode', 'events.jsonl')
    const line = JSON.parse(fs.readFileSync(file, 'utf8').trim()) as {
      harness: string
      event: { method: string }
    }
    expect(line.harness).toBe('opencode')
    expect(line.event.method).toBe('session.updated')
  })
})

describe('CodexBridge toolchain resolution', () => {
  it('fails with a clear message and never spawns when no toolchain exists', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-tool-'))
    const { records, spawnFn } = fakeChild()
    const bridge = new CodexBridge({ prefsDir: dir, toolchainsDir: dir, spawnFn })
    await expect(bridge.connect()).rejects.toThrow(/toolchain not found/i)
    expect(records).toHaveLength(0)
  })

  it('picks the newest codex-* directory and runs app-server --stdio', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-tool-'))
    writeCodexToolchain(dir, '0.9.0')
    writeCodexToolchain(dir, '0.10.0')
    const { spawnFn, records } = fakeChild(codexInitialize)
    const bridge = new CodexBridge({ prefsDir: dir, toolchainsDir: dir, spawnFn })
    expect(await bridge.connect()).toBe('live')
    expect(records).toHaveLength(1)
    expect(records[0].cmd).toBe(path.join(dir, 'codex-0.10.0', 'codex'))
    expect(records[0].args).toEqual(['app-server', '--stdio'])
    expect(bridge.state).toBe('live')
    bridge.disconnect()
    expect(bridge.state).toBe('disconnected')
  })
})

describe('OpenCodeBridge ACP invocation', () => {
  it('spawns opencode with the acp stdio arg and reaches live', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-ocp-bridge-'))
    const { fake, spawnFn, records } = fakeChild(ocpInitialize)
    const bridge = new OpenCodeBridge({ prefsDir: dir, spawnFn })
    expect(await bridge.connect()).toBe('live')
    expect(records).toHaveLength(1)
    expect(records[0].args).toEqual(['acp'])
    const req = JSON.parse(fake.writes[0]) as Record<string, unknown>
    expect(req['jsonrpc']).toBe('2.0')
    expect(req['method']).toBe('initialize')
    expect(bridge.state).toBe('live')
    await expect(bridge.connect()).rejects.toThrow(/already connected/)
    expect(bridge.disconnect()).toBe('disconnected')
  })
})
