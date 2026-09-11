export type RouteId =
  'desk' | 'runtime' | 'network' | 'flightRecorder' | 'airlock' | 'zeroBot' | 'skillLab'

export const ROUTE_TITLES: Record<RouteId, string> = {
  desk: 'Desk',
  runtime: 'Runtime',
  network: 'Network',
  flightRecorder: 'Flight Recorder',
  airlock: 'Airlock',
  zeroBot: 'Zero Bot',
  skillLab: 'Skill Lab'
}

export type Anchor = { x: 0 | 1; y: 0 | 1 }

export const resizeAnchor = (direction: string): Anchor => {
  const d = direction.toLowerCase()
  return {
    x: d.includes('left') ? 1 : 0,
    y: d.includes('top') ? 1 : 0
  }
}

export const transformOrigin = (a: Anchor): string =>
  `${a.x ? '100%' : '0%'} ${a.y ? '100%' : '0%'}`

export const previewTransform = (
  direction: string,
  committed: { w: number; h: number },
  preview: { w: number; h: number } | null
): { scale: { x: number; y: number }; origin: string } | null => {
  if (!preview) return null
  const a = resizeAnchor(direction)
  return {
    scale: { x: preview.w / committed.w, y: preview.h / committed.h },
    origin: transformOrigin(a)
  }
}
