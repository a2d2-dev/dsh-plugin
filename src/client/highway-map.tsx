/**
 * Reusable read-only highway map component for the boundary card.
 *
 * The future settings page can wrap this component with editable controls while
 * keeping the station drawing contract stable.
 *
 * @module @deepseek-ai/dsh-a2d2/client/highway-map
 */

import { createElement } from 'react'
import type { ReactNode } from 'react'
import css from './orb.module.css'
import type { HighwayView, HighwayViewStation } from './highway-view.ts'

export interface HighwayMapProps {
  readonly view: HighwayView
  readonly mode?: 'readonly' | 'editable'
  readonly renderStationControl?: (station: HighwayViewStation) => ReactNode
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
        ...stationBody(station, props.renderStationControl),
      )),
    ),
  )
}

/**
 * The station's text, optional control, and model chip.
 *
 * Read-only (the boundary card) keeps them as direct grid cells beside the
 * marker. The editable variant (the A2D2 config page) adds a control, which the
 * card's three-column grid has no cell for; there the three pieces share one
 * wrapping cell so a narrow row moves whole pieces onto the next line instead
 * of squeezing any of them into a one-character column.
 */
function stationBody(
  station: HighwayViewStation,
  renderControl: HighwayMapProps['renderStationControl'],
): ReactNode[] {
  const model = stationModelLabel(station)
  const pieces = [
    createElement('span', { className: css.highwayText, key: 'text' },
      createElement('span', { className: css.highwayName }, `/${station.id}`),
      createElement('span', { className: css.highwayRole }, station.role),
    ),
    renderControl === undefined ? null : createElement('span', { className: css.highwayControl, key: 'control' }, renderControl(station)),
    model === undefined ? null : createElement('span', { className: css.highwayModel, key: 'model' }, model),
  ]
  if (renderControl === undefined) return pieces
  return [createElement('span', { className: css.highwayBody, key: 'body' }, ...pieces)]
}

function stationModelLabel(station: HighwayViewStation): string | undefined {
  if (station.agent === undefined) return station.models
  return `${station.agent} · ${station.models ?? '无可用模型'}`
}

function stateClass(state: HighwayView['stations'][number]['state']): string {
  switch (state) {
    case 'passed': return css.highwayPassed
    case 'current': return css.highwayCurrent
    case 'next': return css.highwayNext
    case 'ahead': return css.highwayAhead
  }
}
