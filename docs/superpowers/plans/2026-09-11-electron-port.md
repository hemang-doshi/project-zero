# Electron Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SwiftUI cockpit with a parallel Electron app at `apps/desktop/` that recreates the Stitch design as an in-window desktop (draggable/resizable windows, icons, dummy files, customizable wallpaper) against the unchanged Go daemon.

**Architecture:** Three processes — sandboxed React renderer, typed `contextBridge` preload, TypeScript main process owning all I/O (Unix-socket HTTP/SSE to `zero.sock`, Codex/OpenCode stdio bridges, JSON prefs). Daemon, CLI, protocol, firmware, and native helpers are untouched.

**Tech Stack:** Electron + electron-vite, React 18, TypeScript (strict), Zustand, react-rnd, Tailwind, Vitest, Playwright (Electron driver), electron-builder.

**Spec:** `docs/superpowers/specs/2026-09-11-electron-port-design.md` (read it first; this plan argues from it).

## Global Constraints

- New code lives under `apps/desktop/` only. No production install, no daemon/service/database change, no signing-identity changes during this plan. Packaging produces artifacts only (Task 16).
- Renderer sandbox: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`. All I/O via main.
- Socket: `$HOME/Library/Application Support/ProjectZero/zero.sock`. Endpoints: `GET /v0.1/cockpit`, `GET /v0.1/cockpit/stream` (SSE events `ready` | `runtime.changed` | `keepalive` with body `{revision, domains, timestamp}`, `domains.length <= 100`), `POST /v0.1/commands` (body `{id, op, body}` — all session/approval/integration actions ride this single endpoint, matching `RuntimeCommandRequest` in `apps/macos/Sources/ZeroCockpit/CockpitModel.swift:47`), `GET /v0.1/projects/{id}`.
- Exact theme tokens (from `Theme.swift` / `ZeroControls.swift`): `brandOrange #F54E00`, `primaryAuthority #A83300`, `cardCream #FAF8F5`, `navCream #F3ECDF`, `navBorder #DED7CA`, `canvasTan #E9E3D7`, `windowCanvas #DBE3D3`, `hoverOrange #E04700`, `markerYellow #F7DF94`, `statusGreen #10B981`, `highlightBlue #3B82F6`, `errorRed #DC2626`, `wallpaper #8C9E82`, `wallpaperDot #7A8C70`, `ink #191C20`, `secondaryInk #5C4038`, `line #DED7CA`, `orange #F54E00`, `orangePressed #A83300`. Do not invent new tokens.
- Fonts: Inter (`Font.zero` port, system-ui fallback); mono `ui-monospace` stack (JetBrains Mono portability is a later owner decision).
- Window geometry constants (from `DesktopWindows.swift`): clamp 320–1100 × 240–900; default 560×480; cascade step 28 wrapping at 8; migration tolerance 40, spacing 48, inset 32.
- Model constants (from `CockpitClient`): reconnect delay 1 s, max snapshot age 5 s.
- Routes: `desk, runtime, network, flightRecorder, airlock, zeroBot, skillLab` (rawValues, titles Desk/Runtime/Network/Flight Recorder/Airlock/Zero Bot/Skill Lab). The Swift enum has 7 routes; all 7 are ported for parity (the spec's "six" counted the Stitch screens; Skill Lab exists in source and must not be silently dropped).
- All manual/open manual rules preserved: Codex/OpenCode are manual connect; send honestly blocked until runtime path exists; approval authority exact-ID.
- Record every resolved dependency version in `apps/desktop/package.json`; do not leave `latest` in committed manifests.
- Every task ends with its tests green (`npm test` in `apps/desktop/`) and a focused commit (`git add` only its files — the repo has unrelated dirty files, never `git add -A`).
- Subagent-driven execution: one subagent per task, sequential, per-task scoped review, ledger `.superpowers/sdd/2026-09-11-electron-port/progress.md`.

---

### Task 1: Scaffold `apps/desktop` (electron-vite, React+TS, Vitest)

**Files:**
- Create: `apps/desktop/` (whole scaffold), `apps/desktop/package.json`, `apps/desktop/electron.vite.config.ts`, `apps/desktop/vitest.config.ts`, `apps/desktop/.gitignore`
- Modify: repo `.gitignore` (add `apps/desktop/node_modules`, `apps/desktop/out` if repo gitignore doesn't already cover)

**Interfaces:**
- Produces: `apps/desktop` with scripts `dev` (electron-vite dev), `build` (electron-vite build), `test` (vitest run). Directory layout: `src/main/`, `src/preload/`, `src/renderer/`.

- [ ] **Step 1: Scaffold**

```sh
mkdir -p apps && cd apps
npm create @quick-start/electron@latest desktop -- --template react-ts
cd desktop && npm install
```

Replace the scaffold's demo UI with a placeholder `<h1>Zero Desktop</h1>` in `src/renderer/src/App.tsx` and a minimal `BrowserWindow` main entry (remove the auto-update and title-bar demo code the template ships).

- [ ] **Step 2: Add dev deps + scripts**

```sh
npm i react react-dom zustand react-rnd
npm i -D vitest @vitest/coverage-v8 electron-builder playwright
```

`package.json` scripts become:

```json
{
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "test": "vitest run",
    "e2e": "playwright test"
  }
}
```

- [ ] **Step 3: Vitest config for main-process units**

Create `apps/desktop/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 4: Verify**

Run: `cd apps/desktop && npm run build && npm test`
Expected: build succeeds; vitest reports "no tests" (exit code handled by `--passWithNoTests` in the script: set `"test": "vitest run --passWithNoTests"` until Task 3 adds tests).

- [ ] **Step 5: Commit**

```sh
git add apps/desktop .gitignore
git commit -m "feat(desktop): electron-vite scaffold for zero desktop"
```

---

### Task 2: Design tokens + theme CSS

**Files:**
- Create: `apps/desktop/src/shared/tokens.ts`, `apps/desktop/src/shared/tokens.test.ts`, `apps/desktop/src/renderer/src/theme.css`, `apps/desktop/src/renderer/src/index.css` (import tokens)
- Modify: `apps/desktop/src/renderer/src/main.tsx` (import theme.css)

**Interfaces:**
- Produces: `ZERO_TOKENS: Record<string, string>` and `ZERO_TYPE = { body: 'Inter', mono: 'ui-monospace, SFMono-Regular, Menlo, monospace' }` — every later task references these; CSS variables `--z-*` generated at build time from the same object.

- [ ] **Step 1: Write the failing test**

```ts
// apps/desktop/src/shared/tokens.test.ts
import { describe, it, expect } from 'vitest'
import { ZERO_TOKENS, ZERO_TYPE, toCssVariables } from './tokens'

describe('ZERO_TOKENS', () => {
  it('matches the canonical Stitch hex values from Theme.swift/ZeroControls.swift', () => {
    expect(ZERO_TOKENS).toEqual({
      brandOrange: '#F54E00',
      primaryAuthority: '#A83300',
      cardCream: '#FAF8F5',
      navCream: '#F3ECDF',
      navBorder: '#DED7CA',
      canvasTan: '#E9E3D7',
      windowCanvas: '#DBE3D3',
      hoverOrange: '#E04700',
      markerYellow: '#F7DF94',
      statusGreen: '#10B981',
      highlightBlue: '#3B82F6',
      errorRed: '#DC2626',
      wallpaper: '#8C9E82',
      wallpaperDot: '#7A8C70',
      ink: '#191C20',
      secondaryInk: '#5C4038',
      line: '#DED7CA',
      orange: '#F54E00',
      orangePressed: '#A83300',
    })
  })
  it('emits kebab-case CSS variables', () => {
    const css = toCssVariables()
    expect(css).toContain('--z-brand-orange: #F54E00;')
    expect(css).toContain('--z-window-canvas: #DBE3D3;')
  })
  it('keeps the mono stack as ui-monospace', () => {
    expect(ZERO_TYPE.mono.startsWith('ui-monospace')).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/desktop && npx vitest run src/shared/tokens.test.ts`
Expected: FAIL, `Cannot find module './tokens'`

- [ ] **Step 3: Implement**

```ts
// apps/desktop/src/shared/tokens.ts
export const ZERO_TOKENS: Record<string, string> = {
  brandOrange: '#F54E00',
  primaryAuthority: '#A83300',
  cardCream: '#FAF8F5',
  navCream: '#F3ECDF',
  navBorder: '#DED7CA',
  canvasTan: '#E9E3D7',
  windowCanvas: '#DBE3D3',
  hoverOrange: '#E04700',
  markerYellow: '#F7DF94',
  statusGreen: '#10B981',
  highlightBlue: '#3B82F6',
  errorRed: '#DC2626',
  wallpaper: '#8C9E82',
  wallpaperDot: '#7A8C70',
  ink: '#191C20',
  secondaryInk: '#5C4038',
  line: '#DED7CA',
  orange: '#F54E00',
  orangePressed: '#A83300',
}

export const ZERO_TYPE = {
  body: "Inter, system-ui, -apple-system, sans-serif",
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
} as const

const kebab = (k: string) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)

export function toCssVariables(): string {
  return Object.entries(ZERO_TOKENS)
    .map(([k, v]) => `--z-${kebab(k)}: ${v};`)
    .join('\n')
}
```

`theme.css` starts with the output of `toCssVariables()` on `:root` plus `body { font-family: Inter, ... }`. Inter ships as a woff2 copied from system font or a bundled asset; system-ui fallback is acceptable for Task 2 (bundle Inter in Task 16 if missing).

- [ ] **Step 4: Run test to verify pass**

Run: `cd apps/desktop && npx vitest run src/shared/tokens.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```sh
git add apps/desktop/src/shared/tokens.ts apps/desktop/src/shared/tokens.test.ts apps/desktop/src/renderer/src/theme.css apps/desktop/src/renderer/src/main.tsx
git commit -m "feat(desktop): stitch design tokens and css variables"
```

---

### Task 3: Protocol types + SSE parser port (TDD)

**Files:**
- Create: `apps/desktop/src/shared/protocol.ts`, `apps/desktop/src/shared/protocol.test.ts`

**Interfaces:**
- Produces: `type SSEEvent = { name: string; data: string }`; `type RuntimeChange = { name: 'ready' | 'runtime.changed' | 'keepalive'; revision: number; domains: string[]; timestamp: string }`; `class SSEParser { append(bytes: Uint8Array): SSEEvent[] }` (throws on >65,536-byte events); `function parseRuntimeChange(e: SSEEvent): RuntimeChange`; `type RuntimeConnState = 'connecting' | 'live' | 'reconnecting' | 'offline'` — consumed by Tasks 4, 5, 9.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/desktop/src/shared/protocol.test.ts
import { describe, it, expect } from 'vitest'
import { SSEParser, parseRuntimeChange } from './protocol'

const enc = (s: string) => new TextEncoder().encode(s)

describe('SSEParser', () => {
  it('parses event+data split across chunks', () => {
    const p = new SSEParser()
    const a = p.append(enc('event: runtime.changed\nda'))
    const b = p.append(enc('ta: {"revision":13,"domains":["spotify"],"timestamp":"t"}\n\n'))
    expect([...a, ...b]).toEqual([
      { name: 'runtime.changed', data: '{"revision":13,"domains":["spotify"],"timestamp":"t"}' },
    ])
  })
  it('joins multi-line data with \\n and emits on blank line', () => {
    const p = new SSEParser()
    const out = p.append(enc('data: one\ndata: two\n\n'))
    expect(out).toEqual([{ name: 'message', data: 'one\ntwo' }])
  })
  it('handles CRLF and skips comment lines', () => {
    const p = new SSEParser()
    const out = p.append(enc(': ping\r\nevent: keepalive\r\ndata: {"revision":1,"domains":[],"timestamp":"t"}\r\n\r\n'))
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('keepalive')
  })
  it('throws when a single event exceeds the byte cap', () => {
    const p = new SSEParser()
    expect(() => p.append(enc('data: ' + 'x'.repeat(70_000))).toThrow()
  })
})

describe('parseRuntimeChange', () => {
  it('accepts the three known event names and bounded domains', () => {
    const change = parseRuntimeChange({ name: 'ready', data: '{"revision":9,"domains":[],"timestamp":"t"}' })
    expect(change).toEqual({ name: 'ready', revision: 9, domains: [], timestamp: 't' })
  })
  it('rejects unknown names and oversized domains', () => {
    expect(() => parseRuntimeChange({ name: 'mystery', data: '{}' })).toThrow()
    expect(() => parseRuntimeChange({ name: 'keepalive', data: JSON.stringify({ revision: 1, domains: new Array(101).fill('x'), timestamp: 't' }) })).toThrow()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/desktop && npx vitest run src/shared/protocol.test.ts`
Expected: FAIL, module missing

- [ ] **Step 3: Implement (port of `UnixEventStream.swift` SSEParser + RuntimeChange)**

```ts
// apps/desktop/src/shared/protocol.ts
export type SSEEvent = { name: string; data: string }

export class SSEParser {
  private line: number[] = []
  private name = 'message'
  private data: string[] = []
  private eventBytes = 0
  private afterCR = false
  constructor(private maximumEventBytes = 65_536) {}
  append(bytes: Uint8Array): SSEEvent[] {
    const events: SSEEvent[] = []
    for (const byte of bytes) {
      if (this.afterCR) { this.afterCR = false; if (byte === 10) continue }
      this.eventBytes++
      if (this.eventBytes > this.maximumEventBytes) throw new Error('Runtime event too large')
      if (byte === 10 || byte === 13) {
        const text = new TextDecoder().decode(new Uint8Array(this.line))
        this.line = []
        this.afterCR = byte === 13
        if (text === '') {
          if (this.data.length) {
            events.push({ name: this.name, data: this.data.join('\n') })
            this.name = 'message'; this.data = []; this.eventBytes = 0
          }
        } else if (!text.startsWith(':')) {
          const colon = text.indexOf(':')
          const field = colon === -1 ? text : text.slice(0, colon)
          let value = colon === -1 ? '' : text.slice(colon + 1)
          if (value.startsWith(' ')) value = value.slice(1)
          if (field === 'event') this.name = value
          if (field === 'data') this.data.push(value)
        }
      } else this.line.push(byte)
    }
    return events
  }
}

export const STREAM_EVENT_NAMES = ['ready', 'runtime.changed', 'keepalive'] as const
export type StreamEventName = (typeof STREAM_EVENT_NAMES)[number]
export type RuntimeChange = { name: StreamEventName; revision: number; domains: string[]; timestamp: string }

export function parseRuntimeChange(event: SSEEvent): RuntimeChange {
  if (!(STREAM_EVENT_NAMES as readonly string[]).includes(event.name)) throw new Error('Unknown runtime event')
  let payload: unknown
  try { payload = JSON.parse(event.data) } catch { throw new Error('Invalid runtime event encoding') }
  const p = payload as { revision?: unknown; domains?: unknown; timestamp?: unknown }
  if (typeof p.revision !== 'number' || typeof p.timestamp !== 'string' || !Array.isArray(p.domains)) throw new Error('Malformed runtime event')
  if (p.domains.length > 100) throw new Error('Runtime event has too many domains')
  return { name: event.name as StreamEventName, revision: p.revision, domains: p.domains as string[], timestamp: p.timestamp }
}

export type RuntimeConnState = 'connecting' | 'live' | 'reconnecting' | 'offline'
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/desktop && npx vitest run src/shared/protocol.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```sh
git add apps/desktop/src/shared/protocol.ts apps/desktop/src/shared/protocol.test.ts
git commit -m "feat(desktop): sse parser and runtime event protocol port"
```

---

### Task 4: UnixSocketClient over `zero.sock` (TDD)

**Files:**
- Create: `apps/desktop/src/main/socket.ts`, `apps/desktop/src/main/socket.test.ts`

**Interfaces:**
- Consumes: `SSEParser`, `parseRuntimeChange` (Task 3).
- Produces: `fetchSnapshot(socketPath: string, opts?: { timeoutMs?: number }): Promise<unknown>`; `openStream(socketPath: string, onEvent: (e: SSEEvent) => void, onEnd: (err?: Error) => void): () => void` — consumed by Task 5 (model), Task 6 (wiring). Node `http.request({ socketPath })` handles HTTP framing (the Swift `StreamHTTPParser` chunk state machine is NOT ported — Node does it).

- [ ] **Step 1: Write the failing tests using a real unix-socket HTTP server in tmpdir**

```ts
// apps/desktop/src/main/socket.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import * as http from 'node:http'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fetchSnapshot, openStream } from './socket'

const sockPath = path.join(os.tmpdir(), `zero-test-${process.pid}.sock`)
try { fs.unlinkSync(sockPath) } catch {}

const server = http.createServer((req, res) => {
  if (req.url === '/v0.1/cockpit') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  } else if (req.url === '/v0.1/cockpit/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write('event: ready\ndata: {"revision":1,"domains":[],"timestamp":"t"}\n\n')
  } else { res.writeHead(404); res.end() }
})
afterAll(() => { try { fs.unlinkSync(sockPath) } catch {} })

it('listens', async () => {
  await new Promise<void>((resolve) => serverListen(resolve))
})

const serverListen = () => new Promise<void>((resolve) => { server.listen(sockPath, resolve) })

function startServer(): Promise<void> {
  return new Promise((resolve) => { server.listen(sockPath, () => resolve()) })
}
serverListen = startServer

describe('fetchSnapshot', () => {
  it('reads JSON over the unix socket', async () => {
    await startServer()
    const value = await fetchSnapshot(sockPath)
    expect(value).toEqual({ ok: true })
  })
  it('rejects non-200 responses', async () => {
    await startServer()
    await expect(fetchSnapshot(sockPath, { path: '/v0.1/nope' })).rejects.toThrow()
  })
})

describe('openStream', () => {
  it('delivers parsed events and ends cleanly', async () => {
    await startServer()
    const events: unknown[] = []
    let ended = false
    const stop = openStream(sockPath, (e) => events.push(e), () => { ended = true })
    await new Promise((r) => setTimeout(r, 100))
    server.closeAllConnections?.()
    await new Promise((r) => setTimeout(r, 100))
    expect(events[0]).toMatchObject({ name: 'ready' })
    expect(ended).toBe(true)
    stop()
  })
})
```

(Adjust the server's `res.end()` for `/v0.1/nope` — add a 404 route; keep the file self-contained; the final committed test must compile — the implementer must tidy the listen/close plumbing above into clean async setup, preserving the assertions.)

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/desktop && npx vitest run src/main/socket.test.ts`
Expected: FAIL, module missing

- [ ] **Step 3: Implement**

```ts
// apps/desktop/src/main/socket.ts
import * as http from 'node:http'
import { SSEParser, type SSEEvent } from '../shared/protocol'

const DEFAULT_TIMEOUT_MS = 30_000

export function fetchSnapshot(socketPath: string, opts: { timeoutMs?: number; path?: string } = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath, path: opts.path ?? '/v0.1/cockpit', method: 'GET', headers: { Accept: 'application/json' } },
      (res) => {
        if (res.statusCode !== 200) { res.resume(); reject(new Error(`Cockpit snapshot rejected (${res.statusCode})`)); return }
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
          catch { reject(new Error('Invalid cockpit snapshot encoding')) }
        })
        res.on('error', reject)
      },
    )
    req.setTimeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, () => req.destroy(new Error('Cockpit snapshot timed out')))
    req.on('error', reject)
    req.end()
  })
}

export function openStream(
  socketPath: string,
  onEvent: (e: SSEEvent) => void,
  onEnd: (err?: Error) => void,
): () => void {
  const parser = new SSEParser()
  const req = http.request(
    { socketPath, path: '/v0.1/cockpit/stream', method: 'GET', headers: { Accept: 'text/event-stream' } },
    (res) => {
      const ct = String(res.headers['content-type'] ?? '')
      if (res.statusCode !== 200 || !ct.startsWith('text/event-stream')) {
        res.resume(); onEnd(new Error('Runtime stream rejected')); return
      }
      res.on('data', (chunk: Buffer) => {
        try { for (const ev of parser.append(chunk)) onEvent(ev) }
        catch (e) { req.destroy(); onEnd(e instanceof Error ? e : new Error('Runtime stream error')) }
      })
      res.on('end', () => onEnd())
      res.on('error', (e) => onEnd(e))
    },
  )
  req.setTimeout(DEFAULT_TIMEOUT_MS, () => req.destroy(new Error('Runtime stream timed out')))
  req.on('error', (e) => onEnd(e))
  req.end()
  return () => req.destroy()
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/desktop && npx vitest run src/main/socket.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```sh
git add apps/desktop/src/main/socket.ts apps/desktop/src/main/socket.test.ts
git commit -m "feat(desktop): unix socket http and sse client over zero.sock"
```

---

### Task 5: CockpitModel port (TDD)

**Files:**
- Create: `apps/desktop/src/main/cockpit-model.ts`, `apps/desktop/src/main/cockpit-model.test.ts`

**Interfaces:**
- Consumes: `fetchSnapshot`, `openStream` (Task 4); `parseRuntimeChange`, `RuntimeConnState`, `SSEEvent` (Task 3).
- Produces: `class CockpitModel { start(); stop(); refresh(); subscribe(cb: (u: ModelUpdate) => void): () => void; get state(): RuntimeConnState }` with `type ModelUpdate = { snapshot: unknown | null; state: RuntimeConnState; receivedAt: number | null; lastError: string | null }`. Semantic contract (ported from `CockpitClient` in `UnixEventStream.swift:212-359`):
  1. `ready` opens a new epoch, invalidates in-flight fetches, triggers a refresh.
  2. `runtime.changed`/`keepalive` set streamReady and trigger a refresh.
  3. Refresh bursts coalesce: at most one active fetch plus one trailing fetch.
  4. Stream end → epoch bump (in-flight results discarded), `streamReady=false`, state `reconnecting`, retry after reconnectDelay.
  5. Snapshot older than maxSnapshotAge (5 s) with a live stream triggers a refresh.
  6. Fetch failure → state `offline`, error surfaced, still age-scheduled.

- [ ] **Step 1: Write the failing tests (fake socket abstractions)**

```ts
// apps/desktop/src/main/cockpit-model.test.ts
import { describe, it, expect, vi } from 'vitest'
import { CockpitModel } from './cockpit-model'
import type { SSEEvent } from '../shared/protocol'

type StreamCtl = {
  emit: (e: SSEEvent) => void
  end: (err?: Error) => void
}
function harness() {
  const streams: StreamCtl[] = []
  const fetches: Array<{ resolve: (v: unknown) => void; reject: (e: Error) => void }> = []
  const timers: Array<() => void> = []
  const model = new CockpitModel('/tmp/fake.sock',
    () => new Promise((resolve, reject) => fetches.push({ resolve, reject })),
    (_socket, onEvent, onEnd) => {
      const ctl: StreamCtl = {
        emit: (e) => { try { onEvent(e) } catch (err) { onEnd(err instanceof Error ? err : undefined) } },
        end: (e) => onEnd(e),
      }
      streams.push(ctl)
      return () => {}
    },
    { schedule: (fn, _ms) => { timers.push(fn); return () => {} } },
  )
  const updates: Array<{ snapshot: unknown | null; state: string; receivedAt: number | null }> = []
  model.subscribe((u) => updates.push({ snapshot: u.snapshot, state: u.state, receivedAt: u.receivedAt }))
  return { model, streams, fetches, timers, updates }
}

const ready = (rev = 1): SSEEvent => ({ name: 'ready', data: JSON.stringify({ revision: rev, domains: [], timestamp: 't' }) })
const changed = (rev = 2): SSEEvent => ({ name: 'runtime.changed', data: JSON.stringify({ revision: rev, domains: ['spotify'], timestamp: 't' }) })

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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/desktop && npx vitest run src/main/cockpit-model.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

```ts
// apps/desktop/src/main/cockpit-model.ts
import { parseRuntimeChange, type RuntimeConnState, type SSEEvent } from '../shared/protocol'

export type ModelUpdate = {
  snapshot: unknown | null
  state: RuntimeConnState
  receivedAt: number | null
  lastError: string | null
}

export type ModelOpts = {
  reconnectDelayMs?: number
  maxSnapshotAgeMs?: number
  schedule?: (fn: () => void, ms: number) => () => void
}

export class CockpitModel {
  private snapshot: unknown | null = null
  private state: RuntimeConnState = 'offline'
  private receivedAt: number | null = null
  private lastError: string | null = null
  private listeners = new Set<(u: ModelUpdate) => void>()
  private generation = 0
  private streamReady = false
  private refreshing = false
  private refreshPending = false
  private refreshEpoch = 0
  private running = false
  private closeStream: (() => void) | null = null

  constructor(
    private socketPath: string,
    private fetchFn: (socketPath: string) => Promise<unknown>,
    private openFn: (socketPath: string, onEvent: (e: SSEEvent) => void, onEnd: (err?: Error) => void) => () => void,
    private opts: ModelOpts = {},
  ) {}

  subscribe(cb: (u: ModelUpdate) => void): () => void {
    this.listeners.add(cb)
    cb(this.update())
    return () => this.listeners.delete(cb)
  }

  get state(): RuntimeConnState { return this.state }

  start(): void {
    if (this.running) return
    this.running = true
    this.generation++
    this.streamReady = false
    this.state = 'connecting'
    this.emit()
    void this.loop(this.generation)
  }

  stop(): void {
    this.running = false
    this.generation++
    this.closeStream?.()
    this.closeStream = null
    this.state = 'offline'
    this.emit()
  }

  refresh(): void {
    if (!this.running) return
    if (this.refreshing) { this.refreshPending = true; return }
    this.refreshing = true
    const gen = this.generation
    const epoch = this.refreshEpoch
    void (async () => {
      for (;;) {
        try {
          const value = await this.fetchFn(this.socketPath)
          if (this.generation !== gen || this.refreshEpoch !== epoch) return
          this.snapshot = value
          this.receivedAt = Date.now()
          this.lastError = null
          this.state = this.streamReady ? 'live' : 'reconnecting'
          this.scheduleAge(gen)
        } catch (e) {
          if (this.generation !== gen || this.refreshEpoch !== epoch) return
          this.lastError = e instanceof Error ? e.message : String(e)
          this.state = 'offline'
          this.scheduleAge(gen)
        }
        if (this.refreshPending) { this.refreshPending = false; continue }
        this.refreshing = false
        return
      }
    })()
  }

  private scheduleAge(gen: number): void {
    const cancel = this.opts.schedule?.(() => {
      if (this.generation === gen && this.running && this.streamReady) this.refresh()
    }, this.opts.maxSnapshotAgeMs ?? 5_000)
    void cancel
  }

  private emit(): void {
    const u = this.update()
    for (const l of this.listeners) l(u)
  }

  private update(): ModelUpdate {
    return { snapshot: this.snapshot, state: this.state, receivedAt: this.receivedAt, lastError: this.lastError }
  }

  private async loop(gen: number): Promise<void> {
    while (this.running && this.generation === gen) {
      await new Promise<void>((resolve) => {
        const ended = (err?: Error) => { resolve(); if (err) this.lastError = err.message }
        this.closeStream = this.openFn(this.socketPath, (ev) => {
          if (this.generation !== gen) return
          let change
          try { change = parseRuntimeChange(ev) } catch { return } // malformed known events fail closed: dropped
          if (change.name === 'ready') {
            this.refreshEpoch++
            this.refreshing = false; this.refreshPending = false
            this.streamReady = true
            this.state = 'connecting'
            this.emit()
            this.refresh()
          } else {
            this.streamReady = true
            this.refresh()
          }
        }, ended)
      })
      if (!this.running || this.generation !== gen) return
      this.refreshEpoch++
      this.refreshing = false; this.refreshPending = false
      this.streamReady = false
      this.state = 'reconnecting'
      this.emit()
      await new Promise((r) => setTimeout(r, this.opts.reconnectDelayMs ?? 1_000))
    }
  }
}
```

(The `schedule` opt replaces raw timers so tests control time; production wiring passes `(fn, ms) => { const id = setTimeout(fn, ms); return () => clearTimeout(id) }`.)

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/desktop && npx vitest run src/main/cockpit-model.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```sh
git add apps/desktop/src/main/cockpit-model.ts apps/desktop/src/main/cockpit-model.test.ts
git commit -m "feat(desktop): cockpit model port with epoch fencing and coalesced refresh"
```

---

### Task 6: IPC contract, preload, and main op table

**Files:**
- Create: `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/shared/ipc.test.ts`, `apps/desktop/src/main/ipc.ts`, `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/main/index.ts` (wire model + ipc)

**Interfaces:**
- Consumes: `CockpitModel` (Task 5); action paths from Global Constraints.
- Produces (renderer-visible, via `window.zero`):
  - `invoke(op: OpName, payload?: unknown): Promise<unknown>` where `OpName` is one of: `prefs.get`, `prefs.set`, `snapshot.fetch`, `command.send` (payload `{op, body}` → forwarded as `RuntimeCommandRequest` with generated id), `project.get` (payload `{id}`), `codex.connect`, `codex.disconnect`, `codex.send` (payload `{method, params}`), `ocp.connect`, `ocp.disconnect`, `ocp.send`, `wallpaper.pick`.
  - `subscribe(channel: 'cockpit', cb: (u: ModelUpdate) => void): () => void`
- Main validates every op against the whitelist; unknown ops are rejected (`Error('Unknown op')`).

- [ ] **Step 1: Write the failing test (op whitelist validator is pure)**

```ts
// apps/desktop/src/shared/ipc.test.ts
import { describe, it, expect } from 'vitest'
import { OPS, validateOp } from './ipc'

describe('validateOp', () => {
  it('accepts whitelisted ops and rejects unknown ones', () => {
    expect(validateOp('command.send')).toBe(true)
    expect(validateOp('prefs.get')).toBe(true)
    expect(validateOp('fs.read')).toBe(false)
    expect(validateOp('exec')).toBe(false)
  })
  it('exposes exactly the planned op set', () => {
    expect(Object.keys(OPS).sort()).toEqual(
      ['codex.connect', 'codex.disconnect', 'codex.send', 'command.send', 'ocp.connect', 'ocp.disconnect', 'ocp.send',
       'prefs.get', 'prefs.set', 'project.get', 'snapshot.fetch', 'wallpaper.pick'].sort())
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/desktop && npx vitest run src/shared/ipc.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

```ts
// apps/desktop/src/shared/ipc.ts
export const OPS = {
  'prefs.get': true,
  'prefs.set': true,
  'snapshot.fetch': true,
  'command.send': true,
  'project.get': true,
  'codex.connect': true,
  'codex.disconnect': true,
  'codex.send': true,
  'ocp.connect': true,
  'ocp.disconnect': true,
  'ocp.send': true,
  'wallpaper.pick': true,
} as const

export type OpName = keyof typeof OPS
export const validateOp = (op: string): op is OpName => op in OPS
export type CommandPayload = { op: string; body?: Record<string, unknown> }
export type ProjectPayload = { id: string }
export type CodexSendPayload = { method: string; params?: unknown }
```

`src/main/ipc.ts` registers `ipcMain.handle('zero:invoke', (_e, op, payload)` → `if (!validateOp(op)) throw new Error('Unknown op')`, then dispatches; `command.send` builds `{ id: crypto.randomUUID(), op: payload.op, body: payload.body ?? {} }` and POSTs to `/v0.1/commands` via `fetchSnapshot`-style POST helper (add `postCommand(socketPath, body)` to `socket.ts` — same `http.request` pattern with method POST and `Content-Type: application/json`); `project.get` percent-encodes the id with `/`, `?`, `#`, `%` excluded and GETs `/v0.1/projects/{id}`. It also pushes model updates: on change, `win.webContents.send('zero:cockpit', u)`.
`src/preload/index.ts`:

```ts
import { contextBridge, ipcRenderer } from 'electron'
contextBridge.exposeInMainWorld('zero', {
  invoke: (op: string, payload?: unknown) => ipcRenderer.invoke('zero:invoke', op, payload),
  subscribe: (_channel: 'cockpit', cb: (u: unknown) => void) => {
    const h = (_: unknown, u: unknown) => cb(u)
    ipcRenderer.on('zero:cockpit', h)
    return () => ipcRenderer.removeListener('zero:cockpit', h)
  },
})
```

Renderer types in `apps/desktop/src/renderer/src/env.d.ts` declare `window.zero`.

- [ ] **Step 4: Verify**

Run: `cd apps/desktop && npm test && npm run build`
Expected: PASS + build clean. Manual: `npm run dev` shows the shell connecting (reconnecting slate when daemon absent).

- [ ] **Step 5: Commit**

```sh
git add apps/desktop/src/shared/ipc.ts apps/desktop/src/shared/ipc.test.ts apps/desktop/src/main/ipc.ts apps/desktop/src/main/socket.ts apps/desktop/src/preload/index.ts apps/desktop/src/main/index.ts apps/desktop/src/renderer/src/env.d.ts
git commit -m "feat(desktop): typed ipc contract with op whitelist"
```

---

### Task 7: Desktop window manager + PrefsStore + seed/migration (TDD)

**Files:**
- Create: `apps/desktop/src/shared/desktop-windows.ts`, `apps/desktop/src/shared/desktop-windows.test.ts`, `apps/desktop/src/main/prefs.ts`, `apps/desktop/src/main/prefs.test.ts`

**Interfaces:**
- Consumes: route id strings.
- Produces (pure, tested):
  - `type Rect = { x: number; y: number; w: number; h: number }`
  - `clampSize(w, h) -> {w, h}` (320–1100 × 240–900)
  - `cascadeOffset(index) -> {x, y}` (28 step, `index % 8`)
  - `initialOrigin(openCount, stored?) -> {x, y}` (stored wins as-is, free movement)
  - `launchOrigins(count) -> {x,y}[]`
  - `fallbackSelection(closed, zOrder, minimized?) -> string` (front-most remaining, else `desk`)
  - `migrateStackedOrigins(positions, layoutVersion) -> { positions, layoutVersion }` — the `DesktopWindows.swift:153-184` port: tolerance 40, spacing 48, inset 32, keeps the first of each origin cluster, moves the rest to free cascade slots, runs once (`layoutVersion` bump `0→2`)
- `class PrefsStore` (`apps/desktop/src/main/prefs.ts`): `load(): Prefs`, `save(p: Prefs): void` against `$HOME/Library/Application Support/ProjectZero/desktop-electron/prefs.json`; `type Prefs = { version: 1; windows: Record<string, Rect>; icons: Record<string, {x: number; y: number}>; wallpaper: { kind: 'dotted-green' | 'cream' | 'canvas-tan' | 'custom'; path?: string; mode: 'cover' | 'tile' }; open: string[]; zOrder: string[]; minimized: string[]; layoutVersion: number }`; on parse failure: rename the file to `prefs.json.corrupt-<ts>`, write defaults.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/desktop/src/shared/desktop-windows.test.ts
import { describe, it, expect } from 'vitest'
import { clampSize, cascadeOffset, initialOrigin, launchOrigins, fallbackSelection, migrateStackedOrigins } from './desktop-windows'

describe('geometry', () => {
  it('clamps sizes to 320-1100 x 240-900', () => {
    expect(clampSize(100, 100)).toEqual({ w: 320, h: 240 })
    expect(clampSize(2000, 2000)).toEqual({ w: 1100, h: 900 })
    expect(clampSize(560, 480)).toEqual({ w: 560, h: 480 })
  })
  it('cascades 28 pt steps wrapping every 8', () => {
    expect(cascadeOffset(0)).toEqual({ x: 0, y: 0 })
    expect(cascadeOffset(3)).toEqual({ x: 84, y: 84 })
    expect(cascadeOffset(9)).toEqual({ x: 28, y: 28 })
  })
  it('stored origin wins as-is (free movement, may be partially off-canvas)', () => {
    expect(initialOrigin(4, { x: -50, y: 700 })).toEqual({ x: -50, y: 700 })
    expect(initialOrigin(4, undefined)).toEqual({ x: 112, y: 112 })
  })
  it('stagger gives distinct origins', () => {
    const o = launchOrigins(3)
    expect(new Set(o.map((p) => `${p.x},${p.y}`)).size).toBe(3)
  })
  it('fallback skips closed + minimized, falls back to desk', () => {
    expect(fallbackSelection('runtime', ['desk', 'runtime', 'network'])).toBe('network')
    expect(fallbackSelection('runtime', ['desk', 'runtime'], ['desk'])).toBe('desk')
    expect(fallbackSelection('desk', [], [])).toBe('desk')
  })
})

describe('migrateStackedOrigins', () => {
  it('repairs a stacked cluster: keeps first, spreads rest, bumps version', () => {
    const positions = {
      desk: { x: 28, y: 28 }, runtime: { x: 28, y: 28 }, network: { x: 28, y: 28 },
      airlock: { x: 56, y: 56 }, zeroBot: { x: 56, y: 56 },
    }
    const out = migrateStackedOrigins(positions, 1)
    expect(out.layoutVersion).toBe(2)
    expect(out.positions.desk).toEqual({ x: 28, y: 28 })
    expect(out.positions.runtime).not.toEqual(out.positions.desk)
    expect(out.positions.network).not.toEqual(out.positions.desk)
    expect(out.positions.runtime).toEqual({ x: 32, y: 32 })
    expect(out.positions.network).toEqual({ x: 80, y: 80 })
    expect(out.positions.airlock).toEqual({ x: 56, y: 56 })
    expect(out.positions.zeroBot).not.toEqual(out.positions.airlock)
  })
  it('is idempotent once version >= 2', () => {
    const positions = { desk: { x: 28, y: 28 }, runtime: { x: 28, y: 28 } }
    expect(migrateStackedOrigins(positions, 2)).toEqual({ positions, layoutVersion: 2 })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/desktop && npx vitest run src/shared/desktop-windows.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

```ts
// apps/desktop/src/shared/desktop-windows.ts
export type Point = { x: number; y: number }
export type Rect = { x: number; y: number; w: number; h: number }

export const clampSize = (w: number, h: number): { w: number; h: number } => ({
  w: Math.min(Math.max(w, 320), 1100),
  h: Math.min(Math.max(h, 240), 900),
})

export const cascadeOffset = (index: number): Point => {
  const slot = ((index % 8) + 8) % 8
  return { x: slot * 28, y: slot * 28 }
}

export const initialOrigin = (openCount: number, stored?: Point | null): Point =>
  stored ?? cascadeOffset(openCount)

export const launchOrigins = (count: number): Point[] =>
  Array.from({ length: count }, (_, i) => cascadeOffset(i))

export const fallbackSelection = (closed: string, zOrder: string[], minimized: string[] = []): string =>
  zOrder.filter((r) => r !== closed && !minimized.includes(r)).at(-1) ?? 'desk'

export const DEFAULT_SIZE: Rect = { x: 0, y: 0, w: 560, h: 480 }
export const LAYOUT_VERSION = 2

export function migrateStackedOrigins(
  positions: Record<string, Point>,
  layoutVersion: number,
): { positions: Record<string, Point>; layoutVersion: number } {
  if (layoutVersion >= LAYOUT_VERSION) return { positions, layoutVersion: LAYOUT_VERSION }
  const out: Record<string, Point> = {}
  const occupied: Point[] = []
  const tolerance = 40, spacing = 48, inset = 32
  let nextSlot = 0
  const collides = (a: Point, b: Point) => Math.abs(a.x - b.x) < tolerance && Math.abs(a.y - b.y) < tolerance
  for (const [route, stored] of Object.entries(positions)) {
    if (occupied.some((o) => collides(o, stored))) {
      let candidate = { x: inset + nextSlot * spacing, y: inset + nextSlot * spacing }
      while (occupied.some((o) => collides(o, candidate))) {
        nextSlot++
        candidate = { x: inset + nextSlot * spacing, y: inset + nextSlot * spacing }
      }
      out[route] = candidate
      occupied.push(candidate)
      nextSlot++
    } else {
      out[route] = stored
      occupied.push(stored)
    }
  }
  return { positions: out, layoutVersion: LAYOUT_VERSION }
}
```

```ts
// apps/desktop/src/main/prefs.ts
import * as fs from 'node:fs'
import * as path from 'node:path'
import { DEFAULT_SIZE, LAYOUT_VERSION, migrateStackedOrigins, type Rect } from '../shared/desktop-windows'

export type Prefs = {
  version: 1
  windows: Record<string, Rect>
  icons: Record<string, { x: number; y: number }>
  wallpaper: { kind: 'dotted-green' | 'cream' | 'canvas-tan' | 'custom'; path?: string; mode: 'cover' | 'tile' }
  open: string[]
  zOrder: string[]
  minimized: string[]
  layoutVersion: number
}

export function defaultPrefs(): Prefs {
  const migrated = migrateStackedOrigins({ desk: DEFAULT_SIZE, runtime: DEFAULT_SIZE }, 0)
  return {
    version: 1,
    windows: {
      desk: { x: 28, y: 28, ...DEFAULT_SIZE },
      runtime: { x: 56, y: 56, ...DEFAULT_SIZE },
    },
    icons: {},
    wallpaper: { kind: 'dotted-green', mode: 'cover' },
    open: ['desk', 'runtime'],
    zOrder: ['desk', 'runtime'],
    minimized: [],
    layoutVersion: migrated.layoutVersion,
  }
}

export class PrefsStore {
  constructor(private dir: string) {}
  private get file(): string { return path.join(this.dir, 'prefs.json') }
  private get dir(): string { return this.dirPath }
  private dirPath: string = '' // set in ctor below
  constructor(innerDir: string) { this.dirPath = innerDir } // TS note: merge with above in final code
  load(): Prefs { /* read, JSON.parse; on throw: fs.renameSync(file, `${file}.corrupt-${Date.now()}`); return defaultPrefs() */ }
  save(p: Prefs): void { fs.mkdirSync(this.dirPath, { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(p, null, 2)) }
}
```

(The implementer must produce the concrete, compiling version: a single constructor `constructor(private dir: string)`, a `defaultPrefs()` helper that seeds spread windows for Desk+Runtime using `defaultPrefs()` above, and `load()` with the quarantine behavior asserted in the test.)

```ts
// apps/desktop/src/main/prefs.test.ts
import { describe, it, expect } from 'vitest'
import { PrefsStore, defaultPrefs } from './prefs'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

it('quarantines corrupt prefs and reseeds defaults', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-prefs-'))
  fs.writeFileSync(path.join(dir, 'prefs.json'), '{not json')
  const store = new PrefsStore(dir)
  const p = store.load()
  expect(p).toEqual(defaultPrefs())
  expect(fs.readdirSync(dir).some((f) => f.startsWith('prefs.json.corrupt-'))).toBe(true)
  expect(store.load().version).toBe(1)
})
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/desktop && npx vitest run src/shared/desktop-windows.test.ts src/main/prefs.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```sh
git add apps/desktop/src/shared/desktop-windows.ts apps/desktop/src/shared/desktop-windows.test.ts apps/desktop/src/main/prefs.ts apps/desktop/src/main/prefs.test.ts
git commit -m "feat(desktop): window geometry, seed migration, and prefs store"
```

---

### Task 8: Desktop canvas + DesktopWindow (react-rnd, transform-only resize)

**Files:**
- Create: `apps/desktop/src/renderer/src/desktop/canvas.ts` (pure helpers), `apps/desktop/src/renderer/src/desktop/canvas.test.ts`, `apps/desktop/src/renderer/src/desktop/DesktopCanvas.tsx`, `apps/desktop/src/renderer/src/desktop/DesktopWindow.tsx`, `apps/desktop/src/renderer/src/desktop/Taskbar.tsx`
- Modify: `apps/desktop/src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `Rect`, `clampSize`, `fallbackSelection`, `migrateStackedOrigins` (Task 7); route components (Tasks 10-13, arriving as `ROUTES: Record<RouteId, ComponentType>` — this task uses a placeholder route that renders the title).
- Produces:
  - `resizeAnchor(direction: string): { x: 0 | 1; y: 0 | 1 }` — 0 = anchor left/top (scale from right/bottom edge fixed), 1 = anchor right/bottom. Rules: direction containing `left` anchors right (x=1), containing `right` anchors left (x=0), `top` anchors bottom (y=1), `bottom` anchors top (y=0).
  - `previewScale(committedW, previewW)` etc. — the DesktopWindow keeps its committed size in the store; during an active resize it applies `transform: scale()` to the inner content wrapper with `transformOrigin` computed from the anchor (e.g. direction `topLeft` → origin `100% 100%`); commit (store update + `prefs.set`) happens only on `onResizeStop`. This is the direct port of the Swift transform-only resize fix (`DesktopCanvas.swift`).
  - `DesktopWindow` props: `{ route: string; rect: Rect; front: boolean; onSelect(); onClose(); onMinimize(); onMaximize(); onCommit(rect: Rect); children }`.
  - Traffic lights: red close, yellow minimize, green maximize (18 px hit targets, `.contentShape` equivalent: buttons sit above the drag surface with `stopPropagation`); header is the drag surface (`dragHandleClassName="zw-header"` with react-rnd `dragHandle`. `enableResizing` all 8 directions; `minWidth/minHeight` from clamp bounds).
  - `DesktopCanvas`: renders wallpaper layer + icon layer placeholder + `zOrder.map(open windows → DesktopWindow)` + `Taskbar` (open windows; click focuses/restores). Canvas background `--z-window-canvas` with the dotted wallpaper texture (Task 14 completes it; Task 8 uses flat `--z-window-canvas`).

- [ ] **Step 1: Write the failing tests for pure helpers**

```ts
// apps/desktop/src/renderer/src/desktop/canvas.test.ts
import { describe, it, expect } from 'vitest'
import { resizeAnchor, transformOrigin, previewTransform } from './canvas'

describe('resize anchors', () => {
  it('left edges anchor right', () => {
    expect(resizeAnchor('left')).toEqual({ x: 1, y: 0 })
    expect(resizeAnchor('topLeft')).toEqual({ x: 1, y: 1 })
    expect(resizeAnchor('bottomLeft')).toEqual({ x: 1, y: 0 })
  })
  it('top edges anchor bottom', () => {
    expect(resizeAnchor('top')).toEqual({ x: 0, y: 1 })
    expect(resizeAnchor('topRight')).toEqual({ x: 0, y: 1 })
  })
  it('right/bottom edges anchor left/top', () => {
    expect(resizeAnchor('right')).toEqual({ x: 0, y: 0 })
    expect(resizeAnchor('bottom')).toEqual({ x: 0, y: 0 })
    expect(resizeAnchor('bottomRight')).toEqual({ x: 0, y: 0 })
  })
})

describe('transform-only preview', () => {
  it('scales content around the fixed corner during resize', () => {
    expect(previewTransform('topLeft', { w: 400, h: 300 }, { w: 500, h: 300 })).toEqual({
      scale: { x: 1.25, y: 1 },
      origin: '100% 100%',
    })
  })
  it('is identity when no preview size is given', () => {
    expect(previewTransform('right', { w: 400, h: 300 }, null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/desktop && npx vitest run src/renderer/src/desktop/canvas.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement helpers + components**

```ts
// apps/desktop/src/renderer/src/desktop/canvas.ts
export type Anchor = { x: 0 | 1; y: 0 | 1 }
export const resizeAnchor = (direction: string): Anchor => ({
  x: direction.includes('left') ? 1 : 0,
  y: direction.includes('top') ? 1 : 0,
})
export const transformOrigin = (a: Anchor): string => `${a.x ? '100%' : '0%'} ${a.y ? '100%' : '0%'}`
export const previewTransform = (
  direction: string,
  committed: { w: number; h: number },
  preview: { w: number; h: number } | null,
): { scale: { x: number; y: number }; origin: string } | null => {
  if (!preview) return null
  const a = resizeAnchor(direction)
  return { scale: { x: preview.w / committed.w, y: preview.h / committed.h }, origin: transformOrigin(a) }
}
```

`DesktopWindow.tsx` renders:

```tsx
<Rnd
  size={{ width: rect.w, height: rect.h }}
  position={{ x: rect.x, y: rect.y }}
  dragHandleClassName="zw-header"
  enableResizing={ALL_EIGHT}
  minWidth={320} minHeight={240} maxWidth={1100} maxHeight={900}
  onResizeStart={(e, dir) => setPreviewDir(dir)}
  onResize={(e, dir, _ref, delta, position) => setPreview({ w: rect.w + delta.width, h: rect.h + delta.height })}
  onResizeStop={(_e, dir, _ref, _delta, position) => {
    setPreviewDir(null); setPreview(null)
    onCommit({ x: position.x, y: position.y, w: Math.round(preview?.w ?? rect.w), h: Math.round(preview?.h ?? rect.h) })
  }}
  onDragStop={(_e, d) => onCommit({ x: d.x, y: d.y, w: rect.w, h: rect.h })}
  style={{ zIndex: front ? 10 : 1, background: 'var(--z-card-cream)', borderRadius: 14, overflow: 'hidden', boxShadow: front ? '0 12px 32px rgba(0,0,0,.18)' : '0 6px 16px rgba(0,0,0,.10)' }}
>
  <div className="zw-header" onMouseDown={(e) => e.stopPropagation() ? undefined : undefined} onClick={() => onSelect()}>
    <button className="zw-light" style={{ background: 'var(--z-error-red)' }} onClick={(e) => { e.stopPropagation(); onClose() }} aria-label="Close" />
    <button className="zw-light" style={{ background: 'var(--z-marker-yellow)' }} onClick={(e) => { e.stopPropagation(); onMinimize() }} aria-label="Minimize" />
    <button className="zw-light" style={{ background: 'var(--z-status-green)' }} onClick={(e) => { e.stopPropagation(); onMaximize() }} aria-label="Maximize" />
    <span style={{ pointerEvents: 'none' }}>{title}</span>
  </div>
  <div style={{ transform: t ? `scale(${t.scale.x}, ${t.scale.y})` : undefined, transformOrigin: t?.origin, width: '100%', height: 'calc(100% - 34px)' }}>
    {children}
  </div>
</Rnd>
```

(`title` comes from the route table; implement the exact code — the sketch above is the contract; the committed component must compile and respect: commit-on-stop only, buttons above drag surface with stopPropagation, title hit-testing disabled, 18 px light targets, front window z=10.)

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/desktop && npx vitest run src/renderer/src/desktop/canvas.test.ts && npm run build`
Expected: PASS + build clean

- [ ] **Step 5: Commit**

```sh
git add apps/desktop/src/renderer/src/desktop/ apps/desktop/src/renderer/src/App.tsx
git commit -m "feat(desktop): draggable resizable canvas windows with transform-only preview"
```

---

### Task 9: Renderer cockpit store + status badge + shell

**Files:**
- Create: `apps/desktop/src/renderer/src/store/cockpit.ts`, `apps/desktop/src/renderer/src/store/cockpit.test.ts`, `apps/desktop/src/renderer/src/components/StatusBadge.tsx`
- Modify: `apps/desktop/src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `window.zero` (Task 6), `RuntimeConnState`, `ModelUpdate` (Tasks 3/5).
- Produces: `useCockpit()` zustand store `{ snapshot: unknown | null; state: RuntimeConnState; lastError: string | null; refreshAt: number | null }` wired once at app start (subscribe to `window.zero.subscribe('cockpit', ...)`, initial `window.zero.invoke('snapshot.fetch')`); `selectSession(state)` memoized selector; `StatusBadge` renders `LIVE`/`STALE`/`RECONNECTING`/`OFFLINE` using `--z-status-green` (live), `--z-marker-yellow` (stale/reconnecting), `--z-error-red` (offline). Badge logic: snapshot fresh (<5 s) + state live → LIVE; state live but snapshot older than 5 s → STALE; otherwise per state.

- [ ] **Step 1: Write the failing test**

```ts
// apps/desktop/src/renderer/src/store/cockpit.test.ts
import { describe, it, expect } from 'vitest'
import { badgeFor } from './cockpit'

describe('badgeFor', () => {
  const now = 1_000_000
  it('live when fresh snapshot and live state', () => {
    expect(badgeFor('live', now, now, 5_000)).toBe('LIVE')
  })
  it('stale when snapshot ages past max age while live', () => {
    expect(badgeFor('live', now, now - 6_000, 5_000)).toBe('STALE')
  })
  it('reconnecting/offline reflect state', () => {
    expect(badgeFor('reconnecting', now, now, 5_000)).toBe('RECONNECTING')
    expect(badgeFor('offline', null, null, 5_000)).toBe('OFFLINE')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/desktop && npx vitest run src/renderer/src/store/cockpit.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement store + badge**

```ts
// apps/desktop/src/renderer/src/store/cockpit.ts
import { create } from 'zustand'
import type { RuntimeConnState } from '../../shared/protocol'

export type CockpitState = {
  snapshot: unknown | null
  state: RuntimeConnState
  lastError: string | null
  refreshAt: number | null
}
export const useCockpit = create<CockpitState>(() => ({
  snapshot: null, state: 'connecting', lastError: null, refreshAt: null,
}))
export function bindCockpit(): void {
  window.zero.subscribe('cockpit', (u) => useCockpit.setState({
    snapshot: u.snapshot, state: u.state, lastError: u.lastError, refreshAt: u.receivedAt,
  }))
}
export type Badge = 'LIVE' | 'STALE' | 'RECONNECTING' | 'OFFLINE'
export function badgeFor(state: RuntimeConnState, now: number, receivedAt: number | null, maxAgeMs: number): Badge {
  if (state === 'reconnecting') return 'RECONNECTING'
  if (state === 'offline') return 'OFFLINE'
  if (state === 'connecting') return 'RECONNECTING'
  if (receivedAt == null || now - receivedAt > maxAgeMs) return 'STALE'
  return 'LIVE'
}
```

(For the store unit test environment, `window` is unavailable — hence `badgeFor` is exported standalone and tested; `bindCockpit` is exercised by Playwright in Task 17.)

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/desktop && npx vitest run src/renderer/src/store/cockpit.test.ts && npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```sh
git add apps/desktop/src/renderer/src/store/ apps/desktop/src/renderer/src/components/StatusBadge.tsx apps/desktop/src/renderer/src/App.tsx
git commit -m "feat(desktop): cockpit store, staleness badge, shell wiring"
```

---

### Task 10: Route lane A — Desk + Runtime

**Files:**
- Create: `apps/desktop/src/renderer/src/routes/DeskRoute.tsx`, `apps/desktop/src/renderer/src/routes/RuntimeRoute.tsx`, `apps/desktop/src/renderer/src/routes/registry.ts`
- Modify: `apps/desktop/src/renderer/src/desktop/DesktopCanvas.tsx` (open a route → render from registry), `apps/desktop/src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `useCockpit().snapshot` (typed subset rendering — read the snapshot shape from `apps/macos/Sources/ZeroKit/CockpitSnapshot.swift` and port only the fields these two routes display), `ZERO_TOKENS` CSS vars, `badgeFor`.
- Produces: `ROUTES: Record<RouteId, FC>` with `RouteId = 'desk' | 'runtime' | 'network' | 'flightRecorder' | 'airlock' | 'zeroBot' | 'skillLab'` (missing routes still registered as stubs so Task 11/13 fill them).

- [ ] **Step 1: Port the snapshot subset**

Read `CockpitSnapshot.swift` and the daemon `GET /v0.1/cockpit` handler (`core/api/` cockpit handler) and write TS types for the exact JSON fields Desk and Runtime need (session `{project, state, elapsedMs}`, focus state string, runtime tiles `{cpu, ram, ssd, gpu}` from the local telemetry source as the Swift RuntimeView renders them). Validate with `runtime.types.test.ts` against a recorded fixture: copy a real snapshot JSON from `curl --unix-socket "$HOME/Library/Application Support/ProjectZero/zero.sock" http://localhost/v0.1/cockpit` (read-only) into `apps/desktop/src/renderer/src/routes/fixtures/cockpit.json` and assert the typed parse passes.

- [ ] **Step 2: Implement the two routes**

- `DeskRoute`: project header (name, H:MM:SS from `elapsedMs` — port `CockpitFormat.elapsed` into `src/shared/format.ts` with a test), focus state chip, connectivity line, Git status line from snapshot `git` domain when present.
- `RuntimeRoute`: four telemetry tiles (CPU/RAM/SSD/GPU) with `--z-card-cream` cards, `--z-line` borders, values via `--z-ink`, subtle `--z-marker-yellow` accent tile for the most loaded component; overflow notice element as in the Swift RuntimeView.
- Both wrapped in `React.memo` and reading via `useCockpit` selectors so a Spotify tick does not re-render them.

- [ ] **Step 3: Tests**

`src/shared/format.test.ts`: `elapsed(0)` → `0:00:00`; `elapsed(3_723_456)` → `1:02:03`; negative clamps to `0:00:00`.
`routes/registry.test.ts`: all 7 ids registered.

- [ ] **Step 4: Verify**

Run: `cd apps/desktop && npm test && npm run build`
Expected: PASS. Manual dev run: open Desk/Runtime windows — real values when daemon socket is live, grayed STALE state when not.

- [ ] **Step 5: Commit**

```sh
git add apps/desktop/src/renderer/src/routes/ apps/desktop/src/renderer/src/shared/format.ts apps/desktop/src/renderer/src/shared/format.test.ts apps/desktop/src/renderer/src/desktop/DesktopCanvas.tsx
git commit -m "feat(desktop): desk and runtime routes from live snapshot"
```

---

### Task 11: Route lane B — Network + Flight Recorder

**Files:**
- Create: `apps/desktop/src/renderer/src/routes/NetworkRoute.tsx`, `apps/desktop/src/renderer/src/routes/FlightRecorderRoute.tsx`
- Modify: `apps/desktop/src/renderer/src/routes/registry.ts` (fill real components)

**Interfaces:**
- Consumes: snapshot subsets (`nodes[]` with `name/lastSeen/connected`, audit/event rows).
- Produces: Network route listing nodes with connection tone dots (`--z-status-green` online, `--z-error-red` offline, `--z-marker-yellow` stale per 90 s lease semantics — mirror the daemon's `nodeLease`); Flight Recorder with the noise filter default (hide display/clock/keepalive noise rows behind a Show-all toggle, port the filter predicate from `FlightRecorderView.swift`).

- [ ] **Step 1: Write filter test** — `flightRecorder.test.ts` with fixture rows asserting default-hidden categories exactly match the Swift predicate.

- [ ] **Step 2: Implement** both routes with the same memoized pattern.

- [ ] **Step 3: Run** `npm test && npm run build` — PASS.

- [ ] **Step 4: Commit**

```sh
git add apps/desktop/src/renderer/src/routes/
git commit -m "feat(desktop): network and flight recorder routes"
```

---

### Task 12: Codex + OpenCode bridges (TDD)

**Files:**
- Create: `apps/desktop/src/main/bridges.ts`, `apps/desktop/src/main/bridges.test.ts`
- Modify: `apps/desktop/src/main/ipc.ts` (op handlers `codex.*`, `ocp.*`)

**Interfaces:**
- Consumes: `child_process.spawn`.
- Produces: `class JsonRpcStdio { connect(cmd, args, cwd?); send(method, params): Promise<unknown>; events: NodeJS.ReadableStream; onEvent(cb); disconnect() }` with request-id correlation, bounded response size (reject responses > 1 MiB), and process-exit → `disconnected` event; `class CodexBridge` spawning `$HOME/Library/Application Support/ProjectZero/toolchains/<resolved codex dir>/codex` (resolve via glob at connect time — do not hardcode `0.153.4`; fail with a clear message if absent) with `app-server --stdio`; `class OpenCodeBridge` spawning `opencode` with its ACP stdio args (read the exact invocation from `apps/macos/Sources/ZeroKit/OpenCodeACP.swift` and mirror it). Both write a JSONL mirror to `<prefsDir>/zero-meta/<harness>/events.jsonl` (each event one line, append).

- [ ] **Step 1: Write the failing tests** — with a fake child (spawnable stub emitting lines): (1) send correlates id → resolves response; (2) process exit → pending sends reject with `disconnected` and state becomes `disconnected`; (3) mirror file gains one JSONL line per event.

- [ ] **Step 2: Implement** `bridges.ts` and wire IPC ops: `codex.connect` → manual connect (returns state), `codex.send` → throws `send blocked until runtime path ships` when not connected to a live thread (honest blocking, same as Swift), `codex.disconnect` → kill.

- [ ] **Step 3: Run** `npm test` — PASS.

- [ ] **Step 4: Commit**

```sh
git add apps/desktop/src/main/bridges.ts apps/desktop/src/main/bridges.test.ts apps/desktop/src/main/ipc.ts
git commit -m "feat(desktop): codex and opencode stdio bridges with jsonl mirror"
```

---

### Task 13: Route lane C — Airlock + Zero Bot + Skill Lab

**Files:**
- Create: `apps/desktop/src/renderer/src/routes/AirlockRoute.tsx`, `apps/desktop/src/renderer/src/routes/ZeroBotRoute.tsx`, `apps/desktop/src/renderer/src/routes/SkillLabRoute.tsx`
- Modify: `registry.ts`

**Interfaces:**
- Consumes: `CodexBridge`/`OpenCodeBridge` states via IPC (`window.zero.invoke('codex.connect')` etc. — manual connect only), snapshot approvals list.
- Produces: Airlock (single slate + stats + lower-bound notices, port layout from `AirlockView.swift`), Zero Bot (harness picker Codex/OpenCode, strict harness lock with mismatch warning + mirror path label, Connect button per bridge, conversation surface rendering bridge events, send honestly blocked with explanatory notice, voice disabled placeholder), Skill Lab (fixture skills from `SkillStore.swift` data — read-only rendering).

- [ ] **Step 1: Implement** the three routes with memoized pattern; approvals confirm/deny call `window.zero.invoke('command.send', ...)` with the exact approval ID carried in the snapshot.

- [ ] **Step 2: Run** `npm test && npm run build` — PASS; manual dev check: Connect Codex initializes the app-server (model/list probe allowed, no turn started).

- [ ] **Step 3: Commit**

```sh
git add apps/desktop/src/renderer/src/routes/
git commit -m "feat(desktop): airlock, zero bot, skill lab routes"
```

---

### Task 14: Desktop items, dummy files, wallpaper + settings

**Files:**
- Create: `apps/desktop/src/main/desktop-items.json`, `apps/desktop/src/renderer/src/desktop/IconLayer.tsx`, `apps/desktop/src/renderer/src/desktop/DummyFileViewer.tsx`, `apps/desktop/src/renderer/src/desktop/WallpaperLayer.tsx`, `apps/desktop/src/renderer/src/desktop/SettingsSheet.tsx`
- Modify: `DesktopCanvas.tsx`, `prefs.ts` (icon positions persisted)

**Interfaces:**
- Consumes: `PrefsStore`, `ROUTES`, wallpapers from tokens.
- Produces: `desktop-items.json` schema: `{ icons: [{ id, label, kind: 'route' | 'file', route?, file? }], files: [{ id, name, ext: 'txt'|'png'|'pdf'|'notes', content }] }` — seeds: 7 route icons (all routes incl. Skill Lab, running-indicator dot when open) + 4 dummy files (README.txt, architecture.pdf mock, screenshot.png placeholder card, notes). Icon layer: absolute-positioned grid, free drag with position persist via `prefs.set`, double-click opens route window or viewer window. Wallpaper layer: `--z-wallpaper` base + `--z-wallpaper-dot` texture tile (CSS `radial-gradient` dot grid); Settings sheet: wallpaper kind picker (3 bundled + custom via `wallpaper.pick` → `dialog.showOpenDialog` filtering images), cover/tile mode, persisted.

- [ ] **Step 1: Write tests** — `desktop-items.test.ts`: JSON parses, every icon id unique, every route kind references a valid RouteId.

- [ ] **Step 2: Implement** the four components + persistence.

- [ ] **Step 3: Run** `npm test && npm run build` — PASS; manual: drag icon, change wallpaper, restart → persisted.

- [ ] **Step 4: Commit**

```sh
git add apps/desktop/src/main/desktop-items.json apps/desktop/src/main/desktop-items.test.ts apps/desktop/src/renderer/src/desktop/
git commit -m "feat(desktop): icon layer, dummy files, customizable wallpaper"
```

---

### Task 15: Tray companion

**Files:**
- Create: `apps/desktop/src/main/tray.ts`
- Modify: `apps/desktop/src/main/index.ts`

**Interfaces:**
- Consumes: `CockpitModel.state`/snapshot session.
- Produces: `Tray` with template icon (generated at build; fallback: brand-orange circle), tooltip `Zero`, context menu exactly: runtime status label (Connecting/Runtime live/Reconnecting/Runtime offline), focus `H:MM:SS` or `No focus session`, delivery/attention line from snapshot when present, `Open Zero Desktop` (focuses the window), `Quit`. No project selection, no intent entry, no coding actions (AGENTS.md product rule). Status text updates via the model's `subscribe`.

- [ ] **Step 1: Implement** `tray.ts` + wire.
- [ ] **Step 2: Verify** `npm run build`; manual `npm run dev`: tray shows live focus timer while daemon runs.
- [ ] **Step 3: Commit**

```sh
git add apps/desktop/src/main/tray.ts apps/desktop/src/main/index.ts
git commit -m "feat(desktop): compact tray companion"
```

---

### Task 16: Packaging (electron-builder, icon, codesign — artifacts only)

**Files:**
- Create: `apps/desktop/electron-builder.yml`, `apps/desktop/tools/make-icon.sh`, `apps/desktop/resources/`
- Modify: `apps/desktop/package.json` (add `dist` script)

**Interfaces:**
- Produces: signed `Zero Desktop.app` in `apps/desktop/.runtime/desktop-build/` (repo `.runtime` pattern per existing build scripts) — **not installed, not a manifest component yet.**

- [ ] **Step 1: electron-builder.yml**

```yaml
appId: dev.projectzero.desktop
productName: Zero Desktop
directories:
  output: .runtime/desktop-build
  buildResources: resources
files:
  - out/**
  - package.json
mac:
  identity: "Project Zero Local Release"
  hardenedRuntime: true
  category: public.app-category.developer-tools
  icon: resources/ProjectZero.icns
```

- [ ] **Step 2: icon + build script**

`tools/make-icon.sh` renders `../../assets/stitch/project-zero-cockpit-interface/app-icon/project-zero-app-icon.png` through `sips` + `iconutil` into `resources/ProjectZero.icns` (same flow as `tools/build-macos.py` in the repo). `package.json` gets `"dist": "./tools/make-icon.sh && electron-vite build && electron-builder --mac"`.

- [ ] **Step 3: Build**

Run: `cd apps/desktop && npm run dist`
Expected: signed app at `.runtime/desktop-build/mac-arm64/Zero Desktop.app`; `codesign --verify --deep` exits 0. If Keychain prompts appear, stop and report — owner resolves prompts locally (AGENTS.md rule; never automate security dialogs).

- [ ] **Step 4: Commit**

```sh
git add apps/desktop/electron-builder.yml apps/desktop/tools/ apps/desktop/resources/ apps/desktop/package.json
git commit -m "feat(desktop): electron-builder packaging with local release identity"
```

---

### Task 17: Playwright e2e pass

**Files:**
- Create: `apps/desktop/e2e/desktop.spec.ts`, `apps/desktop/playwright.config.ts`

**Interfaces:**
- Consumes: the built app (Task 16) or dev server.
- Produces: green e2e suite covering: app launches; desktop icons visible; double-click Desk icon → Desk window opens; drag window by header → position persists after relaunch (relaunch the app in the test); resize from a right handle → committed size persists; open dummy README.txt → viewer shows content; wallpaper change → background style reflects selection and persists across relaunch.

- [ ] **Step 1: Config**

```ts
// apps/desktop/playwright.config.ts
import { defineConfig } from 'playwright/test'
export default defineConfig({
  testDir: './e2e',
  use: { channel: 'chromium' },
})
```

Spec uses `_electron.launch({ args: ['out/main/index.js'] })` (or `electron-vite dev` via `entryScript`) per current Playwright Electron docs; assert selectors: `#desktop-canvas`, `.zw-icon[data-route=desk]`, `.zw-window[data-route=desk]`, `.zw-header`, `.zw-light`, `#settings`, `.zw-wallpaper`.

- [ ] **Step 2: Run**

Run: `cd apps/desktop && npm run e2e`
Expected: all scenarios pass. Screenshot artifacts saved to `e2e/artifacts/` (gitignored).

- [ ] **Step 3: Full gate**

Run: `cd apps/desktop && npm test && npm run build && npm run e2e`
Expected: everything green.

- [ ] **Step 4: Commit**

```sh
git add apps/desktop/e2e/ apps/desktop/playwright.config.ts
git commit -m "test(desktop): playwright canvas, icons, files, wallpaper pass"
```

---

## Post-plan owner gates (not tasks)

1. Owner visual acceptance of all routes against the Stitch PNGs (the 12-capture equivalent, Electron edition) and idle CPU with 2 windows (<10%).
2. Only after acceptance: retire the SwiftUI UI, add a `desktop` component to `core/release/manifest.json` via the documented release tools, and run a production install. **This plan does not include those steps.**

## Update the working documents

After the final task, update `snapshot.md` (installed/dirty state, versions, verification results, next step) and reconcile `handoff.md` (decisions, evidence, recovery) per AGENTS.md before ending.
