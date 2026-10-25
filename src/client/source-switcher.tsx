import { useEffect, useRef, useState } from 'react'
import type { WorkSource } from '../work-sources/types.ts'
import { PanelIcon } from './icons.tsx'
import styles from './work-panel.module.css'

interface Choice { value: string; source: WorkSource }
const parts = (source: WorkSource) => ({
  owner: source.repository?.owner ?? source.githubProject?.owner ?? '',
  name: source.repository?.repository ?? source.projectSnapshot?.project.title ?? source.title ?? `Project #${source.githubProject?.number}`,
})
export function SourceSwitcher({ options, value, onSelect }: { options: Choice[]; value?: string; onSelect: (value: string) => void }) {
  const [open, setOpen] = useState(false), [search, setSearch] = useState(''), [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), input = useRef<HTMLInputElement>(null)
  const selected = options.find(option => option.value === value)
  const current = selected ? parts(selected.source) : null
  const filtered = options.filter(option => { const item = parts(option.source); return `${item.owner}/${item.name}`.toLowerCase().includes(search.trim().toLowerCase()) })
  const close = () => { setOpen(false); trigger.current?.focus() }
  const choose = (option: Choice) => { close(); if (option.value !== value) onSelect(option.value) }
  const show = () => { setSearch(''); setActive(Math.max(0, options.findIndex(option => option.value === value))); setOpen(true) }
  useEffect(() => {
    if (!open) return
    input.current?.focus()
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])
  useEffect(() => { setOpen(false) }, [value])
  useEffect(() => { if (open) root.current?.querySelector('[data-active=true]')?.scrollIntoView({ block: 'nearest' }) }, [active, open])
  return <div ref={root} className={styles.sourceSwitcher} onKeyDown={event => {
    if (event.nativeEvent?.isComposing) return
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close() }
    if (event.key === 'Tab' && open) setOpen(false)
    if (event.key === 'Enter' && open) { event.preventDefault(); if (filtered[active]) choose(filtered[active]) }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) show()
      else if (filtered.length) setActive(index => (index + (event.key === 'ArrowDown' ? 1 : filtered.length - 1)) % filtered.length)
    }
  }}>
    <button ref={trigger} type="button" className={styles.sourceSwitchTrigger} aria-label="当前 GitHub 仓库或 Project" aria-haspopup="dialog" aria-expanded={open} aria-controls="a2d2-source-switcher" title={current ? `${current.owner}/${current.name}` : '选择来源'} onClick={() => open ? close() : show()}>
      {current ? <><span>{current.owner} /</span><strong>{current.name}</strong></> : <strong>选择来源</strong>}<PanelIcon name="chevron" size={12}/>
    </button>
    {open&&<div id="a2d2-source-switcher" className={styles.sourceSwitchMenu} role="dialog" aria-label="切换来源">
      <div className={styles.sourceSwitchSearch}><PanelIcon name="search"/><input ref={input} type="search" role="combobox" aria-label="搜索来源" aria-expanded="true" aria-controls="a2d2-source-options" aria-activedescendant={filtered[active]?`a2d2-source-option-${active}`:undefined} value={search} placeholder="搜索仓库" onChange={event => { setSearch(event.target.value); setActive(0) }}/></div>
      <div id="a2d2-source-options" className={styles.sourceSwitchOptions} role="listbox" aria-label="已添加来源">
        {filtered.map((option, index) => { const item = parts(option.source); return <button key={option.value} id={`a2d2-source-option-${index}`} type="button" role="option" tabIndex={-1} aria-selected={option.value===value} data-active={index===active} title={`${item.owner}/${item.name}`} onMouseMove={() => setActive(index)} onClick={() => choose(option)}><PanelIcon name={option.source.repository?'repo':'project'}/><span><strong>{item.name}</strong><small>{item.owner}{option.source.githubProject?' · Project':''}</small></span>{option.value===value&&<PanelIcon name="check"/>}</button> })}
        {!filtered.length&&<p role="status">没有匹配的来源</p>}
      </div>
    </div>}
  </div>
}
