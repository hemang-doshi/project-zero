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
})
