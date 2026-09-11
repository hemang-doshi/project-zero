import { describe, it, expect } from 'vitest'
import { CANONICAL_ROUTE_ORDER } from '../shared/desktop-windows'
import items from './desktop-items.json'

type Icon = {
  id: string
  label: string
  kind: 'route' | 'file'
  route?: string
  file?: string
}
type File = { id: string; name: string; ext: 'txt' | 'png' | 'pdf' | 'notes'; content: string }
type Items = { icons: Icon[]; files: File[] }

const data = items as unknown as Items
const routeIcons = data.icons.filter((i) => i.kind === 'route')
const fileIcons = data.icons.filter((i) => i.kind === 'file')

describe('desktop-items.json', () => {
  it('parses with the pinned schema shape', () => {
    expect(Object.keys(data).sort()).toEqual(['files', 'icons'])
    expect(Array.isArray(data.icons)).toBe(true)
    expect(Array.isArray(data.files)).toBe(true)
  })

  it('has unique icon ids', () => {
    const ids = data.icons.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('references a valid RouteId for every route-kind icon', () => {
    expect(routeIcons).toHaveLength(7)
    for (const icon of routeIcons) {
      expect(typeof icon.route).toBe('string')
      expect((CANONICAL_ROUTE_ORDER as readonly string[]).includes(icon.route as string)).toBe(true)
    }
  })

  it('lists route icons in the canonical seeding order', () => {
    expect(routeIcons.map((i) => i.route)).toEqual([...CANONICAL_ROUTE_ORDER])
  })

  it('seeds the four dummy files with the required extensions', () => {
    expect(data.files.map((f) => f.id).sort()).toEqual(
      ['architecture', 'notes', 'readme', 'screenshot'].sort()
    )
    expect(new Set(data.files.map((f) => f.ext))).toEqual(new Set(['txt', 'pdf', 'png', 'notes']))
    expect(data.files.map((f) => f.name)).toEqual([
      'README.txt',
      'architecture.pdf',
      'screenshot.png',
      'notes'
    ])
  })

  it('seeds every file with non-empty content', () => {
    for (const f of data.files) {
      expect(f.content.trim().length).toBeGreaterThan(0)
    }
  })

  it('references an existing file for every file-kind icon', () => {
    const fileIds = new Set(data.files.map((f) => f.id))
    expect(fileIcons).toHaveLength(4)
    for (const icon of fileIcons) {
      expect(fileIds.has(icon.file as string)).toBe(true)
    }
  })
})
