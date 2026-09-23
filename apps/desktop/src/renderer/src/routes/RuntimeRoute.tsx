import { memo, useEffect, useMemo, useState } from 'react'
import { ZERO_TYPE } from '../../../shared/tokens'
import { formatBytes, formatBytesPerSec, formatGib } from '../../../shared/format'
import { useCockpit } from '../store/cockpit'
import { Chip } from './Chip'
import {
  EMPTY_MACHINE_SAMPLE,
  TONE_COLOR,
  activeProjectLabel,
  parseTelemetry,
  pressureTone,
  selectSession,
  type MachineSample
} from './runtime.types'
import {
  group,
  shortCount,
  shortLabel,
  windowMax,
  historyFromPoints,
  EMPTY_HISTORY,
  timelineGeometry,
  GRAPH_W,
  GRAPH_H,
  GRAPH_MARGIN,
  DOT_R,
  type TelemetryHistory
} from './telemetry.model'

// Dense-but-clean panel spacing (Task 31): stat columns size to their
// content so label/value air collapses to rowInnerGap and long counters
// never ellipsize at normal widths. Graph columns stay flexible: the svg
// scales through its viewBox, so it must NOT size its track from its
// 240px aspect-ratio content (that squeeze truncated the memory rows).
// Two recipes because the memory panel graphs on the left while the other
// three graph in the center. The graph track keeps a floor (120/140px) so
// it always has a measured box (no zero-size vanish); the route scrolls
// horizontally before anything truncates or spills.
export const TELEMETRY_DENSITY = {
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
} as const

const routeStyle: React.CSSProperties = {
  height: '100%',
  overflowY: 'auto',
  overflowX: 'auto',
  padding: TELEMETRY_DENSITY.routePad,
  display: 'flex',
  flexDirection: 'column',
  gap: TELEMETRY_DENSITY.routeGap
}

const microStyle: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.14em',
  color: 'var(--z-secondary-ink)'
}

const headerRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 12
}

const projectStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: 'var(--z-ink)'
}

const panelStyle: React.CSSProperties = {
  background: 'var(--z-card-cream)',
  border: '1px solid var(--z-line)',
  borderRadius: 8,
  padding: TELEMETRY_DENSITY.panelPad,
  display: 'flex',
  flexDirection: 'column',
  gap: TELEMETRY_DENSITY.panelGap,
  minWidth: 0
}

const panelHead: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10
}

const legendItem: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  fontFamily: ZERO_TYPE.mono,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.1em',
  color: 'var(--z-secondary-ink)'
}

const legendSwatch = (color: string): React.CSSProperties => ({
  width: 8,
  height: 8,
  borderRadius: 2,
  background: color
})

const panelBody = (cols: string): React.CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: cols,
  gap: TELEMETRY_DENSITY.bodyGap,
  alignItems: 'start'
})

const statRows: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: TELEMETRY_DENSITY.rowGap,
  minWidth: 0
}

const statRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: TELEMETRY_DENSITY.rowInnerGap
}

const statLabel: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: '0.1em',
  color: 'var(--z-secondary-ink)',
  whiteSpace: 'nowrap'
}

const statValue: React.CSSProperties = {
  fontSize: 12.5,
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
  // No ellipsis here (Task 34): every value is bounded to ~10 chars by
  // construction — shortCount ('999.9M'), binary bytes ('145.64 GB'),
  // percentages ('100.0%') — so the … glyph is never needed. overflow:hidden
  // stays as the absurd-width backstop; the route scrolls horizontally
  // before any supported width can reach it.
  overflow: 'hidden',
  whiteSpace: 'nowrap'
}

const graphBox: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: TELEMETRY_DENSITY.graphGap,
  minWidth: 0
}

const graphTitle: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.12em',
  color: 'var(--z-secondary-ink)'
}

const graphCaption: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 9,
  color: 'var(--z-secondary-ink)'
}

const noticeStyle: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10.5,
  color: 'var(--z-secondary-ink)',
  borderTop: '1px solid var(--z-line)',
  paddingTop: 10,
  lineHeight: 1.6
}

const TELEMETRY_INTERVAL_MS = 2_000
const GRAPH_WINDOW_MS = 30_000

// Activity-Monitor color coding from tokens: system red / user blue /
// pressure by kernel level / plain ink.
const INK = 'var(--z-ink)'
const SYSTEM_RED = 'var(--z-error-red)'
const USER_BLUE = 'var(--z-highlight-blue)'

type RowSpec = {
  label: string
  // Full label form for the title tooltip; omitted when the display label
  // is already the full form (no redundant tooltip).
  fullLabel?: string
  value: string
  // Exact value for the title tooltip; omitted when the display value is
  // already exact (no redundant tooltip).
  exactValue?: string
  color?: string
}

type Cell = { value: string; exact?: string }

// A display cell: the short default plus the exact form for the tooltip.
// The tooltip is omitted when the display is already exact.
const cell = (value: string, exact: string): Cell =>
  exact === value ? { value } : { value, exact }

// Build a row from its FULL label: the short display form comes from the
// shared TELEMETRY_LABEL_SHORT map, the full form rides the tooltip.
const row = (full: string, cellValue: Cell, color?: string): RowSpec => {
  const label = shortLabel(full)
  return {
    label,
    fullLabel: label === full ? undefined : full,
    value: cellValue.value,
    exactValue: cellValue.exact,
    color
  }
}

const countCell = (v: number | null | undefined): Cell =>
  typeof v === 'number' && Number.isFinite(v) ? cell(shortCount(v), group(v)) : { value: '—' }

const byteCell = (v: number | null | undefined): Cell =>
  typeof v === 'number' && Number.isFinite(v)
    ? cell(formatBytes(v), `${group(Math.round(v))} B`)
    : { value: '—' }

const byteRateCell = (v: number | null | undefined): Cell =>
  // Display stays Task-31-exact (formatBytes, no '/s' suffix): the row label
  // already carries the rate ('DATA READ/S'), so a suffixed value would
  // stutter ('…/S …/s') and grow the value column. The per-second truth
  // lives in the tooltip's exact form.
  typeof v === 'number' && Number.isFinite(v)
    ? cell(formatBytes(v), `${group(Math.round(v))} B/s`)
    : { value: '—' }

const gibCell = (v: number | null | undefined): Cell =>
  typeof v === 'number' && Number.isFinite(v)
    ? cell(formatGib(v), `${group(Math.round(v))} B`)
    : { value: '—' }

const pctCell = (v: number | null): Cell => {
  if (v === null) return { value: '—' }
  const display = `${v.toFixed(1)}%`
  // The one-decimal display is already exact for whole/tenth values; only
  // rounded values (4.25 → '4.3%') earn a tooltip.
  return Number(v.toFixed(1)) === v ? { value: display } : { value: display, exact: `${v}%` }
}

function StatRows({ rows }: { rows: RowSpec[] }): React.JSX.Element {
  return (
    <div style={statRows}>
      {rows.map((r) => (
        <div key={r.fullLabel ?? r.label} style={statRow}>
          <span style={statLabel} title={r.fullLabel}>
            {r.label}
          </span>
          <span style={{ ...statValue, color: r.color ?? INK }} title={r.exactValue}>
            {r.value}
          </span>
        </div>
      ))}
    </div>
  )
}

function Sparkline({
  values,
  at,
  now,
  color,
  max,
  fill = false
}: {
  values: Array<number | null>
  at: number[]
  now: number
  color: string
  max: number
  fill?: boolean
}): React.JSX.Element {
  const geometry = timelineGeometry(values, at, now, max, GRAPH_WINDOW_MS)
  const base = GRAPH_H - GRAPH_MARGIN
  const edge = GRAPH_W - GRAPH_MARGIN
  return (
    <svg
      viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: GRAPH_H, display: 'block' }}
    >
      {fill
        ? geometry.paths.map((points) => {
            const firstX = points.split(' ')[0]?.split(',')[0] ?? String(GRAPH_MARGIN)
            const lastX = points.split(' ').at(-1)?.split(',')[0] ?? String(edge)
            return (
              <polygon
                key={points}
                points={`${points} ${lastX},${base} ${firstX},${base}`}
                fill={color}
                opacity={0.14}
              />
            )
          })
        : null}
      {geometry.paths.map((points) => (
        <polyline key={points} points={points} fill="none" stroke={color} strokeWidth={2} />
      ))}
      {geometry.dots.map((point) => {
        const [dotX, dotY] = point.split(',')
        return <circle key={point} cx={dotX} cy={dotY} r={DOT_R} fill={color} />
      })}
    </svg>
  )
}

function Panel({
  title,
  legend,
  left,
  center,
  right,
  cols = TELEMETRY_DENSITY.bodyColsGraphCenter
}: {
  title: string
  legend: Array<{ label: string; color: string }> | null
  left: React.JSX.Element
  center: React.JSX.Element
  right: React.JSX.Element
  cols?: string
}): React.JSX.Element {
  return (
    <section style={panelStyle}>
      <div style={panelHead}>
        <span style={microStyle}>{title}</span>
        {legend === null ? null : (
          <span style={{ display: 'inline-flex', gap: 12 }}>
            {legend.map((l) => (
              <span key={l.label} style={legendItem}>
                <span style={legendSwatch(l.color)} />
                {l.label}
              </span>
            ))}
          </span>
        )}
      </div>
      <div style={panelBody(cols)}>
        {left}
        {center}
        {right}
      </div>
    </section>
  )
}

function CpuPanel({
  sample,
  history,
  now
}: {
  sample: MachineSample
  history: TelemetryHistory
  now: number
}): React.JSX.Element {
  const c = sample.cpu
  return (
    <Panel
      title="CPU LOAD"
      legend={[
        { label: 'SYSTEM', color: SYSTEM_RED },
        { label: 'USER', color: USER_BLUE }
      ]}
      left={
        <StatRows
          rows={[
            row('SYSTEM', pctCell(c?.system ?? null), SYSTEM_RED),
            row('USER', pctCell(c?.user ?? null), USER_BLUE),
            row('IDLE', pctCell(c?.idle ?? null))
          ]}
        />
      }
      center={
        <div style={graphBox}>
          <span style={graphTitle}>CPU HISTORY</span>
          <Sparkline
            values={history.cpuSystem}
            at={history.at}
            now={now}
            color={SYSTEM_RED}
            max={100}
          />
          <Sparkline
            values={history.cpuUser}
            at={history.at}
            now={now}
            color={USER_BLUE}
            max={100}
          />
          <span style={graphCaption}>scale 0–100 · 60-point window</span>
        </div>
      }
      right={
        <StatRows
          rows={[row('THREADS', countCell(c?.threads)), row('PROCESSES', countCell(c?.processes))]}
        />
      }
    />
  )
}

function MemoryPanel({
  sample,
  history,
  now
}: {
  sample: MachineSample
  history: TelemetryHistory
  now: number
}): React.JSX.Element {
  const m = sample.memory
  const level = m?.level ?? 'low'
  // Color-by-level: the kernel pressure level picks the tone, and the tone
  // picks the token color for the graph, its legend chip, and the caption word.
  const pressureColor = TONE_COLOR[pressureTone(level)]
  const pressure = m?.pressure ?? null
  const pressureDisplay = pressure == null ? '—' : pressure.toFixed(1)
  const pressureTitle =
    pressure == null || Number(pressure.toFixed(1)) === pressure
      ? undefined
      : `pressure ${pressure}`
  return (
    <Panel
      title="MEMORY PRESSURE"
      legend={[{ label: 'PRESSURE', color: pressureColor }]}
      cols={TELEMETRY_DENSITY.bodyColsGraphLeft}
      left={
        <div style={graphBox}>
          <span style={graphTitle}>PRESSURE</span>
          <Sparkline
            values={history.pressure}
            at={history.at}
            now={now}
            color={pressureColor}
            max={100}
            fill
          />
          <span style={graphCaption} title={pressureTitle}>
            {`${pressureDisplay} · `}
            <span style={{ color: pressureColor }}>{level}</span>
          </span>
        </div>
      }
      center={
        <StatRows
          rows={[
            row('PHYSICAL MEMORY', gibCell(m?.total)),
            row('MEMORY USED', gibCell(m?.used)),
            row('CACHED FILES', gibCell(m?.cachedFiles)),
            row('SWAP USED', gibCell(m?.swapUsed))
          ]}
        />
      }
      right={
        <StatRows
          rows={[
            row('APP MEMORY', gibCell(m?.app)),
            row('WIRED MEMORY', gibCell(m?.wired)),
            row('COMPRESSED', gibCell(m?.compressed))
          ]}
        />
      }
    />
  )
}

function IoPanel({
  sample,
  history,
  now
}: {
  sample: MachineSample
  history: TelemetryHistory
  now: number
}): React.JSX.Element {
  const io = sample.io
  const peak = Math.max(1, windowMax(history.ioRead), windowMax(history.ioWrite))
  const peakDisplay = formatBytesPerSec(peak)
  const peakExact = `${group(Math.round(peak))} B/s`
  return (
    <Panel
      title="DISK I/O"
      legend={[
        { label: 'READ', color: USER_BLUE },
        { label: 'WRITE', color: SYSTEM_RED }
      ]}
      left={
        <StatRows
          rows={[
            row('READS IN', countCell(io?.reads)),
            row('WRITES OUT', countCell(io?.writes)),
            row('READS IN/SEC', countCell(io?.readsPerSec)),
            row('WRITES OUT/SEC', countCell(io?.writesPerSec))
          ]}
        />
      }
      center={
        <div style={graphBox}>
          <span style={graphTitle}>I/O HISTORY</span>
          <Sparkline
            values={history.ioRead}
            at={history.at}
            now={now}
            color={USER_BLUE}
            max={peak}
          />
          <Sparkline
            values={history.ioWrite}
            at={history.at}
            now={now}
            color={SYSTEM_RED}
            max={peak}
          />
          <span
            style={graphCaption}
            title={peakExact === peakDisplay ? undefined : `peak ${peakExact} · autoscaled`}
          >{`peak ${peakDisplay} · autoscaled`}</span>
        </div>
      }
      right={
        <StatRows
          rows={[
            row('DATA READ', byteCell(io?.dataRead)),
            row('DATA WRITTEN', byteCell(io?.dataWritten)),
            row('DATA READ/SEC', byteRateCell(io?.dataReadPerSec)),
            row('DATA WRITTEN/SEC', byteRateCell(io?.dataWrittenPerSec))
          ]}
        />
      }
    />
  )
}

function NetPanel({
  sample,
  history,
  now
}: {
  sample: MachineSample
  history: TelemetryHistory
  now: number
}): React.JSX.Element {
  const net = sample.net
  const peak = Math.max(1, windowMax(history.netIn), windowMax(history.netOut))
  const peakShort = shortCount(peak)
  const peakExact = group(Math.round(peak))
  return (
    <Panel
      title="NETWORK"
      legend={[
        { label: 'IN', color: USER_BLUE },
        { label: 'OUT', color: SYSTEM_RED }
      ]}
      left={
        <StatRows
          rows={[
            row('PACKETS IN', countCell(net?.packetsIn)),
            row('PACKETS OUT', countCell(net?.packetsOut)),
            row('PACKETS IN/SEC', countCell(net?.packetsInPerSec)),
            row('PACKETS OUT/SEC', countCell(net?.packetsOutPerSec))
          ]}
        />
      }
      center={
        <div style={graphBox}>
          <span style={graphTitle}>PACKETS HISTORY</span>
          <Sparkline
            values={history.netIn}
            at={history.at}
            now={now}
            color={USER_BLUE}
            max={peak}
          />
          <Sparkline
            values={history.netOut}
            at={history.at}
            now={now}
            color={SYSTEM_RED}
            max={peak}
          />
          <span
            style={graphCaption}
            title={peakExact === peakShort ? undefined : `peak ${peakExact} pk/s · autoscaled`}
          >{`peak ${peakShort} pk/s · autoscaled`}</span>
        </div>
      }
      right={
        <StatRows
          rows={[
            row('DATA RECEIVED', byteCell(net?.dataReceived)),
            row('DATA SENT', byteCell(net?.dataSent)),
            row('DATA RECEIVED/SEC', byteRateCell(net?.dataReceivedPerSec)),
            row('DATA SENT/SEC', byteRateCell(net?.dataSentPerSec))
          ]}
        />
      }
    />
  )
}

export const RuntimeRoute = memo(function RuntimeRoute(): React.JSX.Element {
  const conn = useCockpit((s) => s.state)
  const project = useCockpit((s) => selectSession(s.snapshot)?.project ?? '')
  const sessionState = useCockpit((s) => selectSession(s.snapshot)?.state ?? null)
  const [sample, setSample] = useState<MachineSample>(EMPTY_MACHINE_SAMPLE)
  const [history, setHistory] = useState<TelemetryHistory>(EMPTY_HISTORY)
  const [failures, setFailures] = useState<string[]>([])
  const [sampleAt, setSampleAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [processMetric, setProcessMetric] = useState<'cpu' | 'memory' | 'disk' | 'network'>('cpu')
  const hasBridge = typeof window !== 'undefined' && window.zero !== undefined

  useEffect(() => {
    if (!hasBridge) return
    let active = true
    const pull = async (): Promise<void> => {
      if (document.visibilityState !== 'visible') return
      try {
        const raw = await window.zero.invoke('telemetry.history')
        if (!active) return
        const points = (Array.isArray(raw) ? raw : []).flatMap((value) => {
          if (typeof value !== 'object' || value === null) return []
          const point = value as Record<string, unknown>
          if (typeof point.at !== 'number' || !Number.isFinite(point.at)) return []
          return [
            {
              at: point.at,
              sample: parseTelemetry(point.sample),
              failures: Array.isArray(point.failures)
                ? point.failures.filter((item): item is string => typeof item === 'string')
                : []
            }
          ]
        })
        if (points.length === 0) {
          points.push({ at: Date.now(), sample: parseTelemetry(raw), failures: [] })
        }
        const latest = points.at(-1)
        setHistory(historyFromPoints(points))
        setSample(latest?.sample ?? EMPTY_MACHINE_SAMPLE)
        setFailures(latest?.failures ?? [])
        setSampleAt(latest?.at ?? null)
        if (latest !== undefined) setNow(Math.max(Date.now(), latest.at))
      } catch {
        if (active) setFailures(['sampler'])
      }
    }
    void pull()
    const id = window.setInterval(() => void pull(), TELEMETRY_INTERVAL_MS)
    const refresh = (): void => {
      void pull()
    }
    window.addEventListener('focus', refresh)
    return () => {
      active = false
      window.clearInterval(id)
      window.removeEventListener('focus', refresh)
    }
  }, [hasBridge])

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(id)
  }, [])

  const machineStatus =
    sampleAt === null || now - sampleAt > 10_000
      ? { label: 'MACHINE UNAVAILABLE', tone: 'error' as const }
      : failures.some((failure) => ['cpu', 'memory', 'disk', 'network', 'gpu'].includes(failure))
        ? { label: 'MACHINE PARTIAL', tone: 'attention' as const }
        : { label: 'MACHINE LIVE', tone: 'healthy' as const }
  const topProcesses = useMemo(() => {
    const rows = sample.processes ?? []
    return processMetric === 'memory'
      ? [...rows].sort((a, b) => (b.residentBytes ?? -1) - (a.residentBytes ?? -1)).slice(0, 10)
      : [...rows].slice(0, 10)
  }, [sample.processes, processMetric])
  const unsupportedProcessMetric = processMetric === 'disk' || processMetric === 'network'
  const processDetail =
    processMetric === 'cpu'
      ? 'CPU utilization from the ps snapshot'
      : processMetric === 'memory'
        ? 'Resident memory · ps RSS'
        : 'Per-process counters are unavailable from the current unprivileged macOS sources.'

  return (
    <div className="zw-route" style={routeStyle}>
      <div style={headerRow}>
        <span style={microStyle}>RUNTIME — MACHINE TELEMETRY</span>
        <Chip label={machineStatus.label} tone={machineStatus.tone} />
      </div>
      <span style={projectStyle}>{activeProjectLabel(conn, project)}</span>
      <span style={graphCaption}>
        Zero runtime · {sessionState ?? 'unavailable'} · machine readings come from local macOS
        counters
      </span>
      <CpuPanel sample={sample} history={history} now={now} />
      <MemoryPanel sample={sample} history={history} now={now} />
      <IoPanel sample={sample} history={history} now={now} />
      <NetPanel sample={sample} history={history} now={now} />
      <section style={panelStyle} aria-label="GPU utilization">
        <div style={panelHead}>
          <span style={microStyle}>GPU UTILIZATION</span>
          <Chip
            label={sample.gpu === null ? 'UNAVAILABLE' : `${sample.gpu.toFixed(1)}%`}
            tone={sample.gpu === null ? 'neutral' : 'healthy'}
          />
        </div>
        <div style={graphBox}>
          <Sparkline
            values={history.gpu}
            at={history.at}
            now={now}
            color="var(--z-highlight-blue)"
            max={100}
          />
          <span style={graphCaption}>
            {sample.gpu === null
              ? 'No ioreg Device Utilization counter in the latest sample.'
              : 'Apple GPU · ioreg Device Utilization · 30 second window'}
          </span>
        </div>
      </section>
      <details style={panelStyle}>
        <summary style={{ ...microStyle, cursor: 'pointer' }}>TOP PROCESSES · 10</summary>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['cpu', 'memory', 'disk', 'network'] as const).map((metric) => (
            <button
              key={metric}
              type="button"
              aria-pressed={processMetric === metric}
              onClick={() => setProcessMetric(metric)}
            >
              {metric === 'memory' ? 'RESIDENT MEMORY' : metric.toUpperCase()}
            </button>
          ))}
        </div>
        <span style={graphCaption}>
          {processDetail}
          {sampleAt === null ? '' : ` · sampled ${new Date(sampleAt).toLocaleTimeString()}`}
        </span>
        {!unsupportedProcessMetric
          ? topProcesses.map((process) => (
              <div
                key={process.pid}
                style={{ ...statRow, borderTop: '1px solid var(--z-line)', paddingTop: 5 }}
              >
                <span style={{ ...statLabel, flex: 1 }}>
                  {process.name} · {process.pid}
                </span>
                <span style={statValue}>
                  {processMetric === 'cpu'
                    ? `${process.cpuPercent?.toFixed(1) ?? '—'}%`
                    : process.residentBytes === null
                      ? '—'
                      : formatBytes(process.residentBytes)}
                </span>
              </div>
            ))
          : null}
      </details>
      <span style={noticeStyle}>
        Local macOS counters · 2 second samples · 30 second graph window ·{' '}
        {failures.length === 0
          ? 'no sampler errors'
          : `unavailable families: ${failures.join(', ')}`}
      </span>
    </div>
  )
})
