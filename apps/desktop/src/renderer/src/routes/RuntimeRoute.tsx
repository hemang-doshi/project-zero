import { memo, useEffect, useState } from 'react'
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
  sessionChipTone,
  type MachineSample
} from './runtime.types'
import {
  accumulateHistory,
  group,
  polyPoints,
  windowMax,
  EMPTY_HISTORY,
  type TelemetryHistory
} from './telemetry.model'

const routeStyle: React.CSSProperties = {
  height: '100%',
  overflowY: 'auto',
  padding: '20px 22px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14
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
  padding: '10px 14px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
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

const panelBody: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '132px minmax(0, 1fr) 148px',
  gap: 16,
  alignItems: 'start'
}

const statRows: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  minWidth: 0
}

const statRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 8
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
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const graphBox: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
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
  paddingTop: 12,
  lineHeight: 1.6
}

const GRAPH_W = 240
const GRAPH_H = 56

// Activity-Monitor color coding from tokens: system red / user blue /
// pressure by kernel level / plain ink.
const INK = 'var(--z-ink)'
const SYSTEM_RED = 'var(--z-error-red)'
const USER_BLUE = 'var(--z-highlight-blue)'

type RowSpec = { label: string; value: string; color?: string }

function StatRows({ rows }: { rows: RowSpec[] }): React.JSX.Element {
  return (
    <div style={statRows}>
      {rows.map((r) => (
        <div key={r.label} style={statRow}>
          <span style={statLabel}>{r.label}</span>
          <span style={{ ...statValue, color: r.color ?? INK }}>{r.value}</span>
        </div>
      ))}
    </div>
  )
}

function Sparkline({
  values,
  color,
  max,
  fill = false
}: {
  values: number[]
  color: string
  max: number
  fill?: boolean
}): React.JSX.Element {
  const points = polyPoints(values, GRAPH_W, GRAPH_H, max)
  return (
    <svg
      viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: GRAPH_H, display: 'block' }}
    >
      {fill && points !== '' ? (
        <polygon
          points={`${points} 2,${GRAPH_H - 2} 238,${GRAPH_H - 2}`}
          fill={color}
          opacity={0.14}
        />
      ) : null}
      {points !== '' ? (
        <polyline points={points} fill="none" stroke={color} strokeWidth={2} />
      ) : null}
    </svg>
  )
}

function Panel({
  title,
  legend,
  left,
  center,
  right
}: {
  title: string
  legend: Array<{ label: string; color: string }> | null
  left: React.JSX.Element
  center: React.JSX.Element
  right: React.JSX.Element
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
      <div style={panelBody}>
        {left}
        {center}
        {right}
      </div>
    </section>
  )
}

const TELEMETRY_INTERVAL_MS = 2_000

function CpuPanel({
  sample,
  history
}: {
  sample: MachineSample
  history: TelemetryHistory
}): React.JSX.Element {
  const c = sample.cpu
  const pct = (v: number | null): string => (v === null ? '—' : `${v.toFixed(1)}%`)
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
            { label: 'SYSTEM', value: pct(c?.system ?? null), color: SYSTEM_RED },
            { label: 'USER', value: pct(c?.user ?? null), color: USER_BLUE },
            { label: 'IDLE', value: pct(c?.idle ?? null) }
          ]}
        />
      }
      center={
        <div style={graphBox}>
          <span style={graphTitle}>CPU HISTORY</span>
          <Sparkline values={history.cpuSystem} color={SYSTEM_RED} max={100} />
          <Sparkline values={history.cpuUser} color={USER_BLUE} max={100} />
          <span style={graphCaption}>scale 0–100 · 60-point window</span>
        </div>
      }
      right={
        <StatRows
          rows={[
            { label: 'THREADS', value: c?.threads == null ? '—' : group(c.threads) },
            { label: 'PROCESSES', value: c?.processes == null ? '—' : group(c.processes) }
          ]}
        />
      }
    />
  )
}

function MemoryPanel({
  sample,
  history
}: {
  sample: MachineSample
  history: TelemetryHistory
}): React.JSX.Element {
  const m = sample.memory
  const gb = (v: number | null | undefined): string =>
    typeof v === 'number' && Number.isFinite(v) ? formatGib(v) : '—'
  const level = m?.level ?? 'low'
  // Color-by-level: the kernel pressure level picks the tone, and the tone
  // picks the token color for the graph, its legend chip, and the caption word.
  const pressureColor = TONE_COLOR[pressureTone(level)]
  return (
    <Panel
      title="MEMORY PRESSURE"
      legend={[{ label: 'PRESSURE', color: pressureColor }]}
      left={
        <div style={graphBox}>
          <span style={graphTitle}>PRESSURE</span>
          <Sparkline values={history.pressure} color={pressureColor} max={100} fill />
          <span style={graphCaption}>
            {`${m?.pressure == null ? '—' : m.pressure.toFixed(1)} · `}
            <span style={{ color: pressureColor }}>{level}</span>
          </span>
        </div>
      }
      center={
        <StatRows
          rows={[
            { label: 'PHYSICAL MEMORY', value: gb(m?.total) },
            { label: 'MEMORY USED', value: gb(m?.used) },
            { label: 'CACHED FILES', value: gb(m?.cachedFiles) },
            { label: 'SWAP USED', value: gb(m?.swapUsed) }
          ]}
        />
      }
      right={
        <StatRows
          rows={[
            { label: 'APP MEMORY', value: gb(m?.app) },
            { label: 'WIRED MEMORY', value: gb(m?.wired) },
            { label: 'COMPRESSED', value: gb(m?.compressed) }
          ]}
        />
      }
    />
  )
}

function IoPanel({
  sample,
  history
}: {
  sample: MachineSample
  history: TelemetryHistory
}): React.JSX.Element {
  const io = sample.io
  const ops = (v: number | null | undefined): string =>
    typeof v === 'number' && Number.isFinite(v) ? group(v) : '—'
  const bytes = (v: number | null | undefined): string =>
    typeof v === 'number' && Number.isFinite(v) ? formatBytes(v) : '—'
  const peak = Math.max(1, windowMax(history.ioRead), windowMax(history.ioWrite))
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
            { label: 'READS IN', value: ops(io?.reads) },
            { label: 'WRITES OUT', value: ops(io?.writes) },
            { label: 'READS IN/SEC', value: ops(io?.readsPerSec) },
            { label: 'WRITES OUT/SEC', value: ops(io?.writesPerSec) }
          ]}
        />
      }
      center={
        <div style={graphBox}>
          <span style={graphTitle}>I/O HISTORY</span>
          <Sparkline values={history.ioRead} color={USER_BLUE} max={peak} />
          <Sparkline values={history.ioWrite} color={SYSTEM_RED} max={peak} />
          <span style={graphCaption}>{`peak ${formatBytesPerSec(peak)} · autoscaled`}</span>
        </div>
      }
      right={
        <StatRows
          rows={[
            { label: 'DATA READ', value: bytes(io?.dataRead) },
            { label: 'DATA WRITTEN', value: bytes(io?.dataWritten) },
            { label: 'DATA READ/SEC', value: bytes(io?.dataReadPerSec) },
            { label: 'DATA WRITTEN/SEC', value: bytes(io?.dataWrittenPerSec) }
          ]}
        />
      }
    />
  )
}

function NetPanel({
  sample,
  history
}: {
  sample: MachineSample
  history: TelemetryHistory
}): React.JSX.Element {
  const net = sample.net
  const count = (v: number | null | undefined): string =>
    typeof v === 'number' && Number.isFinite(v) ? group(v) : '—'
  const bytes = (v: number | null | undefined): string =>
    typeof v === 'number' && Number.isFinite(v) ? formatBytes(v) : '—'
  const peak = Math.max(1, windowMax(history.netIn), windowMax(history.netOut))
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
            { label: 'PACKETS IN', value: count(net?.packetsIn) },
            { label: 'PACKETS OUT', value: count(net?.packetsOut) },
            { label: 'PACKETS IN/SEC', value: count(net?.packetsInPerSec) },
            { label: 'PACKETS OUT/SEC', value: count(net?.packetsOutPerSec) }
          ]}
        />
      }
      center={
        <div style={graphBox}>
          <span style={graphTitle}>PACKETS HISTORY</span>
          <Sparkline values={history.netIn} color={USER_BLUE} max={peak} />
          <Sparkline values={history.netOut} color={SYSTEM_RED} max={peak} />
          <span style={graphCaption}>{`peak ${group(Math.round(peak))} pk/s · autoscaled`}</span>
        </div>
      }
      right={
        <StatRows
          rows={[
            { label: 'DATA RECEIVED', value: bytes(net?.dataReceived) },
            { label: 'DATA SENT', value: bytes(net?.dataSent) },
            { label: 'DATA RECEIVED/SEC', value: bytes(net?.dataReceivedPerSec) },
            { label: 'DATA SENT/SEC', value: bytes(net?.dataSentPerSec) }
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
  const hasBridge = typeof window !== 'undefined' && window.zero !== undefined

  useEffect(() => {
    if (!hasBridge) return
    let active = true
    const pull = (): void => {
      // Telemetry is local machine data, not daemon-derived: it never gates on
      // the runtime connection state, but it must not run while hidden so the
      // Task 18 idle-CPU work stays intact.
      if (document.visibilityState !== 'visible') return
      window.zero
        .invoke('telemetry.sample')
        .then((raw) => {
          if (!active) return
          const parsed = parseTelemetry(raw)
          setSample(parsed)
          setHistory((h) => accumulateHistory(h, parsed))
        })
        .catch(() => {
          // Honest cached semantics: keep the last sample on errors.
        })
    }
    pull()
    const id = window.setInterval(pull, TELEMETRY_INTERVAL_MS)
    window.addEventListener('focus', pull)
    return () => {
      active = false
      window.clearInterval(id)
      window.removeEventListener('focus', pull)
    }
  }, [hasBridge])

  const gpuRow =
    sample.gpu === null ? 'GPU —' : `GPU ${sample.gpu.toFixed(1)}% (ioreg Device Utilization)`

  return (
    <div className="zw-route" style={routeStyle}>
      <div style={headerRow}>
        <span style={microStyle}>RUNTIME — MACHINE TELEMETRY</span>
        <Chip label={sessionState ?? 'UNAVAILABLE'} tone={sessionChipTone(conn, sessionState)} />
      </div>
      <span style={projectStyle}>{activeProjectLabel(conn, project)}</span>
      <CpuPanel sample={sample} history={history} />
      <MemoryPanel sample={sample} history={history} />
      <IoPanel sample={sample} history={history} />
      <NetPanel sample={sample} history={history} />
      <span style={noticeStyle}>
        Local machine telemetry via the main-process sampler · one batched read at most 1 Hz (ps,
        vm_stat, sysctl, netstat, ioreg) · rates are deltas between samples · {gpuRow}
      </span>
    </div>
  )
})
