import type { FC } from 'react'
import { ROUTE_TITLES, type RouteId } from '../desktop/canvas'
import { DeskRoute } from './DeskRoute'
import { FlightRecorderRoute } from './FlightRecorderRoute'
import { NetworkRoute } from './NetworkRoute'
import { RuntimeRoute } from './RuntimeRoute'

const stub = (id: RouteId): FC => {
  const Route = (): React.JSX.Element => <div className="zw-route">{ROUTE_TITLES[id]}</div>
  return Route
}

export const ROUTES: Record<RouteId, FC> = {
  desk: DeskRoute,
  runtime: RuntimeRoute,
  network: NetworkRoute,
  flightRecorder: FlightRecorderRoute,
  airlock: stub('airlock'),
  zeroBot: stub('zeroBot'),
  skillLab: stub('skillLab')
}
