import { describe, expect, it } from 'vitest'
import { networkInitialRect, workspaceInitialRect, previewTransform, resizeAnchor } from './canvas'

describe('network window launch', () => {
  it('opens large enough for the desk scene without leaving the viewport', () => {
    expect(networkInitialRect({ w: 1024, h: 736 })).toEqual({ x: 32, y: 16, w: 960, h: 704 })
    expect(networkInitialRect({ w: 1920, h: 1050 })).toEqual({ x: 480, y: 145, w: 960, h: 760 })
  })
})

describe('workspace window launch', () => {
  it('leaves enough room for sidebar, canvas and inspector at desktop width', () => {
    expect(workspaceInitialRect({ w: 1440, h: 900 })).toEqual({ x: 170, y: 50, w: 1100, h: 800 })
  })
})

describe('resize anchors', () => {
  it('left edges anchor right', () => {
    expect(resizeAnchor('left')).toEqual({ x: 1, y: 0 })
    expect(resizeAnchor('topLeft')).toEqual({ x: 1, y: 1 })
    expect(resizeAnchor('bottomLeft')).toEqual({ x: 1, y: 0 })
  })
  it('top edges anchor bottom', () => {
    expect(resizeAnchor('top')).toEqual({ x: 0, y: 1 })
    expect(resizeAnchor('topRight')).toEqual({ x: 0, y: 1 })
  })
  it('right/bottom edges anchor left/top', () => {
    expect(resizeAnchor('right')).toEqual({ x: 0, y: 0 })
    expect(resizeAnchor('bottom')).toEqual({ x: 0, y: 0 })
    expect(resizeAnchor('bottomRight')).toEqual({ x: 0, y: 0 })
  })
})

describe('transform-only preview', () => {
  it('scales content around the fixed corner during resize', () => {
    expect(previewTransform('topLeft', { w: 400, h: 300 }, { w: 500, h: 300 })).toEqual({
      scale: { x: 1.25, y: 1 },
      origin: '100% 100%'
    })
  })
  it('is identity when no preview size is given', () => {
    expect(previewTransform('right', { w: 400, h: 300 }, null)).toBeNull()
  })
})
