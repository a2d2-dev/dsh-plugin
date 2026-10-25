export interface ClientIconProps {
  readonly size?: number
  readonly className?: string
}

/** Multi-agent orchestration glyph: three agents linked by handoff edges. */
export const IconA2d2AgentsOutline16 = ({ size = 16, className }: ClientIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M6.7 5.15 4.9 9.35M9.3 5.15l1.8 4.2M6.2 11.5h3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="8" cy="3.75" r="1.9" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="4.25" cy="11.75" r="1.9" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="11.75" cy="11.75" r="1.9" stroke="currentColor" strokeWidth="1.5" />
  </svg>
)

export type PanelIconName = 'copy' | 'back' | 'refresh' | 'plus' | 'check' | 'clock' | 'alert' | 'pause' | 'loader' | 'repo' | 'project' | 'chevron' | 'close' | 'external' | 'logout' | 'link' | 'play' | 'search' | 'filter' | 'sliders'
const panelIconPaths: Record<PanelIconName, string> = {
  copy: 'M6 6h8v8H6V6ZM10 3V2H2v8h1',
  back: 'M13 8H3m5-5L3 8l5 5',
  search: 'M7 2a5 5 0 1 0 0 10A5 5 0 0 0 7 2Zm4 9 3 3',
  sliders: 'M3 2v12M8 2v12m5-12v12M1 5h4m1 6h4m1-7h4',
  filter: 'M2 4h12M4 8h8m-6 4h4',
  refresh: 'M13 5A5.5 5.5 0 1 0 13.4 10M13 1.5V5H9.5',
  plus: 'M8 3v10M3 8h10',
  check: 'M3 8l3 3 7-7',
  clock: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2Zm0 3v3l2 1',
  alert: 'M8 2 1.5 13h13L8 2Zm0 4v3m0 2v.1',
  pause: 'M5.5 3v10m5-10v10',
  loader: 'M8 2a6 6 0 0 1 6 6',
  repo: 'M4 2h9v12H4a2 2 0 0 1 0-4h9M4 2a2 2 0 0 0-2 2v8M5 5h4',
  project: 'M2 3h12v10H2V3Zm4 0v10m4-10v10',
  chevron: 'm4 6 4 4 4-4',
  close: 'm4 4 8 8m0-8-8 8',
  external: 'M6 3H3v10h10v-3M9 2h5v5m0-5L7 9',
  logout: 'M6 2H2v12h4m4-10 4 4-4 4m4-4H6',
  link: 'M6.5 5.5 8 4a3 3 0 0 1 4 4l-1.5 1.5m-1-3L8 8l-1.5 1.5m-1-3L4 8a3 3 0 0 0 4 4l1.5-1.5',
  play: 'm5 3 8 5-8 5V3Z',
}
/** Small, consistent outline icons for panel controls; names live on their parent. */
export function PanelIcon({ name, size = 16, className }: ClientIconProps & { name: PanelIconName }) {
  return <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={panelIconPaths[name]}/></svg>
}
