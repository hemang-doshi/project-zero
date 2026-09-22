import { memo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ZERO_TYPE } from '../../../shared/tokens'
import { threadTimestamp, threadTitle, type ChatItem, type ThreadRow } from './chat.model'
import { formatViaAttribution, summarizeExecItem, summarizeToolItem } from './zeroBot.presentation'
import type { Harness } from './runtime.types'

export type ThinkingItem = Extract<ChatItem, { kind: 'thinking' }>
type ExecItem = Extract<ChatItem, { kind: 'exec' }>
type ToolItem = Extract<ChatItem, { kind: 'tool' }>
type NoticeItem = Extract<ChatItem, { kind: 'notice' }>

// Typographic voices (spec §§6-7, contract TYPOGRAPHY): human UI text speaks
// in the system sans stack; machine metadata (ids, timestamps, model ids,
// commands) speaks mono. The data-voice attributes pin the contract in tests.
const humanVoice: React.CSSProperties = {
  fontFamily: ZERO_TYPE.body
}

const machineVoice: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono
}

const micro: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 8.5,
  fontWeight: 700,
  letterSpacing: '0.12em',
  color: 'var(--z-secondary-ink)'
}

const markdownBody: React.CSSProperties = {
  fontFamily: ZERO_TYPE.body,
  fontSize: 12,
  lineHeight: 1.55,
  color: 'var(--z-ink)',
  overflowWrap: 'anywhere',
  minWidth: 0
}

export const MarkdownText = memo(function MarkdownText({
  text
}: {
  text: string
}): React.JSX.Element {
  return (
    <div data-voice="human" style={markdownBody}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
})

export const ThinkingBlock = memo(function ThinkingBlock({
  item
}: {
  item: ThinkingItem
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const summary =
    item.summary !== ''
      ? item.summary
      : item.text !== ''
        ? 'details available'
        : 'reasoning unavailable from provider'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-voice="human"
        style={{
          ...humanVoice,
          fontSize: 11.5,
          fontWeight: 700,
          background: 'transparent',
          border: '1px solid color-mix(in srgb, var(--z-line) 80%, transparent)',
          borderRadius: 6,
          padding: '4px 10px',
          cursor: 'pointer',
          textAlign: 'left',
          color: 'var(--z-secondary-ink)',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {open ? '▾' : '▸'} Thinking… {summary}
      </button>
      {open ? (
        <div
          data-voice="machine"
          style={{
            fontFamily: ZERO_TYPE.mono,
            fontSize: 10.5,
            lineHeight: 1.5,
            color: 'var(--z-secondary-ink)',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            maxHeight: 220,
            overflowY: 'auto'
          }}
        >
          {item.text !== '' ? item.text : '—'}
        </div>
      ) : null}
    </div>
  )
})

const execShell: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 11,
  color: 'var(--z-ink)',
  minWidth: 0
}

const exitTone = (exitCode: number | null, status: string): string => {
  if (exitCode !== null && exitCode !== 0) return 'var(--z-error-red)'
  if (status === 'failed') return 'var(--z-error-red)'
  if (status === 'declined') return 'var(--z-marker-yellow)'
  return 'var(--z-status-green)'
}

export const ExecBlock = memo(function ExecBlock({ item }: { item: ExecItem }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const exitLabel =
    item.exitCode === null
      ? item.status === ''
        ? 'RUNNING'
        : item.status.toUpperCase()
      : `EXIT ${item.exitCode}`
  const summary = summarizeExecItem(item)
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        border: '1px solid var(--z-line)',
        borderRadius: 8,
        padding: '8px 10px',
        background: 'var(--z-card-white)',
        minWidth: 0
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'baseline',
          minWidth: 0,
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textAlign: 'left'
        }}
      >
        <span style={{ ...micro, color: 'var(--z-secondary-ink)' }}>{open ? '▾' : '▸'}</span>
        <span
          data-voice="human"
          style={{ ...humanVoice, fontSize: 12, color: 'var(--z-ink)', flex: 1 }}
        >
          {summary}
        </span>
        <span
          data-voice="machine"
          style={{ ...machineVoice, ...micro, color: exitTone(item.exitCode, item.status) }}
        >
          {exitLabel}
        </span>
      </button>
      {open ? (
        <>
          <span
            data-voice="machine"
            style={{
              ...machineVoice,
              ...execShell,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere'
            }}
          >
            {item.command}
          </span>
          {item.cwd !== '' ? (
            <span data-voice="machine" style={{ ...machineVoice, ...micro, opacity: 0.8 }}>
              CWD {item.cwd}
            </span>
          ) : null}
          {item.output !== null && item.output !== '' ? (
            <div
              data-voice="machine"
              style={{
                ...machineVoice,
                ...execShell,
                background: 'color-mix(in srgb, var(--z-canvas-tan) 55%, transparent)',
                borderRadius: 6,
                padding: '6px 8px',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                maxHeight: 180,
                overflowY: 'auto'
              }}
            >
              {item.output}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
})

const statusColor = (status: string): string => {
  switch (status) {
    case 'completed':
      return 'var(--z-status-green)'
    case 'failed':
    case 'declined':
      return 'var(--z-error-red)'
    case 'inProgress':
      return 'var(--z-marker-yellow)'
    default:
      return 'var(--z-secondary-ink)'
  }
}

export const ToolBlock = memo(function ToolBlock({ item }: { item: ToolItem }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const summary = summarizeToolItem(item)
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        border: '1px dashed var(--z-line)',
        borderRadius: 8,
        padding: '8px 10px',
        background: 'color-mix(in srgb, var(--z-card-cream) 70%, transparent)',
        minWidth: 0
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'baseline',
          minWidth: 0,
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textAlign: 'left'
        }}
      >
        <span style={{ ...micro, color: 'var(--z-secondary-ink)' }}>{open ? '▾' : '▸'}</span>
        <span
          data-voice="human"
          style={{ ...humanVoice, fontSize: 12, color: 'var(--z-ink)', flex: 1 }}
        >
          {summary}
        </span>
        <span
          data-voice="machine"
          style={{ ...machineVoice, ...micro, color: statusColor(item.status) }}
        >
          {item.status !== '' ? item.status.toUpperCase() : '—'}
        </span>
      </button>
      {open ? (
        <>
          <span
            data-voice="machine"
            style={{ ...machineVoice, fontSize: 11, color: 'var(--z-secondary-ink)' }}
          >
            {item.tool}
            {item.server !== null ? ` · ${item.server}` : ''}
          </span>
          {item.detail !== '' ? (
            <span
              data-voice="machine"
              style={{
                ...machineVoice,
                fontSize: 10,
                color: 'var(--z-secondary-ink)',
                overflowWrap: 'anywhere',
                wordBreak: 'break-all'
              }}
            >
              {item.detail.length > 300 ? `${item.detail.slice(0, 300)}…` : item.detail}
            </span>
          ) : null}
          {item.result !== null && item.result !== '' ? (
            <div
              data-voice="machine"
              style={{
                ...machineVoice,
                fontSize: 10,
                color: 'var(--z-ink)',
                background: 'color-mix(in srgb, var(--z-canvas-tan) 55%, transparent)',
                borderRadius: 6,
                padding: '6px 8px',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                maxHeight: 140,
                overflowY: 'auto'
              }}
            >
              {item.result.length > 800 ? `${item.result.slice(0, 800)}…` : item.result}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
})

const NoticeRow = memo(function NoticeRow({ item }: { item: NoticeItem }): React.JSX.Element {
  return (
    <span data-voice="machine" style={{ ...micro, color: 'var(--z-secondary-ink)' }}>
      PROTOCOL ITEM · {item.text}
    </span>
  )
})

const userBubble: React.CSSProperties = {
  alignSelf: 'flex-end',
  maxWidth: '88%',
  background: 'var(--z-card-cream)',
  border: '1px solid var(--z-orange)',
  borderRadius: '10px 10px 3px 10px',
  padding: '8px 12px',
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 4
}

const assistantBubble: React.CSSProperties = {
  alignSelf: 'flex-start',
  maxWidth: '92%',
  background: 'var(--z-card-white)',
  border: '1px solid var(--z-line)',
  borderRadius: '10px 10px 10px 3px',
  padding: '8px 12px',
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 4
}

const rowLabel: React.CSSProperties = {
  ...micro,
  color: 'var(--z-secondary-ink)'
}

export const ChatRow = memo(function ChatRow({
  item,
  harness = 'codex',
  model = null
}: {
  item: ChatItem
  harness?: Harness
  model?: string | null
}): React.JSX.Element {
  switch (item.kind) {
    case 'message': {
      // Zero authors every assistant turn; the executing provider/model is
      // muted verbatim attribution (spec §27). The author name speaks in the
      // human voice, the via line in the machine voice (spec §§6-7).
      const attribution = item.role === 'assistant' ? formatViaAttribution(harness, model) : null
      return (
        <div style={item.role === 'user' ? userBubble : assistantBubble}>
          <span
            data-voice="human"
            style={{ ...humanVoice, fontSize: 12, fontWeight: 700, color: 'var(--z-ink)' }}
          >
            {item.role === 'user' ? 'You' : (attribution?.author ?? 'Zero')}
          </span>
          {attribution?.via != null ? (
            <span
              data-voice="machine"
              style={{ ...machineVoice, ...micro, color: 'var(--z-secondary-ink)' }}
            >
              {attribution.via}
            </span>
          ) : null}
          <MarkdownText text={item.text} />
        </div>
      )
    }
    case 'thinking':
      return <ThinkingBlock item={item} />
    case 'exec':
      return <ExecBlock item={item} />
    case 'tool':
      return <ToolBlock item={item} />
    case 'notice':
      return <NoticeRow item={item} />
  }
})

const threadTime = (row: ThreadRow): string => {
  const ts = threadTimestamp(row)
  if (ts <= 0) return '—'
  const d = new Date(ts * 1000)
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 16).replace('T', ' ')
}

export const ThreadList = memo(function ThreadList({
  rows,
  selectedId,
  onSelect
}: {
  rows: ThreadRow[]
  selectedId: string | null
  onSelect: (id: string) => void
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      {rows.map((row) => {
        const selected = row.id === selectedId
        return (
          <button
            key={row.id}
            type="button"
            onClick={() => onSelect(row.id)}
            aria-pressed={selected}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              textAlign: 'left',
              padding: '7px 10px',
              borderRadius: 8,
              border: `1px solid ${selected ? 'var(--z-orange)' : 'var(--z-line)'}`,
              background: selected
                ? 'color-mix(in srgb, var(--z-hover-orange) 12%, var(--z-card-white))'
                : 'transparent',
              cursor: 'pointer',
              minWidth: 0
            }}
          >
            <span
              data-voice="human"
              style={{
                fontFamily: ZERO_TYPE.body,
                fontSize: 11.5,
                fontWeight: selected ? 700 : 400,
                color: 'var(--z-ink)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {threadTitle(row)}
            </span>
            <span data-voice="machine" style={rowLabel}>
              {threadTime(row)}
              {row.model !== null ? ` · ${row.model}` : ''}
            </span>
          </button>
        )
      })}
    </div>
  )
})
