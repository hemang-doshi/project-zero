import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ROUTES } from './registry'

const ALL_IDS = [
  'desk',
  'runtime',
  'network',
  'flightRecorder',
  'airlock',
  'zeroBot',
  'skillLab'
] as const

describe('ROUTES registry', () => {
  it('registers every route id', () => {
    expect(Object.keys(ROUTES).sort()).toEqual([...ALL_IDS].sort())
  })

  it('registers every route as a component', () => {
    for (const id of ALL_IDS) {
      expect(createElement(ROUTES[id]).type).toBeTruthy()
    }
  })

  it('renders every registered route', () => {
    for (const id of ALL_IDS) {
      const html = renderToString(createElement(ROUTES[id]))
      expect(html.length).toBeGreaterThan(0)
    }
  })
})
