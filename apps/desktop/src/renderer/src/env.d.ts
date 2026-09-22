/// <reference types="vite/client" />

import type { ModelUpdate } from '../../main/cockpit-model'
import type { OpName } from '../../shared/ipc'

export type BridgePush = {
  harness: string
  event: { method: string; id?: unknown; params?: unknown }
}

declare global {
  interface Window {
    zero: {
      invoke: (op: OpName, payload?: unknown) => Promise<unknown>
      subscribe(channel: 'cockpit', cb: (u: ModelUpdate) => void): () => void
      subscribe(channel: 'bridge', cb: (u: BridgePush) => void): () => void
    }
  }
}
