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
  private _state: RuntimeConnState = 'offline'
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
    private openFn: (
      socketPath: string,
      onEvent: (e: SSEEvent) => void,
      onEnd: (err?: Error) => void
    ) => () => void,
    private opts: ModelOpts = {}
  ) {}

  subscribe(cb: (u: ModelUpdate) => void): () => void {
    this.listeners.add(cb)
    cb(this.update())
    return () => this.listeners.delete(cb)
  }

  get state(): RuntimeConnState {
    return this._state
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.generation++
    this.streamReady = false
    this._state = 'connecting'
    this.emit()
    void this.loop(this.generation)
  }

  stop(): void {
    this.running = false
    this.generation++
    this.closeStream?.()
    this.closeStream = null
    this.refreshing = false
    this.refreshPending = false
    this._state = 'offline'
    this.emit()
  }

  refresh(): void {
    if (!this.running) return
    if (this.refreshing) {
      this.refreshPending = true
      return
    }
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
          this._state = this.streamReady ? 'live' : 'reconnecting'
          this.scheduleAge(gen)
          this.emit()
        } catch (e) {
          if (this.generation !== gen || this.refreshEpoch !== epoch) return
          this.lastError = e instanceof Error ? e.message : String(e)
          this._state = 'offline'
          this.scheduleAge(gen)
          this.emit()
        }
        if (this.refreshPending) {
          this.refreshPending = false
          continue
        }
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
    return {
      snapshot: this.snapshot,
      state: this._state,
      receivedAt: this.receivedAt,
      lastError: this.lastError
    }
  }

  private async loop(gen: number): Promise<void> {
    while (this.running && this.generation === gen) {
      await new Promise<void>((resolve) => {
        // Idempotent: the socket layer may invoke onEnd more than once
        // (e.g. error followed by res 'end'); only the first call counts.
        let ended = false
        const onEnd = (err?: Error): void => {
          if (ended) return
          ended = true
          resolve()
          if (err) this.lastError = err.message
        }
        this.closeStream = this.openFn(
          this.socketPath,
          (ev) => {
            if (this.generation !== gen) return
            let change
            try {
              change = parseRuntimeChange(ev)
            } catch {
              return // malformed known events fail closed: dropped
            }
            if (change.name === 'ready') {
              this.refreshEpoch++
              this.refreshing = false
              this.refreshPending = false
              this.streamReady = true
              this._state = 'connecting'
              this.emit()
              this.scheduleAge(gen)
              this.refresh()
            } else {
              this.streamReady = true
              this.refresh()
            }
          },
          onEnd
        )
      })
      if (!this.running || this.generation !== gen) return
      this.refreshEpoch++
      this.refreshing = false
      this.refreshPending = false
      this.streamReady = false
      this._state = 'reconnecting'
      this.emit()
      await new Promise((r) => setTimeout(r, this.opts.reconnectDelayMs ?? 500))
    }
  }
}
