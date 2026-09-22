// @vitest-environment jsdom
import { act } from 'react'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { RuntimeRoute, TELEMETRY_DENSITY } from './RuntimeRoute'
import { useCockpit } from '../store/cockpit'

const GIB = 1024 ** 3
const MIB = 1024 ** 2

const SAMPLE = {
  cpu: { system: 8, user: 22, idle: 70, threads: 2345, processes: 42 },
  memory: {
    total: 16 * GIB,
    used: 8 * GIB,
    percent: 50,
    pressure: 50,
    level: 'medium',
    app: 4 * GIB,
    wired: 2 * GIB,
    compressed: 2 * GIB,
    cachedFiles: 1.5 * GIB,
    swapUsed: 0
  },
  io: {
    reads: 1_234_567,
    writes: 2_345_678,
    readsPerSec: 12.5,
    writesPerSec: 3.5,
    dataRead: 1_073_741_824,
    dataWritten: 268_435_456,
    dataReadPerSec: 6 * MIB,
    dataWrittenPerSec: 1.5 * MIB
  },
  net: {
    packetsIn: 12_345,
    packetsOut: 6_789,
    packetsInPerSec: 4.5,
    packetsOutPerSec: 3.5,
    dataReceived: 2_000_000,
    dataSent: 1_500_000,
    dataReceivedPerSec: 1_024,
    dataSentPerSec: 512
  },
  gpu: 42
}

const SAMPLE_B = {
  ...SAMPLE,
  cpu: { system: 8.5, user: 60, idle: 31.5, threads: 3200, processes: 781 }
}

let container: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null

const fakeZero = (impl: () => Promise<unknown>): { invoke: ReturnType<typeof vi.fn> } => {
  const invoke = vi.fn(impl)
  ;(window as unknown as { zero: unknown }).zero = {
    invoke,
    subscribe: vi.fn(() => () => {})
  }
  return { invoke }
}

const flush = async (): Promise<void> => {
  await act(async () => {})
}

const mountRoute = async (): Promise<HTMLElement> => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(RuntimeRoute))
  })
  await flush()
  return container
}

const setVisibility = (state: string): void => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
}

beforeEach(() => {
  useCockpit.setState({ state: 'connecting', snapshot: null, lastError: null, refreshAt: null })
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  container?.remove()
  container = null
  root = null
  delete (window as unknown as { zero?: unknown }).zero
  setVisibility('visible')
  vi.useRealTimers()
})

describe('RuntimeRoute activity monitor panels', () => {
  it('renders the four panel titles', async () => {
    fakeZero(() => Promise.resolve(SAMPLE))
    const el = await mountRoute()
    const text = el.textContent ?? ''
    expect(text).toContain('CPU LOAD')
    expect(text).toContain('MEMORY PRESSURE')
    expect(text).toContain('DISK I/O')
    expect(text).toContain('NETWORK')
  })

  it('renders real color-coded cpu rows and counts', async () => {
    fakeZero(() => Promise.resolve(SAMPLE))
    const el = await mountRoute()
    const text = el.textContent ?? ''
    expect(text).toContain('SYSTEM')
    expect(text).toContain('4.3%')
    expect(text).toContain('USER')
    expect(text).toContain('30.0%')
    expect(text).toContain('IDLE')
    expect(text).toContain('65.8%')
    expect(text).toContain('THREADS')
    expect(text).toContain('2.3K')
    expect(text).toContain('PROCESSES')
    expect(text).toContain('780')
    expect(text).toContain('29.0%')
  })

  it('renders memory breakdown rows in binary GB (units fix)', async () => {
    fakeZero(() => Promise.resolve(SAMPLE))
    const el = await mountRoute()
    const text = el.textContent ?? ''
    expect(text).toContain('PHYS MEM')
    expect(text).toContain('16.00 GB')
    expect(text).toContain('12.50 GB')
    expect(text).toContain('CACHED')
    expect(text).toContain('2.50 GB')
    expect(text).toContain('SWAP USED')
    expect(text).toContain('0.00 GB')
    expect(text).toContain('APP MEM')
    expect(text).toContain('5.00 GB')
    expect(text).toContain('WIRED MEM')
    expect(text).toContain('3.00 GB')
    expect(text).toContain('COMPRESSED')
    expect(text).toContain('4.50 GB')
  })

  it('renders disk and network rows with grouped counts and scaled bytes', async () => {
    fakeZero(() => Promise.resolve(SAMPLE))
    const el = await mountRoute()
    const text = el.textContent ?? ''
    expect(text).toContain('READS')
    expect(text).toContain('1.2M')
    expect(text).toContain('WRITES')
    expect(text).toContain('2.3M')
    expect(text).toContain('DATA READ')
    expect(text).toContain('145.64 GB')
    expect(text).toContain('DATA WRITTEN')
    expect(text).toContain('44.33 GB')
    expect(text).toContain('DATA READ/S')
    expect(text).toContain('6.0 MB')
    expect(text).toContain('DATA WRITTEN/S')
    expect(text).toContain('1.5 MB')
    expect(text).toContain('PKTS IN')
    expect(text).toContain('12.3K')
    expect(text).toContain('RX DATA')
    expect(text).toContain('907.9 MB')
    expect(text).toContain('TX DATA/S')
    expect(text).toContain('20.0 KB')
  })

  it('abbreviates large counters and keeps the exact value in the title tooltip', async () => {
    fakeZero(() => Promise.resolve(SAMPLE))
    const el = await mountRoute()
    const text = el.textContent ?? ''
    // Abbreviated defaults on screen…
    expect(text).toContain('2.3K')
    expect(text).toContain('1.2M')
    expect(text).toContain('2.3M')
    expect(text).toContain('12.3K')
    // …exact values only in tooltips, never as visible text.
    expect(text).not.toContain('1,234,567')
    expect(text).not.toContain('2,345,678')
    expect(text).not.toContain('12,345')
    expect(text).not.toContain('2,345')
    const byText = (s: string): HTMLSpanElement | undefined =>
      [...el.querySelectorAll('span')].find((x) => x.textContent === s) as
        HTMLSpanElement | undefined
    expect(byText('1.2M')?.title).toBe('1,234,567')
    expect(byText('2.3M')?.title).toBe('2,345,678')
    expect(byText('12.3K')?.title).toBe('12,345')
    expect(byText('2.3K')?.title).toBe('2,345')
  })

  it('shortens long row labels and keeps the full form in the title tooltip', async () => {
    fakeZero(() => Promise.resolve(SAMPLE))
    const el = await mountRoute()
    const text = el.textContent ?? ''
    expect(text).toContain('PHYS MEM')
    expect(text).not.toContain('PHYSICAL MEMORY')
    expect(text).toContain('RX DATA')
    expect(text).not.toContain('DATA RECEIVED')
    expect(text).toContain('PKTS IN')
    expect(text).not.toContain('PACKETS IN')
    expect(text).toContain('READS/S')
    expect(text).not.toContain('READS IN/SEC')
    expect(text).toContain('WRITES')
    expect(text).not.toContain('WRITES OUT')
    const byText = (s: string): HTMLSpanElement | undefined =>
      [...el.querySelectorAll('span')].find((x) => x.textContent === s) as
        HTMLSpanElement | undefined
    expect(byText('PHYS MEM')?.title).toBe('PHYSICAL MEMORY')
    expect(byText('RX DATA')?.title).toBe('DATA RECEIVED')
    expect(byText('PKTS IN')?.title).toBe('PACKETS IN')
    expect(byText('READS/S')?.title).toBe('READS IN/SEC')
    // Already-short labels carry no redundant tooltip…
    expect(byText('SYSTEM')?.title).toBe('')
    expect(byText('MEMORY USED')?.title).toBe('')
    // …and exact-small values carry none either.
    expect(byText('780')?.title).toBe('')
  })

  it('renders no ellipsis-truncated spans at normal widths (overflow regression)', async () => {
    const big = {
      ...SAMPLE,
      cpu: { ...SAMPLE.cpu, threads: 12_345_678, processes: 1_500_000 },
      io: { ...SAMPLE.io, reads: 12_345_678, writes: 9_999_999 },
      net: { ...SAMPLE.net, packetsIn: 12_345_678, packetsOut: 12_345_678 }
    }
    fakeZero(() => Promise.resolve(big))
    const el = await mountRoute()
    const text = el.textContent ?? ''
    expect(text).toContain('12.3M')
    expect(text).toContain('1.5M')
    expect(text).not.toContain('12,345,678')
    expect(text).not.toContain('1,500,000')
    // No span in any panel asks for ellipsis truncation: abbreviated numbers
    // and shortened labels always fit their content-sized columns, so the
    // freed width stays with the flexible graph track.
    const ellipsis = [...el.querySelectorAll('section span')].filter(
      (s) => (s as HTMLSpanElement).style.textOverflow === 'ellipsis'
    )
    expect(ellipsis).toHaveLength(0)
  })

  it('keeps abbreviated values and live graphs at narrow widths (no spill)', async () => {
    const big = { ...SAMPLE, io: { ...SAMPLE.io, reads: 12_345_678 } }
    fakeZero(() => Promise.resolve(big))
    const narrow = document.createElement('div')
    narrow.style.width = '320px'
    document.body.appendChild(narrow)
    const narrowRoot = createRoot(narrow)
    try {
      await act(async () => {
        narrowRoot.render(createElement(RuntimeRoute))
      })
      await flush()
      expect(narrow.textContent ?? '').toContain('12.3M')
      expect(narrow.textContent ?? '').not.toContain('12,345,678')
      // Graphs keep their significance: dots render from the first sample.
      expect(narrow.querySelectorAll('circle').length).toBeGreaterThanOrEqual(7)
      // The route scrolls horizontally before anything spills.
      const route = narrow.firstElementChild as HTMLElement | null
      expect(route?.style.overflowX).toBe('auto')
    } finally {
      // Manual-root cleanup must run even when an assertion above fails
      // (red), or this route's focus listener leaks into later tests.
      await act(async () => {
        narrowRoot.unmount()
      })
      narrow.remove()
    }
  })

  it('shows honest placeholders when the op errors before any sample', async () => {
    fakeZero(() => Promise.reject(new Error('nope')))
    const el = await mountRoute()
    const text = el.textContent ?? ''
    expect(text).toContain('—')
    expect(text).not.toContain('%')
    expect(text).toContain('CPU LOAD')
    expect(text).toContain('MEMORY PRESSURE')
  })

  it('keeps the last good sample when a later pull errors (cached semantics)', async () => {
    let calls = 0
    fakeZero(() => (calls++ === 0 ? Promise.resolve(SAMPLE) : Promise.reject(new Error('x'))))
    const el = await mountRoute()
    expect(el.textContent ?? '').toContain('4.3%')
    window.dispatchEvent(new Event('focus'))
    await flush()
    expect(el.textContent ?? '').toContain('4.3%')
    expect(el.textContent ?? '').toContain('16.00 GB')
    expect(calls).toBe(2)
  })

  it('draws graph lines only from the second sample onward', async () => {
    let calls = 0
    fakeZero(() => Promise.resolve(calls++ === 0 ? SAMPLE : SAMPLE_B))
    const el = await mountRoute()
    expect(el.querySelectorAll('polyline')).toHaveLength(0)
    window.dispatchEvent(new Event('focus'))
    await flush()
    const polylines = el.querySelectorAll('polyline')
    expect(polylines.length).toBeGreaterThanOrEqual(6)
    // The cpu history reflects BOTH samples: the system series spans 4.25 → 8.5
    // (y = 54 − v·0.52 in the fixed 240×56 box).
    expect(polylines[0].getAttribute('points')).toBe('2,51.8 238,49.6')
  })

  it('colors the pressure graph and level word by the kernel pressure level', async () => {
    const cases = [
      ['low', 'var(--z-status-green)'],
      ['medium', 'var(--z-marker-yellow)'],
      ['high', 'var(--z-error-red)']
    ] as const
    for (const [level, toneColor] of cases) {
      const levelContainer = document.createElement('div')
      document.body.appendChild(levelContainer)
      const levelRoot = createRoot(levelContainer)
      fakeZero(() => Promise.resolve({ ...SAMPLE, memory: { ...SAMPLE.memory, level } }))
      await act(async () => {
        levelRoot.render(createElement(RuntimeRoute))
      })
      await flush()
      window.dispatchEvent(new Event('focus'))
      await flush()
      const levelWord = [...levelContainer.querySelectorAll('span')].find(
        (s) => s.textContent === level
      )
      expect(levelWord?.style.color).toBe(toneColor)
      if (level === 'high') {
        // The pressure graph is the only polygon (area fill), and 'high' maps
        // to the error tone shared with disk-write/net-out lines — pin the
        // unique polygon fill plus the caption word.
        expect(levelContainer.querySelector('polygon')?.getAttribute('fill')).toBe(toneColor)
      } else {
        // low/medium tones are unique among the sparkline strokes.
        const strokes = [...levelContainer.querySelectorAll('polyline')].map((p) =>
          p.getAttribute('stroke')
        )
        expect(strokes.filter((s) => s === toneColor)).toHaveLength(1)
      }
      await act(async () => {
        levelRoot.unmount()
      })
      levelContainer.remove()
    }
  })

  it('samples on focus and refreshes on a 2 s interval while visible', async () => {
    vi.useFakeTimers()
    const { invoke } = fakeZero(() => Promise.resolve(SAMPLE))
    await mountRoute()
    expect(invoke).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('focus'))
    await flush()
    expect(invoke).toHaveBeenCalledTimes(2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(invoke).toHaveBeenCalledTimes(3)
  })

  it('gates sampling on document visibility', async () => {
    vi.useFakeTimers()
    const { invoke } = fakeZero(() => Promise.resolve(SAMPLE))
    setVisibility('hidden')
    await mountRoute()
    expect(invoke).not.toHaveBeenCalled()
    setVisibility('visible')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('pins the dense panel spacing tokens (named constants, no magic numbers)', () => {
    expect(TELEMETRY_DENSITY).toEqual({
      routePad: '14px 16px',
      routeGap: 10,
      panelPad: '8px 10px 10px',
      panelGap: 6,
      bodyColsGraphCenter: 'max-content minmax(140px, 1fr) max-content',
      bodyColsGraphLeft: 'minmax(120px, 1fr) max-content max-content',
      bodyGap: 10,
      rowGap: 2,
      rowInnerGap: 6,
      graphGap: 2
    })
  })

  it('applies the density tokens to the rendered panels', async () => {
    fakeZero(() => Promise.resolve(SAMPLE))
    const el = await mountRoute()
    const section = el.querySelector('section')
    expect(section?.style.padding).toBe('8px 10px 10px')
    expect(section?.style.gap).toBe('6px')
    const bodies = [...el.querySelectorAll('div')].filter((d) => d.style.display === 'grid')
    expect(bodies).toHaveLength(4)
    // CPU/IO/NET graph in the center; memory graphs on the left (its center
    // column carries stat rows, so it must not size from the svg content).
    expect(
      bodies.filter((b) => b.style.gridTemplateColumns === TELEMETRY_DENSITY.bodyColsGraphCenter)
    ).toHaveLength(3)
    expect(
      bodies.filter((b) => b.style.gridTemplateColumns === TELEMETRY_DENSITY.bodyColsGraphLeft)
    ).toHaveLength(1)
    for (const body of bodies) expect(body.style.gap).toBe('10px')
    const inSection = [...el.querySelectorAll('section div')].filter(
      (d): d is HTMLDivElement => d instanceof HTMLDivElement
    )
    const rows = inSection.filter(
      (d) =>
        d.style.display === 'flex' &&
        d.style.justifyContent === 'space-between' &&
        d.firstElementChild instanceof HTMLSpanElement &&
        d.firstElementChild.style.fontSize === '9.5px'
    )
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row.style.gap).toBe('6px')
    const stacks = inSection.filter(
      (d) =>
        d.style.display === 'flex' &&
        d.style.flexDirection === 'column' &&
        d.firstElementChild instanceof HTMLDivElement
    )
    expect(stacks.length).toBeGreaterThan(0)
    for (const stack of stacks) expect(stack.style.gap).toBe('2px')
  })

  it('keeps sampling regardless of the runtime connection state', async () => {
    useCockpit.setState({ state: 'offline' })
    const { invoke } = fakeZero(() => Promise.resolve(SAMPLE))
    await mountRoute()
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('renders a dot for a lone observation instead of an empty graph', async () => {
    fakeZero(() => Promise.resolve(SAMPLE))
    const el = await mountRoute()
    // One sample → every series holds exactly one point: no lines yet, but
    // each sparkline shows its observation as a dot (no vanishing graphs).
    expect(el.querySelectorAll('polyline')).toHaveLength(0)
    const dots = el.querySelectorAll('circle')
    expect(dots.length).toBeGreaterThanOrEqual(7)
    for (const dot of dots) {
      expect(dot.getAttribute('cx')).not.toBeNull()
      expect(dot.getAttribute('cy')).not.toBeNull()
      expect(dot.getAttribute('r')).toBe('2.5')
    }
  })

  it('leaves honest-empty graphs truly empty (no dots, no lines)', async () => {
    fakeZero(() => Promise.reject(new Error('nope')))
    const el = await mountRoute()
    expect(el.querySelectorAll('polyline')).toHaveLength(0)
    expect(el.querySelectorAll('circle')).toHaveLength(0)
    expect(el.querySelectorAll('polygon')).toHaveLength(0)
  })

  it('renders a flat series as a horizontal line (never vanishes)', async () => {
    const flat = {
      ...SAMPLE,
      cpu: { system: 10, user: 10, idle: 80, threads: 100, processes: 50 }
    }
    fakeZero(() => Promise.resolve(flat))
    const el = await mountRoute()
    window.dispatchEvent(new Event('focus'))
    await flush()
    const lines = [...el.querySelectorAll('polyline')]
    expect(lines.length).toBeGreaterThanOrEqual(6)
    // cpuSystem [10, 10] → y = 54 − 10·0.52 = 48.8 twice.
    expect(lines[0].getAttribute('points')).toBe('2,48.8 238,48.8')
  })

  it('preserves the last-known path across null ticks (no vanishing)', async () => {
    const calls = [SAMPLE, SAMPLE_B, { cpu: null, memory: null, io: null, net: null, gpu: null }]
    let n = 0
    fakeZero(() => Promise.resolve(calls[Math.min(n++, calls.length - 1)]))
    const el = await mountRoute()
    window.dispatchEvent(new Event('focus'))
    await flush()
    const before = [...el.querySelectorAll('polyline')].map((p) => p.getAttribute('points'))
    expect(before.length).toBeGreaterThanOrEqual(6)
    // Third tick carries no usable values for any family.
    window.dispatchEvent(new Event('focus'))
    await flush()
    const after = [...el.querySelectorAll('polyline')].map((p) => p.getAttribute('points'))
    expect(after).toEqual(before)
  })

  it('keeps graph geometry with no measured container size (viewBox, not pixels)', async () => {
    let calls = 0
    fakeZero(() => Promise.resolve(calls++ === 0 ? SAMPLE : SAMPLE_B))
    const narrow = document.createElement('div')
    narrow.style.width = '0px'
    document.body.appendChild(narrow)
    const narrowRoot = createRoot(narrow)
    await act(async () => {
      narrowRoot.render(createElement(RuntimeRoute))
    })
    await flush()
    window.dispatchEvent(new Event('focus'))
    await flush()
    const lines = [...narrow.querySelectorAll('polyline')]
    expect(lines.length).toBeGreaterThanOrEqual(6)
    expect(lines[0].getAttribute('points')).toBe('2,51.8 238,49.6')
    for (const svg of narrow.querySelectorAll('svg')) {
      expect(svg.getAttribute('viewBox')).toBe('0 0 240 56')
    }
    await act(async () => {
      narrowRoot.unmount()
    })
    narrow.remove()
  })
})
