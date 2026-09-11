import { memo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ZERO_TYPE } from '../../../shared/tokens'
import { threadTimestamp, threadTitle, type ChatItem, type ThreadRow } from './chat.model'

export type ThinkingItem = Extract<ChatItem, { kind: 'thinking' }>
type ExecItem = Extract<ChatItem, { kind: 'exec' }>
type ToolItem = Extract<ChatItem, { kind: 'tool' }>
type NoticeItem = Extract<ChatItem, { kind: 'notice' }>

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
    <div style={markdownBody}>
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
  const summary = item.summary !== '' ? item.summary : 'no summary available'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          ...micro,
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
  const exitLabel =
    item.exitCode === null
      ? item.status === ''
        ? 'RUNNING'
        : item.status.toUpperCase()
      : `EXIT ${item.exitCode}`
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
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 }}>
        <span style={{ ...micro, color: 'var(--z-secondary-ink)' }}>EXEC</span>
        <span style={{ ...execShell, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', flex: 1 }}>
          {item.command}
        </span>
        <span style={{ ...micro, color: exitTone(item.exitCode, item.status) }}>{exitLabel}</span>
      </div>
      {item.cwd !== '' ? <span style={{ ...micro, opacity: 0.8 }}>CWD {item.cwd}</span> : null}
      {item.output !== null && item.output !== '' ? (
        <div
          style={{
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
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 }}>
        <span style={{ ...micro, color: 'var(--z-secondary-ink)' }}>TOOL</span>
        <span style={{ fontFamily: ZERO_TYPE.mono, fontSize: 11, color: 'var(--z-ink)' }}>
          {item.tool}
          {item.server !== null ? ` · ${item.server}` : ''}
        </span>
        <span style={{ ...micro, color: statusColor(item.status) }}>
          {item.status !== '' ? item.status.toUpperCase() : '—'}
        </span>
      </div>
      {item.detail !== '' ? (
        <span
          style={{
            fontFamily: ZERO_TYPE.mono,
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
          style={{
            fontFamily: ZERO_TYPE.mono,
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
    </div>
  )
})

const NoticeRow = memo(function NoticeRow({ item }: { item: NoticeItem }): React.JSX.Element {
  return (
    <span style={{ ...micro, color: 'var(--z-secondary-ink)' }}>PROTOCOL ITEM · {item.text}</span>
  )
})

const userBubble: React.CSSProperties = {
  alignSelf: 'flex-end',
  maxWidth: '88%',
  background: 'var(--z-card-cream)',
  border: '1px solid var(--z-orange)',
  borderRadius: '10px 10px 3px 10px',
  padding: '8px 12px',
  minWidth: 0
}

const assistantBubble: React.CSSProperties = {
  alignSelf: 'flex-start',
  maxWidth: '92%',
  background: 'var(--z-card-white)',
  border: '1px solid var(--z-line)',
  borderRadius: '10px 10px 10px 3px',
  padding: '8px 12px',
  minWidth: 0
}

const rowLabel: React.CSSProperties = {
  ...micro,
  color: 'var(--z-secondary-ink)'
}

export const ChatRow = memo(function ChatRow({ item }: { item: ChatItem }): React.JSX.Element {
  switch (item.kind) {
    case 'message':
      return (
        <div style={item.role === 'user' ? userBubble : assistantBubble}>
          <span style={{ ...micro, color: 'var(--z-secondary-ink)' }}>
            {item.role === 'user' ? 'OPERATOR' : 'ZERO BOT'}
          </span>
          <MarkdownText text={item.text} />
        </div>
      )
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
            <span style={rowLabel}>
              {threadTime(row)}
              {row.model !== null ? ` · ${row.model}` : ''}
            </span>
          </button>
        )
      })}
    </div>
  )
})
