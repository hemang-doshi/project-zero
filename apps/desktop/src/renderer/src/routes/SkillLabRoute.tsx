import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ZERO_TYPE } from '../../../shared/tokens'
import { type OpName } from '../../../shared/ipc'
import { Chip } from './Chip'
import type { PluginGroup, SkillSummary } from './skillPlugins'
import { localSkillRows, searchSkillRows, skillWindow, skillIcon } from './skillWall'

const routeStyle: React.CSSProperties = {
  height: '100%',
  overflowY: 'auto',
  minWidth: 0,
  containerType: 'inline-size',
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
  flexWrap: 'wrap',
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

const skillName: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--z-ink)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0
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
type CatalogSkill = { id: string; source: string; skill: string; url: string; installs: string }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

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

export const SkillLabRoute = memo(function SkillLabRoute(): React.JSX.Element {
  const routeRef = useRef<HTMLDivElement>(null)
  const detailsRef = useRef<HTMLElement>(null)
  const hasBridge = typeof window !== 'undefined' && window.zero !== undefined
  const [groups, setGroups] = useState<PluginGroup[]>([])
  const [selfLearnt, setSelfLearnt] = useState<SkillSummary[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'All' | 'Installed' | 'Self-learnt'>('All')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [catalog, setCatalog] = useState<CatalogSkill[]>([])
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [catalogSelection, setCatalogSelection] = useState<CatalogSkill | null>(null)
  const rows = useMemo(() => localSkillRows(groups, selfLearnt), [groups, selfLearnt])
  const filtered = useMemo(
    () =>
      searchSkillRows(rows, query).filter(
        (row) =>
          filter === 'All' ||
          (filter === 'Installed'
            ? row.skill.source === 'installed'
            : row.skill.source === 'self-learnt')
      ),
    [rows, query, filter]
  )
  const selected = rows.find((row) => row.key === selectedKey) ?? null
  const { start, end } = skillWindow(filtered.length, scrollTop, 420)
  const chooseSkill = (key: string): void => {
    setSelectedKey(key)
    if ((routeRef.current?.clientWidth ?? 0) < 600) {
      detailsRef.current?.scrollIntoView({ block: 'nearest' })
    }
  }

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

  useEffect(() => {
    if (!hasBridge || query.trim().length < 2) return
    let active = true
    const timer = window.setTimeout(() => {
      void window.zero
        .invoke('skills.search', { query: query.trim() })
        .then((value) => {
          if (!active) return
          setCatalog(Array.isArray(value) ? (value as CatalogSkill[]) : [])
          setCatalogError(null)
        })
        .catch(() => {
          if (active) {
            setCatalog([])
            setCatalogError('Catalog unavailable; local search still works.')
          }
        })
    }, 350)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [hasBridge, query])

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
    <div ref={routeRef} className="zw-route" style={routeStyle}>
      <div style={headerRow}>
        <span style={microStyle}>PROJECT ZERO — SKILL LAB</span>
        <Chip label="LOCAL INVENTORY" tone="neutral" />
      </div>
      <div>
        <span style={headingStyle}>Skills Lab</span>
        <p style={summaryStyle}>
          Explore your existing skills. Select a line for details; nothing here executes skill code.
        </p>
      </div>
      <div style={headerRow}>
        <span style={microStyle}>{filtered.length} LOCAL SKILLS</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
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
      <input
        type="search"
        aria-label="Search skills"
        placeholder="Search skills by name, description, or source…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setScrollTop(0)
        }}
        style={{
          border: '1px solid var(--z-line)',
          borderRadius: 6,
          padding: '9px 12px',
          fontFamily: ZERO_TYPE.body,
          fontSize: 13
        }}
      />
      <div role="group" aria-label="Skill filters" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {(['All', 'Installed', 'Self-learnt'] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={filter === option}
            style={refreshStyle}
            onClick={() => {
              setFilter(option)
              setScrollTop(0)
            }}
          >
            {option}
          </button>
        ))}
      </div>
      <div className="skill-lab-workspace">
        <div
          className="skill-lab-wall"
          role="listbox"
          aria-label="Skill wall"
          tabIndex={0}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
            e.preventDefault()
            const current = filtered.findIndex((row) => row.key === selectedKey)
            const next = Math.min(
              filtered.length - 1,
              Math.max(0, current + (e.key === 'ArrowDown' ? 1 : -1))
            )
            if (filtered[next]) {
              chooseSkill(filtered[next].key)
              e.currentTarget.scrollTop = next * 56
            }
          }}
        >
          <div style={{ height: filtered.length * 56, position: 'relative' }}>
            {filtered.slice(start, end).map((row, index) => (
              <button
                key={row.key}
                type="button"
                role="option"
                aria-selected={selectedKey === row.key}
                onClick={() => chooseSkill(row.key)}
                style={{
                  position: 'absolute',
                  top: (start + index) * 56,
                  left: 0,
                  right: 0,
                  width: '100%',
                  height: 56,
                  border: 'none',
                  borderBottom: '1px solid var(--z-line)',
                  background: selectedKey === row.key ? 'var(--z-card-cream)' : 'transparent',
                  textAlign: 'left',
                  padding: '7px 10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                  cursor: 'pointer',
                  overflow: 'hidden'
                }}
                title={row.skill.name}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span aria-hidden="true" style={{ flexShrink: 0, fontSize: 17, lineHeight: 1 }}>
                    {skillIcon(row.skill, groups.find((g) => g.name === row.group)?.glyph ?? 'orb')}
                  </span>
                  <span style={skillName}>{row.skill.name}</span>
                </span>
                <span style={{ ...noticeStyle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                  {row.group} · {row.skill.source} · {row.skill.description ?? 'No description'}
                </span>
              </button>
            ))}
          </div>
          {filtered.length === 0 ? (
            <span style={noticeStyle}>
              {query
                ? 'No skills match this search.'
                : filter === 'Self-learnt'
                  ? 'No self-learnt skills are stored on this Mac yet.'
                  : 'No local skills found.'}
            </span>
          ) : null}
        </div>
        <aside
          ref={detailsRef}
          className="skill-lab-details"
          aria-label="Skill details"
          style={{
            overflowY: 'auto',
            border: '1px solid var(--z-line)',
            borderRadius: 8,
            padding: 12,
            overflowWrap: 'anywhere'
          }}
        >
          {catalogSelection ? (
            <>
              <span style={{ ...skillName, display: 'block', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{catalogSelection.skill}</span>
              <p style={noticeStyle}>AVAILABLE FROM SKILLS.SH · NOT INSTALLED</p>
              <p style={noticeStyle}>{catalogSelection.source}</p>
              <p style={noticeStyle}>
                {catalogSelection.installs} reported installs · audit unknown
              </p>
              <p style={noticeStyle}>
                Installation requires a reviewed staging transaction and is unavailable in this
                build.
              </p>
            </>
          ) : selected ? (
            <>
              <span style={{ ...skillName, display: 'block', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{selected.skill.name}</span>
              <p style={summaryStyle}>
                {selected.skill.description ?? 'No description available.'}
              </p>
              <p style={noticeStyle}>SOURCE · {selected.skill.source}</p>
              <p style={noticeStyle}>GROUP · {selected.group}</p>
              <p style={noticeStyle}>AUDIT · Unknown</p>
            </>
          ) : (
            <span style={noticeStyle}>Select a skill to view its details.</span>
          )}
        </aside>
      </div>
      {query.trim().length >= 2 ? (
        <section
          aria-label="skills.sh catalog"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            maxHeight: 160,
            overflowY: 'auto'
          }}
        >
          <span style={microStyle}>SKILLS.SH · {catalog.length} AVAILABLE</span>
          {catalogError !== null ? <span style={noticeStyle}>{catalogError}</span> : null}
          {catalog.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              style={{ ...refreshStyle, textAlign: 'left' }}
              onClick={() => {
                setCatalogSelection(candidate)
                setSelectedKey(null)
              }}
            >
              {candidate.id} · {candidate.installs} installs
            </button>
          ))}
        </section>
      ) : null}
      {note !== null ? (
        <span data-testid="skills-note" style={noticeStyle}>
          {note}
        </span>
      ) : null}
      <span style={noticeStyle}>
        Catalog results are read-only. Installing a remote skill is unavailable until the reviewed
        staging path ships.
      </span>
    </div>
  )
})
