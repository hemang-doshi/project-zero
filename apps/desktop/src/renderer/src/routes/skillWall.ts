import type { PluginGroup, SkillSummary } from './skillPlugins'
import { verifiedSkillBrand } from './skillBrands'

export function skillIcon(skill: SkillSummary): string | null {
  return skill.icon?.trim() || null
}

export type SkillIdentityMark =
  | { kind: 'skill'; text: string; label: string }
  | { kind: 'brand'; src: string; label: string }
  | { kind: 'unknown'; label: string }

export function skillIdentityMark(skill: SkillSummary): SkillIdentityMark {
  const suppliedIcon = skillIcon(skill)
  if (suppliedIcon !== null) return { kind: 'skill', text: suppliedIcon, label: `Icon supplied by ${skill.name}` }
  const brand = skill.pluginId === null ? null : verifiedSkillBrand(skill.pluginId)
  if (brand !== null) return { kind: 'brand', src: brand.src, label: brand.alt }
  return { kind: 'unknown', label: `No verified icon for ${skill.name}` }
}

export type SkillWallRow = { key: string; group: string; skill: SkillSummary }

export function localSkillRows(groups: PluginGroup[], selfLearnt: SkillSummary[]): SkillWallRow[] {
  const seen = new Set<string>()
  const rows: SkillWallRow[] = []
  for (const [group, skills] of [
    ...groups.map((g) => [g.name, g.skills] as const),
    ['Self-learnt', selfLearnt] as const
  ]) {
    for (const skill of skills) {
      const key = `${skill.source}:${skill.pluginId ?? ''}:${skill.id}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({ key, group, skill })
    }
  }
  return rows.sort((a, b) => a.skill.name.localeCompare(b.skill.name) || a.key.localeCompare(b.key))
}

export function searchSkillRows(rows: SkillWallRow[], query: string): SkillWallRow[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return rows
  return rows.filter(({ skill, group }) => {
    const haystack =
      `${skill.name} ${skill.description ?? ''} ${skill.source} ${group}`.toLocaleLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

export function skillWindow(
  total: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight = 56
): { start: number; end: number } {
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 4)
  const end = Math.min(total, Math.ceil((scrollTop + viewportHeight) / rowHeight) + 4)
  return { start, end }
}
