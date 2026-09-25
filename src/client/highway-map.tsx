/**
 * Reusable read-only highway map component for the boundary card.
 *
 * The future settings page can wrap this component with editable controls while
 * keeping the station drawing contract stable.
 *
 * @module @deepseek-ai/dsh-a2d2/client/highway-map
 */

import { createElement } from 'react'
import css from './orb.module.css'
import type { HighwayView } from './highway-view.ts'

export interface HighwayMapProps {
  readonly view: HighwayView
  readonly mode?: 'readonly'
}

export function HighwayMap(props: HighwayMapProps): ReturnType<typeof createElement> {
  const { view } = props
  return createElement('div', { className: css.highwayMap, 'data-a2d2-highway-mode': props.mode ?? 'readonly' },
    view.preconditionPlacard === undefined ? null : createElement('div', { className: css.highwayPlacard },
      createElement('div', null, view.preconditionPlacard.title),
      createElement('ul', { className: css.preconditionMissing },
        ...view.preconditionPlacard.missing.map(item => createElement('li', { key: item }, item)),
      ),
    ),
    view.placard === undefined ? null : createElement('div', { className: css.highwayPlacard }, view.placard),
    view.aside === undefined ? null : createElement('div', { className: css.highwayAside }, view.aside),
    createElement('ol', { className: css.highwayStations },
      ...view.stations.map(station => createElement('li', {
        key: station.id,
        className: `${css.highwayStation} ${stateClass(station.state)}`,
        'data-a2d2-station-state': station.state,
      },
        createElement('span', { className: css.highwayMarker, 'aria-hidden': true }, station.state === 'next' ? '→' : ''),
        createElement('span', { className: css.highwayText },
          createElement('span', { className: css.highwayName }, `/${station.id}`),
          createElement('span', { className: css.highwayRole }, station.role),
        ),
        station.models === undefined ? null : createElement('span', { className: css.highwayModel }, station.models),
      )),
    ),
  )
}

function stateClass(state: HighwayView['stations'][number]['state']): string {
  switch (state) {
    case 'passed': return css.highwayPassed
    case 'current': return css.highwayCurrent
    case 'next': return css.highwayNext
    case 'ahead': return css.highwayAhead
  }
}
