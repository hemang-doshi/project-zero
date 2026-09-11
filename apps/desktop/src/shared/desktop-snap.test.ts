import { describe, it, expect } from 'vitest'
import {
  SNAP_THRESHOLD,
  detectSnapZone,
  isAwayFromSnap,
  resolveDrop,
  snapRectFor
} from './desktop-snap'

// Canvas bounds mirror the app default: a 900×670 viewport with the 32px
// taskbar excluded from the window canvas.
const CANVAS = { w: 900, h: 638 }
const BIG = { w: 2400, h: 932 }
const TALL = { w: 560, h: 480 }
const SHORT = { w: 560, h: 200 }
const NARROW = { w: 200, h: 200 }

describe('snap zones', () => {
  it('pins the edge threshold at 24px', () => {
    expect(SNAP_THRESHOLD).toBe(24)
  })

  it('detects left and right halves at the side edges', () => {
    expect(detectSnapZone({ x: 10, y: 100 }, TALL, CANVAS)).toBe('left')
    expect(detectSnapZone({ x: 340, y: 100 }, TALL, CANVAS)).toBe('right')
  })

  it('detects the top edge as maximize through the existing maximize path', () => {
    expect(detectSnapZone({ x: 300, y: 5 }, TALL, CANVAS)).toBe('maximize')
  })

  it('detects the bottom edge as the bottom half', () => {
    // macOS has no bottom-half; Zero picks bottom half for symmetry with the
    // top-edge maximize — a dragged window always has somewhere to land.
    expect(detectSnapZone({ x: 300, y: 200 }, TALL, CANVAS)).toBe('bottom')
  })

  it('detects all four corners as quarters', () => {
    expect(detectSnapZone({ x: 5, y: 5 }, TALL, CANVAS)).toBe('top-left')
    expect(detectSnapZone({ x: 340, y: 5 }, TALL, CANVAS)).toBe('top-right')
    expect(detectSnapZone({ x: 5, y: 200 }, TALL, CANVAS)).toBe('bottom-left')
    expect(detectSnapZone({ x: 340, y: 200 }, TALL, CANVAS)).toBe('bottom-right')
  })

  it('prefers corners over edges when both are in range', () => {
    expect(detectSnapZone({ x: 5, y: 5 }, NARROW, CANVAS)).toBe('top-left')
    expect(detectSnapZone({ x: 5, y: 420 }, NARROW, CANVAS)).toBe('bottom-left')
  })

  it('returns null for a mid-canvas drag', () => {
    expect(detectSnapZone({ x: 170, y: 79 }, TALL, CANVAS)).toBeNull()
  })

  it('treats the threshold boundary as inside, one pixel past as outside', () => {
    expect(detectSnapZone({ x: 24, y: 100 }, TALL, CANVAS)).toBe('left')
    expect(detectSnapZone({ x: 25, y: 100 }, TALL, CANVAS)).toBeNull()
    expect(detectSnapZone({ x: 300, y: 24 }, SHORT, CANVAS)).toBe('maximize')
    expect(detectSnapZone({ x: 300, y: 25 }, SHORT, CANVAS)).toBeNull()
  })
})

describe('snap rect geometry', () => {
  it('halves, quarters, bottom half and maximize at the 900×670 canvas', () => {
    expect(snapRectFor('left', CANVAS)).toEqual({ x: 0, y: 0, w: 450, h: 638 })
    expect(snapRectFor('right', CANVAS)).toEqual({ x: 450, y: 0, w: 450, h: 638 })
    expect(snapRectFor('maximize', CANVAS)).toEqual({ x: 0, y: 0, w: 900, h: 638 })
    expect(snapRectFor('bottom', CANVAS)).toEqual({ x: 0, y: 319, w: 900, h: 319 })
    expect(snapRectFor('top-left', CANVAS)).toEqual({ x: 0, y: 0, w: 450, h: 319 })
    expect(snapRectFor('top-right', CANVAS)).toEqual({ x: 450, y: 0, w: 450, h: 319 })
    expect(snapRectFor('bottom-left', CANVAS)).toEqual({ x: 0, y: 319, w: 450, h: 319 })
    expect(snapRectFor('bottom-right', CANVAS)).toEqual({ x: 450, y: 319, w: 450, h: 319 })
  })

  it('stays geometric at an oversized canvas, past the user-resize ceiling', () => {
    expect(snapRectFor('left', BIG)).toEqual({ x: 0, y: 0, w: 1200, h: 932 })
    expect(snapRectFor('right', BIG)).toEqual({ x: 1200, y: 0, w: 1200, h: 932 })
    expect(snapRectFor('maximize', BIG)).toEqual({ x: 0, y: 0, w: 2400, h: 932 })
    expect(snapRectFor('bottom-right', BIG)).toEqual({ x: 1200, y: 466, w: 1200, h: 466 })
  })
})

describe('drag-away un-snap', () => {
  it('stays put on a small wiggle inside the threshold', () => {
    expect(isAwayFromSnap('left', { x: 10, y: 10 }, CANVAS)).toBe(false)
    expect(isAwayFromSnap('left', { x: 24, y: 0 }, CANVAS)).toBe(false)
    expect(isAwayFromSnap('right', { x: 450, y: 10 }, CANVAS)).toBe(false)
  })

  it('trips once past threshold+ from the snap anchor', () => {
    expect(isAwayFromSnap('left', { x: 25, y: 0 }, CANVAS)).toBe(true)
    expect(isAwayFromSnap('right', { x: 300, y: 0 }, CANVAS)).toBe(true)
    expect(isAwayFromSnap('bottom-right', { x: 450, y: 319 }, CANVAS)).toBe(false)
    expect(isAwayFromSnap('bottom-right', { x: 450, y: 400 }, CANVAS)).toBe(true)
  })
})

describe('pointer semantics (zero-size probe)', () => {
  it('the cursor itself must meet the edge', () => {
    const P = { w: 0, h: 0 }
    expect(detectSnapZone({ x: 10, y: 400 }, P, CANVAS)).toBe('left')
    expect(detectSnapZone({ x: 890, y: 400 }, P, CANVAS)).toBe('right')
    expect(detectSnapZone({ x: 450, y: 10 }, P, CANVAS)).toBe('maximize')
    expect(detectSnapZone({ x: 450, y: 630 }, P, CANVAS)).toBe('bottom')
    expect(detectSnapZone({ x: 10, y: 10 }, P, CANVAS)).toBe('top-left')
    expect(detectSnapZone({ x: 300, y: 300 }, P, CANVAS)).toBeNull()
  })

  it('a full-height half un-snaps on a mid-canvas pointer drop', () => {
    // Rect-based detection could never reach this: a full-height window
    // always trips the bottom zone. The pointer carries no size, so it can.
    expect(
      resolveDrop({
        currentSnap: 'left',
        maximized: false,
        pos: { x: 300, y: 400 },
        size: { w: 0, h: 0 },
        bounds: CANVAS
      })
    ).toEqual({ type: 'unsnap' })
  })

  it('a pointer parked near a snap anchor but outside every zone stays', () => {
    expect(
      resolveDrop({
        currentSnap: 'bottom-right',
        maximized: false,
        pos: { x: 460, y: 330 },
        size: { w: 0, h: 0 },
        bounds: CANVAS
      })
    ).toEqual({ type: 'stay' })
  })

  it('a pointer dragged edge to edge moves the snap', () => {
    expect(
      resolveDrop({
        currentSnap: 'left',
        maximized: false,
        pos: { x: 890, y: 400 },
        size: { w: 0, h: 0 },
        bounds: CANVAS
      })
    ).toEqual({ type: 'snap', kind: 'right' })
  })
})

describe('resolveDrop', () => {
  it('snaps a free window dropped in a zone, stays plain mid-canvas', () => {
    expect(
      resolveDrop({
        currentSnap: null,
        maximized: false,
        pos: { x: 5, y: 100 },
        size: TALL,
        bounds: CANVAS
      })
    ).toEqual({ type: 'snap', kind: 'left' })
    expect(
      resolveDrop({
        currentSnap: null,
        maximized: false,
        pos: { x: 170, y: 79 },
        size: TALL,
        bounds: CANVAS
      })
    ).toEqual({ type: 'plain' })
  })

  it('routes a top-edge drop to maximize, even from a snap', () => {
    expect(
      resolveDrop({
        currentSnap: 'left',
        maximized: false,
        pos: { x: 300, y: 2 },
        size: TALL,
        bounds: CANVAS
      })
    ).toEqual({ type: 'snap', kind: 'maximize' })
  })

  it('stays when dropped back in its own zone', () => {
    expect(
      resolveDrop({
        currentSnap: 'left',
        maximized: false,
        pos: { x: 4, y: 100 },
        size: TALL,
        bounds: CANVAS
      })
    ).toEqual({ type: 'stay' })
    expect(
      resolveDrop({
        currentSnap: null,
        maximized: true,
        pos: { x: 300, y: 2 },
        size: TALL,
        bounds: CANVAS
      })
    ).toEqual({ type: 'stay' })
  })

  it('moves a snapped window to a different zone', () => {
    expect(
      resolveDrop({
        currentSnap: 'left',
        maximized: false,
        pos: { x: 340, y: 100 },
        size: TALL,
        bounds: CANVAS
      })
    ).toEqual({ type: 'snap', kind: 'right' })
    expect(
      resolveDrop({
        currentSnap: null,
        maximized: true,
        pos: { x: 5, y: 100 },
        size: TALL,
        bounds: CANVAS
      })
    ).toEqual({ type: 'snap', kind: 'left' })
  })

  it('un-snaps a snapped window dropped far from every zone', () => {
    expect(
      resolveDrop({
        currentSnap: 'left',
        maximized: false,
        pos: { x: 170, y: 79 },
        size: TALL,
        bounds: CANVAS
      })
    ).toEqual({ type: 'unsnap' })
  })

  it('stays a snapped window dropped near home but outside every zone', () => {
    // A narrow window at (440,320) trips no edge zone, yet sits within
    // threshold of the bottom-right anchor (450,319).
    expect(
      resolveDrop({
        currentSnap: 'bottom-right',
        maximized: false,
        pos: { x: 440, y: 320 },
        size: NARROW,
        bounds: CANVAS
      })
    ).toEqual({ type: 'stay' })
  })

  it('leaves a dragged maximized window to the plain commit path', () => {
    expect(
      resolveDrop({
        currentSnap: null,
        maximized: true,
        pos: { x: 170, y: 79 },
        size: TALL,
        bounds: CANVAS
      })
    ).toEqual({ type: 'plain' })
  })
})
