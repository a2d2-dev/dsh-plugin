/**
 * Type face for CSS-module imports in this bundle.
 *
 * The build compiles `*.module.css` into a hashed class map (see
 * `tsdown.config.ts`), so a class name that does not exist in the stylesheet
 * resolves to `undefined` and renders no class. Declaring the map's keys here
 * makes that a compile error instead.
 *
 * @module @deepseek-ai/dsh-a2d2/client/css
 */

declare module '*.module.css' {
  const classes: {
    readonly root: string
    readonly water: string
    readonly readout: string
    readonly tokens: string
    readonly cost: string
    readonly normal: string
    readonly warn: string
    readonly critical: string
    readonly anchor: string
    readonly action: string
    readonly card: string
    readonly cardTitle: string
    readonly cardHint: string
    readonly cardInput: string
    readonly cardRow: string
    readonly cardButton: string
    readonly cancel: string
    readonly confirm: string
    readonly cardError: string
    readonly cardBusy: string
    readonly actions: string
    readonly degraded: string
    readonly attribution: string
    readonly highwayMap: string
    readonly highwayPlacard: string
    readonly highwayAside: string
    readonly highwayStations: string
    readonly highwayStation: string
    readonly highwayMarker: string
    readonly highwayText: string
    readonly highwayName: string
    readonly highwayRole: string
    readonly highwayModel: string
    readonly highwayPassed: string
    readonly highwayCurrent: string
    readonly highwayNext: string
    readonly highwayAhead: string
    readonly nextLine: string
    readonly chips: string
    readonly chip: string
    readonly chipMove: string
    readonly chipLabel: string
    readonly chipEffect: string
    readonly otherMoves: string
    readonly otherMovesSummary: string
    readonly otherMoveGrid: string
    readonly otherMoveButton: string
    readonly otherMoveLabel: string
    readonly otherMoveHint: string
    readonly position: string
    readonly statusBlock: string
    readonly statusHeadline: string
    readonly statusDot: string
    readonly statusFacts: string
    readonly statusWaiting: string
    readonly statusAlert: string
    readonly statusRunning: string
    readonly statusQuiet: string
    readonly header: string
    readonly own: string
    readonly list: string
    readonly label: string
    readonly meta: string
    readonly route: string
    readonly routeDrifted: string
    readonly routeUnknown: string
    readonly empty: string
  }
  export default classes
}
