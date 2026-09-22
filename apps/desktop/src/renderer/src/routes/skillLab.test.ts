import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SkillLabRoute } from './SkillLabRoute'
import {
  SKILL_INJECTION_CONTRACT,
  SKILL_FIXTURES,
  skillSummary,
  type SkillFixture
} from './runtime.types'

const skill = (overrides: Partial<SkillFixture>): SkillFixture => ({
  id: 'demo-skill',
  name: 'Demo Skill',
  summary: 'A demonstration skill.',
  source: 'authored',
  enabled: false,
  isUsable: true,
  rejectionReason: null,
  ...overrides
})

describe('skill fixtures', () => {
  it('shapes every fixture after the SkillStore skill record', () => {
    for (const s of SKILL_FIXTURES) {
      expect(Object.keys(s).sort()).toEqual(
        ['enabled', 'id', 'isUsable', 'name', 'rejectionReason', 'source', 'summary'].sort()
      )
    }
  })

  it('covers all three sources and one visible unusable skill', () => {
    const sources = new Set(SKILL_FIXTURES.map((s) => s.source))
    expect(sources.has('learned-in-codex')).toBe(true)
    expect(sources.has('learned-in-opencode')).toBe(true)
    expect(sources.has('authored')).toBe(true)
    const unusable = SKILL_FIXTURES.filter((s) => !s.isUsable)
    expect(unusable).toHaveLength(1)
    expect(unusable[0].rejectionReason).toBeTruthy()
    expect(SKILL_FIXTURES.every((s) => s.enabled === false)).toBe(true)
  })

  it('summarizes unusable skills with their rejection reason', () => {
    const unusable = SKILL_FIXTURES.find((s) => !s.isUsable)
    expect(skillSummary(unusable as SkillFixture)).toBe(unusable?.rejectionReason)
    expect(skillSummary(skill({}))).toBe('A demonstration skill.')
  })
})

describe('SkillLabRoute', () => {
  it('renders every fixture skill with its source label', () => {
    const html = renderToString(createElement(SkillLabRoute))
    for (const s of SKILL_FIXTURES) {
      expect(html).toContain(s.name)
      expect(html).toContain(s.source.toUpperCase())
    }
  })

  it('marks the unusable skill visibly instead of dropping it', () => {
    const unusable = SKILL_FIXTURES.find((s) => !s.isUsable)
    const html = renderToString(createElement(SkillLabRoute))
    expect(html).toContain('UNUSABLE')
    expect(html).toContain(unusable?.rejectionReason as string)
  })

  it('presents the injection contract and the read-only scope honestly', () => {
    const html = renderToString(createElement(SkillLabRoute))
    expect(html).toContain('READ-ONLY')
    expect(html).toContain(SKILL_INJECTION_CONTRACT)
    expect(html).toContain('Nothing here executes skill code')
  })
})
