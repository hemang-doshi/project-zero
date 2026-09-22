import { memo, useCallback, useEffect, useState } from 'react'
import { ZERO_TYPE } from '../../../shared/tokens'
import { type OpName } from '../../../shared/ipc'
import { Chip } from './Chip'
import { SkillLabScene } from './SkillLabScene'
import type { PluginGroup, SkillSummary } from './skillPlugins'
import {
  SKILL_FIXTURES,
  SKILL_INJECTION_CONTRACT,
  skillSummary,
  type SkillFixture
} from './runtime.types'

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

const headingStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 800,
  color: 'var(--z-ink)',
  lineHeight: 1.25
}

const summaryStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: 'var(--z-secondary-ink)',
  lineHeight: 1.5,
  margin: 0
}

const noticeStyle: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10.5,
  color: 'var(--z-secondary-ink)',
  lineHeight: 1.6,
  margin: 0
}

const errorNotice: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10.5,
  color: 'var(--z-error-red)',
  lineHeight: 1.6,
  margin: 0
}

const refreshStyle: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.1em',
  color: 'var(--z-ink)',
  background: 'transparent',
  border: '1px solid var(--z-line)',
  borderRadius: 5,
  padding: '4px 10px',
  cursor: 'pointer'
}

const cardStyle: React.CSSProperties = {
  background: 'var(--z-card-cream)',
  border: '1px solid var(--z-line)',
  borderRadius: 8,
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  minWidth: 0
}

const skillName: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--z-ink)'
}

const skillDetail: React.CSSProperties = {
  fontFamily: ZERO_TYPE.mono,
  fontSize: 10.5,
  color: 'var(--z-secondary-ink)',
  lineHeight: 1.6,
  margin: 0
}

// Live plugin discovery rides the skills.discover IPC op (Task 37D): the main
// process scans the real skill roots through lane B's pure layer and this
// route feeds groups + selfLearnt into the scene props. Failures and empty
// scans keep the honest-empty states — the scene itself renders fully from
// props either way. DesktopCanvas mounts this route only for open,
// unminimized windows, so the mount effect fires exactly when the route is
// open and visible.
const SKILLS_DISCOVER_OP: OpName = 'skills.discover'

type SkillDiscovery = { groups: PluginGroup[]; selfLearnt: SkillSummary[] }

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

const asTrimmedString = (v: unknown): string | null =>
  typeof v === 'string' && v.trim().length > 0 ? v.trim() : null

const parseSkillSummary = (v: unknown): SkillSummary | null => {
  if (!isRecord(v)) return null
  const id = asTrimmedString(v.id)
  const name = asTrimmedString(v.name)
  if (id === null || name === null) return null
  if (v.source !== 'installed' && v.source !== 'self-learnt') return null
  const pluginId =
    v.pluginId === null || v.pluginId === undefined ? null : asTrimmedString(v.pluginId)
  const description = asTrimmedString(v.description)
  const icon = asTrimmedString(v.icon)
  return {
    id,
    name,
    source: v.source,
    pluginId,
    ...(description !== null ? { description } : {}),
    ...(icon !== null ? { icon } : {})
  }
}

const GLYPHS = ['flask', 'masks', 'stack', 'bolt', 'orb'] as const

const parsePluginGroup = (v: unknown): PluginGroup | null => {
  if (!isRecord(v)) return null
  const id = asTrimmedString(v.id)
  const name = asTrimmedString(v.name)
  const color = asTrimmedString(v.color)
  if (id === null || name === null || color === null) return null
  if (!GLYPHS.includes(v.glyph as (typeof GLYPHS)[number])) return null
  if (!Array.isArray(v.skills)) return null
  const skills: SkillSummary[] = []
  for (const s of v.skills) {
    const parsed = parseSkillSummary(s)
    if (parsed !== null) skills.push(parsed)
  }
  return { id, name, color, glyph: v.glyph as (typeof GLYPHS)[number], skills }
}

const parseDiscovery = (raw: unknown): SkillDiscovery | null => {
  if (!isRecord(raw)) return null
  if (!Array.isArray(raw.groups) && !Array.isArray(raw.selfLearnt)) return null
  const groups: PluginGroup[] = []
  if (Array.isArray(raw.groups)) {
    for (const g of raw.groups) {
      const parsed = parsePluginGroup(g)
      if (parsed !== null) groups.push(parsed)
    }
  }
  const selfLearnt: SkillSummary[] = []
  if (Array.isArray(raw.selfLearnt)) {
    for (const s of raw.selfLearnt) {
      const parsed = parseSkillSummary(s)
      if (parsed !== null) selfLearnt.push(parsed)
    }
  }
  return { groups, selfLearnt }
}

const parseNote = (raw: unknown): string | null => {
  if (!isRecord(raw)) return null
  return asTrimmedString(raw.note)
}

const initialChipStyle: React.CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: 10,
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: ZERO_TYPE.mono,
  fontSize: 11,
  fontWeight: 700,
  color: '#FFFFFF',
  background: 'var(--z-secondary-ink)'
}

function SelfLearntRow({ skill }: { skill: SkillSummary }): React.JSX.Element {
  const initial = skill.name.trim().charAt(0).toUpperCase() || '?'
  return (
    <div data-testid={`selflearn-row-${skill.id}`} style={{ ...cardStyle, padding: '9px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span title={skill.icon ?? 'initial'} style={initialChipStyle}>
          {initial}
        </span>
        <span style={skillName}>{skill.name}</span>
        <Chip label={skill.source.toUpperCase()} tone="neutral" />
      </div>
      <span style={skillDetail}>
        {skill.description?.trim() ? skill.description : 'No description.'}
      </span>
    </div>
  )
}

function SkillRow({ skill }: { skill: SkillFixture }): React.JSX.Element {
  return (
    <div style={{ ...cardStyle, padding: '9px 12px' }}>
      <div style={headerRow}>
        <span style={skillName}>{skill.name}</span>
        <Chip
          label={skill.isUsable ? skill.source.toUpperCase() : 'UNUSABLE'}
          tone={skill.isUsable ? 'neutral' : 'error'}
        />
      </div>
      {skill.isUsable ? (
        <span style={skillDetail}>{skillSummary(skill)}</span>
      ) : (
        <span style={errorNotice}>{skill.rejectionReason ?? 'Unusable skill.'}</span>
      )}
      <span style={skillDetail}>{skill.enabled ? 'ENABLED' : 'DISABLED'}</span>
    </div>
  )
}

export const SkillLabRoute = memo(function SkillLabRoute(): React.JSX.Element {
  const enabled = SKILL_FIXTURES.filter((s) => s.enabled && s.isUsable).length
  const hasBridge = typeof window !== 'undefined' && window.zero !== undefined
  const [groups, setGroups] = useState<PluginGroup[]>([])
  const [selfLearnt, setSelfLearnt] = useState<SkillSummary[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // Applies one discovery result; state sets ride promise callbacks (never
  // synchronous effect bodies) per the hooks lint.
  const applyDiscovery = useCallback((raw: unknown): void => {
    const parsed = parseDiscovery(raw)
    if (parsed !== null) {
      setGroups(parsed.groups)
      setSelfLearnt(parsed.selfLearnt)
    }
    setNote(parseNote(raw))
  }, [])

  useEffect(() => {
    if (!hasBridge) return
    let active = true
    window.zero.invoke(SKILLS_DISCOVER_OP, { refresh: false }).then(
      (raw) => {
        if (active) applyDiscovery(raw)
      },
      () => {
        // Honest-empty: keep the empty grid and the empty self-learnt rows.
      }
    )
    return () => {
      active = false
    }
  }, [hasBridge, applyDiscovery])

  const onRefresh = (): void => {
    if (!hasBridge || refreshing) return
    setRefreshing(true)
    window.zero.invoke(SKILLS_DISCOVER_OP, { refresh: true }).then(
      (raw) => {
        applyDiscovery(raw)
        setRefreshing(false)
      },
      () => {
        // Keep the last good grid on a failed rescan, release the button.
        setRefreshing(false)
      }
    )
  }

  return (
    <div className="zw-route" style={routeStyle}>
      <div style={headerRow}>
        <span style={microStyle}>PROJECT ZERO — SKILL LAB</span>
        <Chip label="READ-ONLY" tone="neutral" />
      </div>
      <div>
        <span style={headingStyle}>Skill Lab: Shared Provider Skills</span>
        <p style={summaryStyle}>
          Zero-owned skills from the owner-controlled skills directory. Skills enabled once apply to
          both providers’ future sessions. Nothing here executes skill code.
        </p>
      </div>
      <div style={headerRow}>
        <Chip label="SHARED BY BOTH PROVIDERS" tone="neutral" />
        <Chip label={`${enabled} ENABLED`} tone={enabled === 0 ? 'neutral' : 'healthy'} />
      </div>
      <div style={headerRow}>
        <span style={microStyle}>SELF-LEARNING</span>
        <Chip label={`${selfLearnt.length} SELF-LEARNT`} tone="neutral" />
      </div>
      {selfLearnt.length > 0 ? (
        selfLearnt.map((s) => <SelfLearntRow key={s.id} skill={s} />)
      ) : (
        <span style={noticeStyle}>No self-learnt skills yet.</span>
      )}
      <div style={headerRow}>
        <span style={microStyle}>INSTALLED BY PLUGIN</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Chip
            label={`${groups.length} PLUGINS`}
            tone={groups.length === 0 ? 'neutral' : 'healthy'}
          />
          <button
            type="button"
            data-testid="skills-refresh"
            style={{ ...refreshStyle, opacity: !hasBridge || refreshing ? 0.5 : 1 }}
            disabled={!hasBridge || refreshing}
            onClick={onRefresh}
          >
            {refreshing ? 'REFRESHING…' : 'REFRESH'}
          </button>
        </span>
      </div>
      <SkillLabScene groups={groups} selfLearnt={selfLearnt} />
      {note !== null ? (
        <span data-testid="skills-note" style={noticeStyle}>
          {note}
        </span>
      ) : null}
      <div style={headerRow}>
        <span style={microStyle}>ALL SKILLS (SHARED FIXTURES)</span>
      </div>
      {SKILL_FIXTURES.map((s) => (
        <SkillRow key={s.id} skill={s} />
      ))}
      <div style={cardStyle}>
        <span style={noticeStyle}>INJECTION CONTRACT — SHOWN BEFORE USE</span>
        <span style={noticeStyle}>{SKILL_INJECTION_CONTRACT}</span>
      </div>
      <span style={noticeStyle}>
        Fixture data in this build: the daemon exposes no skill store and the sandboxed renderer has
        no filesystem op, so the list above stays fixture data while the live grid is scanned by the
        main process.
      </span>
    </div>
  )
})
