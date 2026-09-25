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
