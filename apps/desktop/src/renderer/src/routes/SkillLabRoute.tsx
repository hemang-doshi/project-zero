import { memo } from 'react'
import { ZERO_TYPE } from '../../../shared/tokens'
import { Chip } from './Chip'
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
      {SKILL_FIXTURES.map((s) => (
        <SkillRow key={s.id} skill={s} />
      ))}
      <div style={cardStyle}>
        <span style={noticeStyle}>INJECTION CONTRACT — SHOWN BEFORE USE</span>
        <span style={noticeStyle}>{SKILL_INJECTION_CONTRACT}</span>
      </div>
      <span style={noticeStyle}>
        Fixture data in this build: the daemon exposes no skill store and the sandboxed renderer has
        no filesystem op, so the owner-controlled skills directory is not wired here.
      </span>
    </div>
  )
})
