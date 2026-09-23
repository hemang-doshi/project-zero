import { describe, expect, it } from 'vitest'
import { localSkillRows, searchSkillRows, skillWindow, skillIcon, skillIdentityMark } from './skillWall'

describe('skill wall model', () => {
  it('uses only an icon supplied by the skill and otherwise reports unknown', () => {
    expect(skillIcon({ id: 'a', name: 'A', source: 'installed', pluginId: 'p', icon: '🧪' })).toBe('🧪')
    expect(skillIcon({ id: 'b', name: 'B', source: 'installed', pluginId: 'p' })).toBeNull()
  })
  it('uses an exact verified plugin brand when the skill has no own icon', () => {
    expect(skillIdentityMark({ id: 'a', name: 'Open', source: 'installed', pluginId: 'playwright' })).toMatchObject({
      kind: 'brand',
      label: 'Playwright official logo'
    })
    expect(skillIdentityMark({ id: 'b', name: 'Build', source: 'installed', pluginId: 'gstack' })).toMatchObject({
      kind: 'unknown',
      label: 'No verified icon for Build'
    })
    expect(skillIdentityMark({ id: 'c', name: 'Standalone', source: 'self-learnt', pluginId: null })).toMatchObject({ kind: 'unknown' })
  })
  it('keeps live skills, deduplicates identity and searches human text', () => {
    const skill = {
      id: 'build',
      name: 'Build Helper',
      source: 'installed' as const,
      pluginId: 'p',
      description: 'Ships code'
    }
    const rows = localSkillRows(
      [{ id: 'p', name: 'Tools', color: '#fff', skills: [skill, skill] }],
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
