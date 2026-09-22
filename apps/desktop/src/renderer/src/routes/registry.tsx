import type { FC } from 'react'
import type { RouteId } from '../desktop/canvas'
import { AirlockRoute } from './AirlockRoute'
import { DeskRoute } from './DeskRoute'
import { FlightRecorderRoute } from './FlightRecorderRoute'
import { NetworkRoute } from './NetworkRoute'
import { RuntimeRoute } from './RuntimeRoute'
import { SkillLabRoute } from './SkillLabRoute'
import { ZeroBotRoute } from './ZeroBotRoute'

export const ROUTES: Record<RouteId, FC> = {
  desk: DeskRoute,
  runtime: RuntimeRoute,
  network: NetworkRoute,
  flightRecorder: FlightRecorderRoute,
  airlock: AirlockRoute,
  zeroBot: ZeroBotRoute,
  skillLab: SkillLabRoute
}
