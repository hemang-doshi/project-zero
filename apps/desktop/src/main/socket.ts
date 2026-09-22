import * as http from 'node:http'
import { SSEParser, type SSEEvent } from '../shared/protocol'

const DEFAULT_TIMEOUT_MS = 30_000

export function fetchSnapshot(
  socketPath: string,
  opts: { timeoutMs?: number; path?: string } = {}
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath,
        path: opts.path ?? '/v0.1/cockpit',
        method: 'GET',
        headers: { Accept: 'application/json' }
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`Cockpit snapshot rejected (${res.statusCode})`))
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch {
            reject(new Error('Invalid cockpit snapshot encoding'))
          }
        })
        res.on('error', reject)
      }
    )
    req.setTimeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, () =>
      req.destroy(new Error('Cockpit snapshot timed out'))
    )
    req.on('error', reject)
    req.end()
  })
}

export function postCommand(socketPath: string, body: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = http.request(
      {
        socketPath,
        path: '/v0.1/commands',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`Command rejected (${res.statusCode})`))
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch {
            reject(new Error('Invalid command response encoding'))
          }
        })
        res.on('error', reject)
      }
    )
    req.setTimeout(DEFAULT_TIMEOUT_MS, () => req.destroy(new Error('Command request timed out')))
    req.on('error', reject)
    req.end(payload)
  })
}

export function openStream(
  socketPath: string,
  onEvent: (e: SSEEvent) => void,
  onEnd: (err?: Error) => void
): () => void {
  const parser = new SSEParser()
  const req = http.request(
    {
      socketPath,
      path: '/v0.1/cockpit/stream',
      method: 'GET',
      headers: { Accept: 'text/event-stream' }
    },
    (res) => {
      const ct = String(res.headers['content-type'] ?? '')
      if (res.statusCode !== 200 || !ct.startsWith('text/event-stream')) {
        res.resume()
        onEnd(new Error('Runtime stream rejected'))
        return
      }
      res.on('data', (chunk: Buffer) => {
        try {
          for (const ev of parser.append(chunk)) onEvent(ev)
        } catch (e) {
          req.destroy()
          onEnd(e instanceof Error ? e : new Error('Runtime stream error'))
        }
      })
      res.on('end', () => onEnd())
      res.on('error', (e) => onEnd(e))
    }
  )
  req.setTimeout(DEFAULT_TIMEOUT_MS, () => req.destroy(new Error('Runtime stream timed out')))
  req.on('error', (e) => onEnd(e))
  req.end()
  return () => req.destroy()
}
