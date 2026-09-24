import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SkillLabRoute } from './SkillLabRoute'
import { SKILL_FIXTURES, skillSummary, type SkillFixture } from './runtime.types'

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
  it('renders an honest local wall without presenting fixture data as installed', () => {
    const html = renderToString(createElement(SkillLabRoute))
    expect(html).toContain('Skill wall')
    expect(html).toContain('Search skills')
    expect(html).not.toContain(SKILL_FIXTURES[0].name)
  })

  it('marks catalog installation unavailable until the safe adapter exists', () => {
    const html = renderToString(createElement(SkillLabRoute))
    expect(html).toContain('Installing a remote skill is unavailable')
  })

  it('presents the read-only scope honestly', () => {
    const html = renderToString(createElement(SkillLabRoute))
    expect(html).toContain('LOCAL INVENTORY')
    expect(html).toContain('nothing here executes skill code')
  })
})
