import type { ReactNode } from 'react'
import { PanelIcon } from './icons.tsx'
import styles from './work-panel.module.css'

interface Props {
  label: string
  placeholder: string
  searchTitle: string
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  count: ReactNode
  disabled?: boolean
  filtersOpen: boolean
  filterCount: number
  filterId: string
  onToggleFilters: () => void
  children: ReactNode
}
/** Shared geometry for source lists; callers retain their query semantics. */
export function ListQueryBar({ label, placeholder, searchTitle, value, onChange, onSubmit, count, disabled, filtersOpen, filterCount, filterId, onToggleFilters, children }: Props) {
  return <form className={styles.issueQuery} onSubmit={event => { event.preventDefault(); onSubmit() }}>
    <div className={styles.issueQueryBar}>
      <div className={styles.issueSearch}><input type="search" aria-label={label} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder}/><button type="submit" aria-label={label} title={searchTitle} disabled={disabled}><PanelIcon name="search"/></button></div>
      <button type="button" className={styles.issueFilterToggle} aria-expanded={filtersOpen} aria-controls={filterId} disabled={disabled} onClick={onToggleFilters}><PanelIcon name="filter"/>筛选{filterCount>0&&<span>{filterCount}</span>}</button>
      <span className={styles.issueResultCount} role="status">{count}</span>
    </div>
    {filtersOpen&&<div id={filterId} className={styles.issueFilterPanel}>{children}</div>}
  </form>
}
