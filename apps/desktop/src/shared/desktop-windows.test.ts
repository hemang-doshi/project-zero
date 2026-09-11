import { describe, it, expect } from 'vitest'
import {
  clampSize,
  cascadeOffset,
  initialOrigin,
  launchOrigins,
  fallbackSelection,
  migrateStackedOrigins
} from './desktop-windows'

describe('geometry', () => {
  it('clamps sizes to 320-1100 x 240-900', () => {
    expect(clampSize(100, 100)).toEqual({ w: 320, h: 240 })
    expect(clampSize(2000, 2000)).toEqual({ w: 1100, h: 900 })
    expect(clampSize(560, 480)).toEqual({ w: 560, h: 480 })
  })
  it('cascades 28 pt steps wrapping every 8', () => {
    expect(cascadeOffset(0)).toEqual({ x: 0, y: 0 })
    expect(cascadeOffset(3)).toEqual({ x: 84, y: 84 })
    expect(cascadeOffset(9)).toEqual({ x: 28, y: 28 })
  })
  it('stored origin wins as-is (free movement, may be partially off-canvas)', () => {
    expect(initialOrigin(4, { x: -50, y: 700 })).toEqual({ x: -50, y: 700 })
    expect(initialOrigin(4, undefined)).toEqual({ x: 112, y: 112 })
  })
  it('stagger gives distinct origins', () => {
    const o = launchOrigins(3)
    expect(new Set(o.map((p) => `${p.x},${p.y}`)).size).toBe(3)
  })
  it('fallback skips closed + minimized, falls back to desk', () => {
    expect(fallbackSelection('runtime', ['desk', 'runtime', 'network'])).toBe('network')
    expect(fallbackSelection('runtime', ['desk', 'runtime'], ['desk'])).toBe('desk')
    expect(fallbackSelection('desk', [], [])).toBe('desk')
  })
})

describe('migrateStackedOrigins', () => {
  it('repairs a stacked cluster: keeps first, spreads rest, bumps version', () => {
    const positions = {
      desk: { x: 28, y: 28 },
      runtime: { x: 28, y: 28 },
      network: { x: 28, y: 28 },
      airlock: { x: 56, y: 56 },
      zeroBot: { x: 56, y: 56 }
    }
    const out = migrateStackedOrigins(positions, 1)
    expect(out.layoutVersion).toBe(2)
    expect(out.positions.desk).toEqual({ x: 28, y: 28 })
    expect(out.positions.runtime).not.toEqual(out.positions.desk)
    expect(out.positions.network).not.toEqual(out.positions.desk)
    expect(out.positions.runtime).toEqual({ x: 80, y: 80 })
    expect(out.positions.network).toEqual({ x: 128, y: 128 })
    expect(out.positions.airlock).toEqual({ x: 176, y: 176 })
    expect(out.positions.zeroBot).toEqual({ x: 224, y: 224 })
  })
  it('is idempotent once version >= 2', () => {
    const positions = { desk: { x: 28, y: 28 }, runtime: { x: 28, y: 28 } }
    expect(migrateStackedOrigins(positions, 2)).toEqual({ positions, layoutVersion: 2 })
  })
})
