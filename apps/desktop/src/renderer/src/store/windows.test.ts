import { beforeEach, describe, it, expect } from 'vitest'
import { useWindows, initialWindows } from './windows'

describe('useWindows', () => {
  beforeEach(() => {
    useWindows.setState(initialWindows())
  })

  it('seeds desk and runtime with the front window selected', () => {
    expect(useWindows.getState().open).toEqual(['desk', 'runtime'])
    expect(useWindows.getState().selected).toBe('runtime')
    expect(useWindows.getState().zOrder).toEqual(['desk', 'runtime'])
  })

  it('close repoints selection to the front-most remaining window', () => {
    useWindows.getState().close('runtime')
    expect(useWindows.getState().open).toEqual(['desk'])
    expect(useWindows.getState().selected).toBe('desk')
  })

  it('close keeps the selection when a background window is closed', () => {
    useWindows.getState().close('desk')
    expect(useWindows.getState().selected).toBe('runtime')
  })

  it('close of every window falls back to desk', () => {
    useWindows.getState().close('runtime')
    useWindows.getState().close('desk')
    expect(useWindows.getState().open).toEqual([])
    expect(useWindows.getState().selected).toBe('desk')
  })

  it('minimize of the selected window repoints selection', () => {
    useWindows.getState().minimize('runtime')
    expect(useWindows.getState().minimized).toEqual(['runtime'])
    expect(useWindows.getState().selected).toBe('desk')
  })

  it('focus un-minimizes, brings to front, and selects', () => {
    useWindows.getState().minimize('runtime')
    useWindows.getState().focus('runtime')
    expect(useWindows.getState().minimized).toEqual([])
    expect(useWindows.getState().zOrder).toEqual(['desk', 'runtime'])
    expect(useWindows.getState().selected).toBe('runtime')
  })

  it('commit clamps the committed rect', () => {
    useWindows.getState().commit('desk', { x: 10, y: 12, w: 5000, h: 5000 })
    expect(useWindows.getState().rects.desk).toEqual({ x: 10, y: 12, w: 1100, h: 900 })
  })

  it('openRoute opens a closed route front-most with the stored rect', () => {
    useWindows.getState().close('desk')
    useWindows.getState().openRoute('network', { x: 8, y: 9, w: 560, h: 480 })
    expect(useWindows.getState().open).toEqual(['runtime', 'network'])
    expect(useWindows.getState().zOrder).toEqual(['runtime', 'network'])
    expect(useWindows.getState().rects.network).toEqual({ x: 8, y: 9, w: 560, h: 480 })
  })

  it('openRoute without a stored rect cascades past the open count', () => {
    useWindows.getState().close('desk')
    useWindows.getState().openRoute('network')
    expect(useWindows.getState().rects.network).toEqual({ x: 56, y: 56, w: 560, h: 480 })
  })

  it('openRoute refocuses an already open route without duplicating it', () => {
    useWindows.getState().openRoute('desk', { x: 1, y: 1, w: 560, h: 480 })
    expect(useWindows.getState().open).toEqual(['desk', 'runtime'])
    expect(useWindows.getState().zOrder.at(-1)).toBe('desk')
  })

  it('openFile opens a file viewer window keyed file:<id>', () => {
    useWindows.getState().openFile('readme', { x: 4, y: 4, w: 560, h: 480 })
    expect(useWindows.getState().open).toContain('file:readme')
    expect(useWindows.getState().zOrder.at(-1)).toBe('file:readme')
    expect(useWindows.getState().rects['file:readme']).toEqual({ x: 4, y: 4, w: 560, h: 480 })
  })

  it('openFile refocuses when the viewer is already open', () => {
    useWindows.getState().openFile('readme', { x: 4, y: 4, w: 560, h: 480 })
    useWindows.getState().focus('runtime')
    useWindows.getState().openFile('readme')
    expect(useWindows.getState().zOrder.at(-1)).toBe('file:readme')
    expect(useWindows.getState().zOrder.filter((r) => r === 'file:readme')).toHaveLength(1)
  })

  it('focusing the already-front selected window does not churn state', () => {
    let sets = 0
    const unsubscribe = useWindows.subscribe(() => {
      sets += 1
    })
    useWindows.getState().focus('runtime')
    expect(sets).toBe(0)
    unsubscribe()
  })

  it('focusing an already-front unselected window only selects it', () => {
    useWindows.setState(initialWindows())
    useWindows.setState({ selected: 'desk' })
    let sets = 0
    const unsubscribe = useWindows.subscribe(() => {
      sets += 1
    })
    useWindows.getState().focus('runtime')
    expect(sets).toBe(1)
    expect(useWindows.getState().zOrder).toEqual(['desk', 'runtime'])
    expect(useWindows.getState().selected).toBe('runtime')
    unsubscribe()
  })
})

describe('window maximize', () => {
  beforeEach(() => {
    useWindows.setState(initialWindows())
  })

  it('maximize spans the full canvas bounds', () => {
    useWindows.getState().maximize('desk', { w: 900, h: 638 })
    expect(useWindows.getState().rects.desk).toEqual({ x: 0, y: 0, w: 900, h: 638 })
    expect(useWindows.getState().maximized).toEqual(['desk'])
  })

  it('un-maximize restores the pre-maximize rect', () => {
    useWindows.getState().maximize('desk', { w: 900, h: 638 })
    useWindows.getState().maximize('desk', { w: 900, h: 638 })
    expect(useWindows.getState().rects.desk).toEqual({ x: 0, y: 0, w: 560, h: 480 })
    expect(useWindows.getState().maximized).toEqual([])
  })

  it('committing a resize on a maximized window makes it the new normal rect', () => {
    useWindows.getState().maximize('desk', { w: 900, h: 638 })
    useWindows.getState().commit('desk', { x: 12, y: 14, w: 640, h: 520 })
    expect(useWindows.getState().maximized).toEqual([])
    expect(useWindows.getState().rects.desk).toEqual({ x: 12, y: 14, w: 640, h: 520 })
    useWindows.getState().maximize('desk', { w: 900, h: 638 })
    expect(useWindows.getState().rects.desk).toEqual({ x: 0, y: 0, w: 900, h: 638 })
    useWindows.getState().maximize('desk', { w: 900, h: 638 })
    expect(useWindows.getState().rects.desk).toEqual({ x: 12, y: 14, w: 640, h: 520 })
  })

  it('refit re-spans every maximized window to new bounds and leaves others alone', () => {
    useWindows.getState().openRoute('network')
    useWindows.getState().maximize('desk', { w: 900, h: 638 })
    useWindows.getState().maximize('network', { w: 900, h: 638 })
    useWindows.getState().refit({ w: 1000, h: 700 })
    expect(useWindows.getState().rects.desk).toEqual({ x: 0, y: 0, w: 1000, h: 700 })
    expect(useWindows.getState().rects.network).toEqual({ x: 0, y: 0, w: 1000, h: 700 })
    expect(useWindows.getState().maximized).toEqual(['desk', 'network'])
  })

  it('refit with no maximized windows does nothing', () => {
    let sets = 0
    const unsubscribe = useWindows.subscribe(() => {
      sets += 1
    })
    useWindows.getState().refit({ w: 1000, h: 700 })
    expect(sets).toBe(0)
    unsubscribe()
  })
})
