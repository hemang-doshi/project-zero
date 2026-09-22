import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import { join } from 'node:path'

export type BridgeState = 'disconnected' | 'connecting' | 'live'
export type HarnessId = 'codex' | 'opencode'

export const MAX_RESPONSE_BYTES = 1_048_576
export const ZERO_VERSION = '0.2.0'

export type SpawnFn = (cmd: string, args: string[], opts: { cwd?: string }) => ChildProcess

export type RpcEvent = { method: string; id?: unknown; params?: unknown }

export type JsonRpcStdioOpts = {
  harness: HarnessId
  prefsDir: string
  spawnFn?: SpawnFn
  jsonrpc?: boolean
  clientVersion?: string
  requestTimeoutMs?: number
  handshake?: (io: JsonRpcStdio) => Promise<void>
}

type PendingEntry = {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

const cleanups: Array<() => void> = []
let cleanupHooked = false

function hookProcessExit(): void {
  if (cleanupHooked) return
  cleanupHooked = true
  process.on('exit', () => {
    for (const fn of cleanups) {
      try {
        fn()
      } catch {
        /* process is exiting; nothing further can be reported */
      }
    }
  })
}

export class JsonRpcStdio {
  readonly events: EventEmitter = new EventEmitter()
  private readonly harness: HarnessId
  private readonly prefsDir: string
  private readonly spawnFn: SpawnFn
  private readonly jsonrpc: boolean
  private readonly clientVersion: string
  private readonly requestTimeoutMs: number
  private readonly handshake: ((io: JsonRpcStdio) => Promise<void>) | null
  private child: ChildProcess | null = null
  private session = 0
  private buffer = ''
  private pending = new Map<number, PendingEntry>()
  private nextId = 0
  private _state: BridgeState = 'disconnected'
  private lastFailure: Error | null = null
  private lastDiagnostic: string | null = null

  constructor(opts: JsonRpcStdioOpts) {
    this.harness = opts.harness
    this.prefsDir = opts.prefsDir
    this.spawnFn = opts.spawnFn ?? spawn
    this.jsonrpc = opts.jsonrpc === true
    this.clientVersion = opts.clientVersion ?? ZERO_VERSION
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 30_000
    this.handshake = opts.handshake ?? null
    cleanups.push(() => {
      this.disconnect()
    })
    hookProcessExit()
  }

  get state(): BridgeState {
    return this._state
  }

  get diagnostics(): string | null {
    return this.lastDiagnostic
  }

  get version(): string {
    return this.clientVersion
  }

  get harnessId(): HarnessId {
    return this.harness
  }

  async connect(cmd: string, args: string[], cwd?: string): Promise<BridgeState> {
    if (this._state !== 'disconnected') throw new Error('already connected')
    this.session += 1
    const session = this.session
    this._state = 'connecting'
    this.buffer = ''
    this.lastFailure = null
    let child: ChildProcess
    try {
      child = this.spawnFn(cmd, args, cwd ? { cwd } : {})
    } catch (err) {
      this._state = 'disconnected'
      throw err instanceof Error ? err : new Error(String(err))
    }
    if (!child.stdin || !child.stdout || !child.stderr) {
      this._state = 'disconnected'
      throw new Error(`harness stdio unavailable for ${cmd}`)
    }
    this.child = child
    child.stdout.on('data', (chunk: Buffer) => {
      this.onStdout(session, chunk)
    })
    child.stderr.on('data', () => {
      this.onStderr(session)
    })
    child.on('exit', (code: number) => {
      this.onExit(session, code)
    })
    child.on('error', (err: Error) => {
      this.onSpawnError(session, err)
    })
    try {
      if (this.handshake) await this.handshake(this)
    } catch (err) {
      this.failAll(session, err instanceof Error ? err : new Error(String(err)))
      throw err instanceof Error ? err : new Error(String(err))
    }
    if (this.session !== session) throw this.lastFailure ?? new Error('disconnected')
    this._state = 'live'
    return this._state
  }

  send(method: string, params?: unknown): Promise<unknown> {
    if (this._state !== 'connecting' && this._state !== 'live') {
      return Promise.reject(new Error('disconnected'))
    }
    const declared = declaredHarness(params)
    if (declared && declared !== this.harness) {
      return Promise.reject(
        new Error(`harness mismatch: ${this.harness} bridge cannot operate ${declared} harness`)
      )
    }
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.onTimeout(id)
      }, this.requestTimeoutMs)
      const entry: PendingEntry = { resolve, reject, timer }
      this.pending.set(id, entry)
      try {
        this.write({ id, method, params: params ?? {} })
      } catch (err) {
        this.failAll(this.session, err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  notify(method: string, params?: unknown): void {
    if (this._state !== 'connecting' && this._state !== 'live') {
      throw new Error('disconnected')
    }
    const msg: Record<string, unknown> = { method }
    if (params !== undefined) msg['params'] = params
    try {
      this.write(msg)
    } catch (err) {
      this.failAll(this.session, err instanceof Error ? err : new Error(String(err)))
    }
  }

  disconnect(): BridgeState {
    this.failAll(this.session, new Error('disconnected'))
    return this._state
  }

  onEvent(cb: (ev: RpcEvent) => void): () => void {
    this.events.on('event', cb)
    return () => {
      this.events.off('event', cb)
    }
  }

  private onTimeout(id: number): void {
    const entry = this.pending.get(id)
    if (!entry) return
    this.pending.delete(id)
    clearTimeout(entry.timer)
    entry.reject(new Error('request timed out'))
  }

  private write(msg: Record<string, unknown>): void {
    const child = this.child
    if (!child || !child.stdin) throw new Error('disconnected')
    const line = JSON.stringify(this.jsonrpc ? { jsonrpc: '2.0', ...msg } : msg)
    child.stdin.write(line + '\n')
  }

  private onStdout(session: number, chunk: Buffer): void {
    if (session !== this.session || !this.child) return
    this.buffer += chunk.toString('utf8')
    for (;;) {
      const idx = this.buffer.indexOf('\n')
      if (idx < 0) break
      const line = this.buffer.slice(0, idx)
      this.buffer = this.buffer.slice(idx + 1)
      this.handleLine(session, line)
      if (session !== this.session) return
    }
    if (this.buffer.length > MAX_RESPONSE_BYTES) {
      this.failAll(session, new Error('response too large (over 1 MiB)'))
    }
  }

  private onStderr(session: number): void {
    if (session !== this.session) return
    // stderr is untrusted and can echo prompt text or tool output.
    this.lastDiagnostic = `${this.harness} emitted stderr; content withheld`
  }

  private onExit(session: number, code: number): void {
    if (session !== this.session) return
    this.lastDiagnostic = `${this.harness} exited with status ${code}`
    this.failAll(session, new Error('disconnected'))
  }

  private onSpawnError(session: number, err: Error): void {
    if (session !== this.session) return
    this.failAll(session, new Error(`harness process error: ${err.message}`))
  }

  private handleLine(session: number, line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    if (trimmed.length > MAX_RESPONSE_BYTES) {
      this.failAll(session, new Error('response too large (over 1 MiB)'))
      return
    }
    let msg: unknown
    try {
      msg = JSON.parse(trimmed)
    } catch {
      this.failAll(session, new Error('invalid message from harness'))
      return
    }
    if (!isPlainObject(msg)) {
      this.failAll(session, new Error('invalid message from harness'))
      return
    }
    const fields = msg as Record<string, unknown>
    if (typeof fields['method'] === 'string') {
      const ev: RpcEvent = { method: fields['method'] }
      if ('id' in fields) ev.id = fields['id']
      if ('params' in fields) ev.params = fields['params']
      this.deliverEvent(ev)
      return
    }
    if (fields['id'] === undefined || fields['id'] === null) {
      this.failAll(session, new Error('invalid response'))
      return
    }
    const hasResult = 'result' in fields
    const hasError = 'error' in fields
    if (hasResult === hasError) {
      this.failAll(session, new Error('invalid response'))
      return
    }
    if (typeof fields['id'] !== 'number') return
    const entry = this.pending.get(fields['id'])
    if (!entry) return
    this.pending.delete(fields['id'])
    clearTimeout(entry.timer)
    if (hasError) {
      const errObj = fields['error']
      if (
        !isPlainObject(errObj) ||
        typeof (errObj as Record<string, unknown>)['message'] !== 'string'
      ) {
        entry.reject(new Error('invalid response'))
        this.failAll(session, new Error('invalid response'))
        return
      }
      const code =
        typeof (errObj as Record<string, unknown>)['code'] === 'number'
          ? (errObj as Record<string, number>)['code']
          : 0
      // Provider messages may echo the prompt. Preserve only the numeric code.
      entry.reject(new Error(`rpc ${code}: provider rejected request`))
    } else {
      entry.resolve(fields['result'])
    }
  }

  private deliverEvent(ev: RpcEvent): void {
    this.events.emit('event', ev)
    this.mirror(ev)
  }

  private mirror(ev: RpcEvent): void {
    try {
      // The wire event can include prompts, credentials and tool output. The
      // disk mirror is metadata only and bounded; existing history is left intact.
      if (!/^[a-zA-Z][a-zA-Z0-9/._-]{0,100}$/.test(ev.method)) return
      const file = join(this.prefsDir, 'zero-meta', this.harness, 'events.jsonl')
      fs.mkdirSync(join(this.prefsDir, 'zero-meta', this.harness), { recursive: true })
      if (fs.existsSync(file) && fs.statSync(file).size >= 512_000) return
      fs.appendFileSync(
        file,
        JSON.stringify({
          ts: new Date().toISOString(),
          harness: this.harness,
          event: { method: ev.method }
        }) + '\n'
      )
    } catch {
      /* fail-soft: a read-only mirror must never wedge the bridge */
    }
  }

  private failAll(session: number, reason: Error): void {
    if (session !== this.session) return
    this.session += 1
    this._state = 'disconnected'
    const child = this.child
    this.child = null
    this.buffer = ''
    this.lastFailure = reason
    if (child) {
      try {
        child.stdin?.end()
      } catch {
        /* stdin may already be gone; the kill below is authoritative */
      }
      try {
        child.kill()
      } catch {
        /* a dead child cannot be killed again */
      }
    }
    const entries = [...this.pending.values()]
    this.pending.clear()
    for (const entry of entries) {
      clearTimeout(entry.timer)
      entry.reject(reason)
    }
  }
}

export class CodexBridge {
  private readonly io: JsonRpcStdio
  private readonly toolchainsDir: string

  constructor(opts: {
    prefsDir: string
    toolchainsDir?: string
    spawnFn?: SpawnFn
    clientVersion?: string
  }) {
    this.toolchainsDir =
      opts.toolchainsDir ??
      join(process.env.HOME ?? '', 'Library', 'Application Support', 'ProjectZero', 'toolchains')
    this.io = new JsonRpcStdio({
      harness: 'codex',
      prefsDir: opts.prefsDir,
      spawnFn: opts.spawnFn,
      clientVersion: opts.clientVersion,
      handshake: async (io) => {
        await io.send('initialize', {
          clientInfo: { name: 'project_zero', title: 'Project Zero', version: io.version },
          capabilities: { experimentalApi: false }
        })
        io.notify('initialized')
      }
    })
  }

  get state(): BridgeState {
    return this.io.state
  }

  get lastDiagnostic(): string | null {
    return this.io.diagnostics
  }

  async connect(): Promise<BridgeState> {
    if (this.io.state !== 'disconnected') throw new Error('already connected')
    const exe = resolveCodexToolchain(this.toolchainsDir)
    return this.io.connect(exe, ['app-server', '--stdio'])
  }

  disconnect(): BridgeState {
    return this.io.disconnect()
  }

  send(method: string, params?: unknown): Promise<unknown> {
    return this.io.send(method, params)
  }

  onEvent(cb: (ev: RpcEvent) => void): () => void {
    return this.io.onEvent(cb)
  }
}

const OPENCODE_CANDIDATES = ['/opt/homebrew/bin/opencode', '/usr/local/bin/opencode']

export class OpenCodeBridge {
  private readonly io: JsonRpcStdio
  private readonly executablePath: string | null

  constructor(opts: {
    prefsDir: string
    spawnFn?: SpawnFn
    executablePath?: string
    clientVersion?: string
  }) {
    this.executablePath = opts.executablePath ?? null
    this.io = new JsonRpcStdio({
      harness: 'opencode',
      prefsDir: opts.prefsDir,
      spawnFn: opts.spawnFn,
      clientVersion: opts.clientVersion,
      jsonrpc: true,
      handshake: async (io) => {
        await io.send('initialize', {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: 'project_zero', version: io.version }
        })
      }
    })
  }

  get state(): BridgeState {
    return this.io.state
  }

  get lastDiagnostic(): string | null {
    return this.io.diagnostics
  }

  async connect(): Promise<BridgeState> {
    if (this.io.state !== 'disconnected') throw new Error('already connected')
    const exe =
      this.executablePath ?? OPENCODE_CANDIDATES.find((p) => fs.existsSync(p)) ?? 'opencode'
    return this.io.connect(exe, ['acp'])
  }

  disconnect(): BridgeState {
    return this.io.disconnect()
  }

  send(method: string, params?: unknown): Promise<unknown> {
    return this.io.send(method, params)
  }

  onEvent(cb: (ev: RpcEvent) => void): () => void {
    return this.io.onEvent(cb)
  }
}

export type BridgeDeps = { codex: CodexBridge; ocp: OpenCodeBridge }

export function createBridgePair(opts: {
  prefsDir: string
  spawnFn?: SpawnFn
  clientVersion?: string
}): BridgeDeps {
  return { codex: new CodexBridge(opts), ocp: new OpenCodeBridge(opts) }
}

export function resolveCodexToolchain(dir: string): string {
  let names: string[] = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    names = []
  }
  const candidates = names.filter((n) => n.startsWith('codex-')).sort(compareVersionsDescending)
  for (const name of candidates) {
    const exe = join(dir, name, 'codex')
    try {
      fs.accessSync(exe, fs.constants.X_OK)
      return exe
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error(
    `Codex toolchain not found under ${dir} (expected codex-*/codex). Install it, then reconnect.`
  )
}

function compareVersionsDescending(a: string, b: string): number {
  const va = a.slice('codex-'.length).split('.')
  const vb = b.slice('codex-'.length).split('.')
  const length = Math.max(va.length, vb.length)
  for (let i = 0; i < length; i++) {
    const na = Number(va[i]) || 0
    const nb = Number(vb[i]) || 0
    if (na !== nb) return nb - na
  }
  return vb.join('.').localeCompare(va.join('.'))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function declaredHarness(params: unknown): HarnessId | null {
  if (!isPlainObject(params)) return null
  const value = params['harness']
  if (value === 'codex' || value === 'opencode') return value
  return null
}
