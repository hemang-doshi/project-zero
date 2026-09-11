/// <reference types="vite/client" />

import type { ModelUpdate } from '../../main/cockpit-model'
import type { OpName } from '../../shared/ipc'

declare global {
  interface Window {
    zero: {
      invoke: (op: OpName, payload?: unknown) => Promise<unknown>
      subscribe: (channel: 'cockpit', cb: (u: ModelUpdate) => void) => () => void
    }
  }
}

export {}
