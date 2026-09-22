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
      if (this.afterCR) {
        this.afterCR = false
        if (byte === 10) continue
      }
      this.eventBytes++
      if (this.eventBytes > this.maximumEventBytes) throw new Error('Runtime event too large')
      if (byte === 10 || byte === 13) {
        const text = new TextDecoder().decode(new Uint8Array(this.line))
        this.line = []
        this.afterCR = byte === 13
        if (text === '') {
          if (this.data.length) {
            events.push({ name: this.name, data: this.data.join('\n') })
            this.name = 'message'
            this.data = []
            this.eventBytes = 0
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
export type RuntimeChange = {
  name: StreamEventName
  revision: number
  domains: string[]
  timestamp: string
}

export function parseRuntimeChange(event: SSEEvent): RuntimeChange {
  if (!(STREAM_EVENT_NAMES as readonly string[]).includes(event.name))
    throw new Error('Unknown runtime event')
  let payload: unknown
  try {
    payload = JSON.parse(event.data)
  } catch {
    throw new Error('Invalid runtime event encoding')
  }
  const p = payload as { revision?: unknown; domains?: unknown; timestamp?: unknown }
  if (
    typeof p.revision !== 'number' ||
    typeof p.timestamp !== 'string' ||
    !Array.isArray(p.domains)
  )
    throw new Error('Malformed runtime event')
  if (p.domains.length > 100) throw new Error('Runtime event has too many domains')
  return {
    name: event.name as StreamEventName,
    revision: p.revision,
    domains: p.domains as string[],
    timestamp: p.timestamp
  }
}

export type RuntimeConnState = 'connecting' | 'live' | 'reconnecting' | 'offline'
