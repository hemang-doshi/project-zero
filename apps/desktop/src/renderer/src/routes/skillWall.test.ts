import { describe, expect, it } from 'vitest'
import { localSkillRows, searchSkillRows, skillWindow } from './skillWall'

describe('skill wall model', () => {
  it('keeps live skills, deduplicates identity and searches human text', () => {
    const skill = {
      id: 'build',
      name: 'Build Helper',
      source: 'installed' as const,
      pluginId: 'p',
      description: 'Ships code'
    }
    const rows = localSkillRows(
      [{ id: 'p', name: 'Tools', color: '#fff', glyph: 'flask', skills: [skill, skill] }],
      []
    )
    expect(rows).toHaveLength(1)
    expect(searchSkillRows(rows, 'tools ships')).toHaveLength(1)
    expect(searchSkillRows(rows, 'missing')).toHaveLength(0)
  })

  it('renders a bounded slice for a thousand rows', () => {
    const { start, end } = skillWindow(1000, 12000, 420)
    expect(end - start).toBeLessThan(20)
    expect(start).toBeGreaterThan(0)
  })
})
