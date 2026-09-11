import { ZERO_TYPE } from '../../../shared/tokens'
import { DUMMY_NOTICE, type DesktopFile } from './items'

const wrapStyle: React.CSSProperties = {
  height: '100%',
  overflowY: 'auto',
  padding: '16px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  background: 'var(--z-card-cream)'
}

const noticeStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  fontFamily: ZERO_TYPE.mono,
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: '0.12em',
  color: 'var(--z-secondary-ink)',
  border: '1px solid var(--z-line)',
  borderRadius: 999,
  padding: '3px 10px'
}

const bodyStyle: React.CSSProperties = {
  whiteSpace: 'pre-wrap',
  fontSize: 13,
  lineHeight: 1.55,
  color: 'var(--z-ink)'
}

const paragraphStyle: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.55,
  color: 'var(--z-ink)'
}

const listItemStyle: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.55,
  color: 'var(--z-ink)'
}

const mockBandStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  fontFamily: ZERO_TYPE.mono,
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: '0.14em',
  color: 'var(--z-secondary-ink)',
  border: '1px dashed var(--z-line)',
  borderRadius: 6,
  padding: '3px 10px'
}

const placeholderCardStyle: React.CSSProperties = {
  height: 180,
  borderRadius: 10,
  border: '1px dashed var(--z-line)',
  background: 'var(--z-canvas-tan)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: ZERO_TYPE.mono,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.14em',
  color: 'var(--z-secondary-ink)'
}

function pdfParagraphs(content: string): string[] {
  return content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
}

function notesLines(content: string): string[] {
  return content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

function fileBody(file: DesktopFile): React.JSX.Element {
  switch (file.ext) {
    case 'txt':
      return <div style={bodyStyle}>{file.content}</div>
    case 'notes':
      return (
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {notesLines(file.content).map((line) => (
            <li key={line} style={listItemStyle}>
              {line}
            </li>
          ))}
        </ul>
      )
    case 'pdf':
      return (
        <>
          <span style={mockBandStyle}>PDF MOCK</span>
          {pdfParagraphs(file.content).map((p) => (
            <p key={p.slice(0, 40)} style={{ ...paragraphStyle, margin: 0 }}>
              {p}
            </p>
          ))}
        </>
      )
    case 'png':
      return (
        <>
          <div style={placeholderCardStyle}>SCREENSHOT PLACEHOLDER</div>
          <div style={paragraphStyle}>{file.content}</div>
        </>
      )
  }
}

export function DummyFileViewer({ file }: { file: DesktopFile }): React.JSX.Element {
  return (
    <div style={wrapStyle}>
      <span style={noticeStyle}>{DUMMY_NOTICE}</span>
      {fileBody(file)}
    </div>
  )
}
