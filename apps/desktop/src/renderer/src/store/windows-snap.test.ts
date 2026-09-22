import { beforeEach, describe, it, expect } from 'vitest'
import { getAllSnapEntries, getSnapEntry, initialWindows, useWindows } from './windows'

// Bounds mirror the app default (900×670 viewport, 32px taskbar excluded)
// and an oversized canvas past the 1100×900 user-resize ceiling.
const CANVAS = { w: 900, h: 638 }
const BIG = { w: 2400, h: 932 }

describe('window snap', () => {
  beforeEach(() => {
    useWindows.setState(initialWindows())
  })

  it('seeds with no snapped windows', () => {
    expect(useWindows.getState().snapped).toEqual({})
    expect(getSnapEntry('desk')).toBeNull()
  })

  it('snap pins the left half and remembers the pre-snap rect', () => {
    useWindows.getState().snap('desk', 'left', CANVAS)
    expect(useWindows.getState().rects.desk).toEqual({ x: 0, y: 0, w: 450, h: 638 })
    expect(useWindows.getState().snapped).toEqual({ desk: 'left' })
    expect(getSnapEntry('desk')).toEqual({
      kind: 'left',
      preSnap: { x: 0, y: 0, w: 560, h: 480 }
    })
  })

  it('snap rects bypass the user-resize ceiling like maximize', () => {
    useWindows.getState().snap('desk', 'left', BIG)
    expect(useWindows.getState().rects.desk).toEqual({ x: 0, y: 0, w: 1200, h: 932 })
  })

  it('un-snap restores the exact pre-snap rect', () => {
    useWindows.getState().commit('desk', { x: 40, y: 50, w: 600, h: 500 })
    useWindows.getState().snap('desk', 'right', CANVAS)
    useWindows.getState().unsnap('desk')
    expect(useWindows.getState().rects.desk).toEqual({ x: 40, y: 50, w: 600, h: 500 })
    expect(useWindows.getState().snapped).toEqual({})
    expect(getSnapEntry('desk')).toBeNull()
  })

  it('re-snapping keeps the original pre-snap rect', () => {
    useWindows.getState().snap('desk', 'left', CANVAS)
    useWindows.getState().snap('desk', 'bottom-right', CANVAS)
    expect(useWindows.getState().rects.desk).toEqual({ x: 450, y: 319, w: 450, h: 319 })
    useWindows.getState().unsnap('desk')
    expect(useWindows.getState().rects.desk).toEqual({ x: 0, y: 0, w: 560, h: 480 })
  })

  it('un-snap of a free window is a no-op', () => {
    let sets = 0
    const unsubscribe = useWindows.subscribe(() => {
      sets += 1
    })
    useWindows.getState().unsnap('desk')
    expect(sets).toBe(0)
    unsubscribe()
  })

  it('snapping a maximized window replaces maximize, keeping the pre-max rect', () => {
    useWindows.getState().maximize('desk', CANVAS)
    expect(useWindows.getState().maximized).toEqual(['desk'])
    useWindows.getState().snap('desk', 'left', CANVAS)
    expect(useWindows.getState().maximized).toEqual([])
    expect(useWindows.getState().snapped).toEqual({ desk: 'left' })
    useWindows.getState().unsnap('desk')
    expect(useWindows.getState().rects.desk).toEqual({ x: 0, y: 0, w: 560, h: 480 })
  })

  it('maximizing a snapped window replaces snap, un-maximize restores the pre-snap rect', () => {
    useWindows.getState().commit('desk', { x: 40, y: 50, w: 600, h: 500 })
    useWindows.getState().snap('desk', 'right', CANVAS)
    useWindows.getState().maximize('desk', CANVAS)
    expect(useWindows.getState().snapped).toEqual({})
    expect(useWindows.getState().maximized).toEqual(['desk'])
    expect(useWindows.getState().rects.desk).toEqual({ x: 0, y: 0, w: 900, h: 638 })
    useWindows.getState().maximize('desk', CANVAS)
    expect(useWindows.getState().rects.desk).toEqual({ x: 40, y: 50, w: 600, h: 500 })
  })

  it('refit re-spans snapped windows against new bounds and leaves free ones alone', () => {
    useWindows.getState().commit('runtime', { x: 40, y: 50, w: 600, h: 500 })
    useWindows.getState().snap('desk', 'left', CANVAS)
    useWindows.getState().refit({ w: 1000, h: 700 })
    expect(useWindows.getState().rects.desk).toEqual({ x: 0, y: 0, w: 500, h: 700 })
    expect(useWindows.getState().rects.runtime).toEqual({ x: 40, y: 50, w: 600, h: 500 })
    expect(useWindows.getState().snapped).toEqual({ desk: 'left' })
  })

  it('committing a resize on a snapped window clears the snap to the clamped normal', () => {
    useWindows.getState().snap('desk', 'left', CANVAS)
    useWindows.getState().commit('desk', { x: 12, y: 14, w: 640, h: 520 })
    expect(useWindows.getState().snapped).toEqual({})
    expect(useWindows.getState().rects.desk).toEqual({ x: 12, y: 14, w: 640, h: 520 })
    expect(getSnapEntry('desk')).toBeNull()
  })

  it('close clears the snap memory like it clears maximize', () => {
    useWindows.getState().snap('desk', 'left', CANVAS)
    useWindows.getState().close('desk')
    expect(useWindows.getState().snapped).toEqual({})
    expect(getSnapEntry('desk')).toBeNull()
    expect(getAllSnapEntries()).toEqual({})
  })

  it('hydrateSnaps recomputes against current bounds, keeping kind and pre-snap', () => {
    // Persistence round-trip core: the stored pixels are stale (an older
    // canvas), so the rect must come from the kind, not the pixels.
    useWindows
      .getState()
      .hydrateSnaps(
        { desk: { kind: 'left', preSnap: { x: 40, y: 50, w: 600, h: 500 } } },
        { w: 1000, h: 700 }
      )
    expect(useWindows.getState().rects.desk).toEqual({ x: 0, y: 0, w: 500, h: 700 })
    expect(useWindows.getState().snapped).toEqual({ desk: 'left' })
    expect(getSnapEntry('desk')).toEqual({
      kind: 'left',
      preSnap: { x: 40, y: 50, w: 600, h: 500 }
    })
  })

  it('hydrateSnaps drops malformed entries fail-soft', () => {
    useWindows.getState().hydrateSnaps(
      {
        desk: { kind: 'left', preSnap: { x: 1, y: 2, w: 560, h: 480 } },
        runtime: { kind: 'diagonal', preSnap: { x: 1, y: 2, w: 3, h: 4 } }
      } as unknown as Record<
        string,
        { kind: 'left'; preSnap: { x: number; y: number; w: number; h: number } }
      >,
      CANVAS
    )
    expect(useWindows.getState().snapped).toEqual({ desk: 'left' })
    expect(getSnapEntry('runtime')).toBeNull()
  })
})
