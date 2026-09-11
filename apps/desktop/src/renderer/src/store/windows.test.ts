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
})
