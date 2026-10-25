import { PanelIcon } from './icons.tsx'
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { emptyListState, groupList, listOptions, moveColumn, orderedColumns, queryList, reconcileListState, valueLabel } from './list-state.ts'
import type { ListColumn, ListState } from './list-state.ts'
import { columnMenuPosition } from './column-menu-position.ts'
import styles from './work-panel.module.css'

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export interface TableColumn<T> extends ListColumn<T> {
  render: (row: T, transformed: boolean) => ReactNode
  width?: number
  qualifiers?: ListColumn<T>[]
}
interface Props<T> {
  label: string
  columns: TableColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  searchText: (row: T) => string
  searchLabel: string
  searchControl?: { value: string; onChange: (value: string) => void }
  scope: string
  /** Rebuild hierarchy and apply collapse within each matching group, before batching. */
  arrangeRows?: (rows: T[]) => T[]
  /** Remote Issue pages are appended by the controller; snapshots use local batches. */
  remote?: { hasMore: boolean; loading: boolean; error: string | null; loadMore: () => void; retry: () => void }
  resetKey?: string
  complete?: boolean
  unavailable?: string
  compact?: boolean
  toolbarContent?: ReactNode
  emptyState?: ReactNode
}
/** Shared read-only table. Its state is remounted at source/view boundaries. */
export function InteractiveTable<T>({ label, columns, rows, arrangeRows, rowKey, searchText, searchLabel, searchControl, scope, remote, resetKey, complete = true, unavailable, compact = false, toolbarContent, emptyState }: Props<T>) {
  const [storedState, setState] = useState(emptyListState)
  const [batch, setBatch] = useState({ key: '', count: 100, rows: rows.length })
  const [menu, setMenu] = useState<string | null>(null)
  const [picker, setPicker] = useState<string | null>(null)
  const [valueSearch, setValueSearch] = useState('')
  const button = useRef<HTMLButtonElement | null>(null)
  const popup = useRef<HTMLDivElement | null>(null)
  const all = columns.flatMap(column => [column, ...(column.qualifiers ?? [])])
  const state = reconcileListState(searchControl ? { ...storedState, search: searchControl.value } : storedState, all)
  const columnIds = JSON.stringify(all.map(column => column.id))
  useEffect(() => {
    const available: {id:string}[] = (JSON.parse(columnIds) as string[]).map(id => ({id}))
    setState(current => reconcileListState(current, available)); setMenu(null); setPicker(null)
  }, [columnIds])
  const shown = orderedColumns(columns, state) as TableColumn<T>[]
  const transformed = Boolean(state.sort || state.group || state.search || Object.values(state.filters).some(values => values.length) || state.slice)
  const matched = queryList(rows, all, state, searchText)
  const group = columns.find(column => column.id === state.group)
  const arrangedGroups = arrangeRows ? groupList(matched, group).map(entry => ({ ...entry, rows: arrangeRows(entry.rows) })) : []
  const filtered = arrangeRows ? arrangedGroups.flatMap(entry => entry.rows) : matched
  const queryKey = JSON.stringify([resetKey, state.search, state.filters, state.sort, state.group, state.slice])
  const addedRows = remote ? Math.max(0, rows.length - batch.rows) : 0
  const count = batch.key === queryKey ? batch.count + addedRows : 100
  useEffect(() => {
    setBatch(current => current.key === queryKey
      ? { key: queryKey, count: current.count + (remote ? Math.max(0, rows.length - current.rows) : 0), rows: rows.length }
      : { key: queryKey, count: 100, rows: rows.length })
  }, [queryKey, remote ? rows.length : 0])
  const displayed = filtered.slice(0, count)
  const hasLocalMore = count < filtered.length
  const hasMore = hasLocalMore || Boolean(remote?.hasMore)
  const sentinel = useRef<HTMLDivElement | null>(null)
  const tableRegion = useRef<HTMLDivElement | null>(null)
  const anchor = useRef<{ query: string; row: string; top: number } | null>(null)
  const lastQuery = useRef<string | null>(null)
  useBrowserLayoutEffect(() => {
    const region = tableRegion.current, root = region
    if (!region || !root) return
    const currentRows = () => [...region.querySelectorAll<HTMLElement>('tr[data-row-key]')]
    if (lastQuery.current !== queryKey) { root.scrollTop = 0; anchor.current = null }
    else if (anchor.current?.query === queryKey) {
      const previous = anchor.current, row = currentRows().find(row => row.dataset.rowKey === previous.row)
      if (row) root.scrollTop += row.getBoundingClientRect().top - previous.top
    }
    lastQuery.current = queryKey
    const remember = () => {
      const bounds = root.getBoundingClientRect()
      const row = currentRows().find(row => { const rect = row.getBoundingClientRect(); return rect.bottom > bounds.top && rect.top < bounds.bottom })
      anchor.current = row ? { query: queryKey, row: row.dataset.rowKey!, top: row.getBoundingClientRect().top } : null
    }
    remember(); root.addEventListener('scroll', remember, { passive: true })
    return () => root.removeEventListener('scroll', remember)
  })
  useEffect(() => {
    const element = sentinel.current
    if (!element || !hasMore || remote?.loading || remote?.error || unavailable) return
    // Keep batching within the bounded list, independent of panel scrolling.
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      if (hasLocalMore) setBatch({ key: queryKey, count: count + 100, rows: rows.length })
      else remote?.loadMore()
    }, { root: tableRegion.current, rootMargin: '120px 0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [queryKey, count, filtered.length, hasMore, hasLocalMore, remote?.loading, remote?.error, remote?.loadMore, unavailable])
  let remaining = count
  const groups = arrangeRows ? arrangedGroups.map(entry => {
    const rows = entry.rows.slice(0, remaining)
    remaining -= rows.length
    return { ...entry, rows }
  }).filter(entry => entry.rows.length) : groupList(displayed, group)
  const active = columns.find(column => column.id === menu)
  const picking = all.find(column => column.id === picker)
  const change = (update: Partial<ListState>) => { if(update.search!==undefined)searchControl?.onChange(update.search); setState(current => ({ ...current, ...update })) }
  const close = () => { setMenu(null); setPicker(null); setValueSearch(''); button.current?.focus() }
  const reset = () => { setState(emptyListState()); searchControl?.onChange(''); setBatch({ key: '', count: 100, rows: rows.length }); close() }
  const act = (update: Partial<ListState>) => { change(update); close() }
  useEffect(() => {
    if (!menu) return
    const dismiss = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) { setMenu(null); setPicker(null) } }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close() }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const items = [...(popup.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input') ?? [])]
        const at = items.indexOf(document.activeElement as HTMLElement)
        if (at >= 0 && !(document.activeElement instanceof HTMLInputElement)) { event.preventDefault(); items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus() }
      }
    }
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', escape)
    const focusTarget=menu==='__list_options__'?(popup.current?.querySelector<HTMLElement>('input')??popup.current?.querySelector<HTMLElement>('button')):popup.current?.querySelector<HTMLElement>('button:not(:disabled),input')
    focusTarget?.focus()
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape) }
  }, [menu, picker])
  const open = (id: string, target: HTMLButtonElement) => {
    if (menu === id) { close(); return }
    button.current = target; setMenu(id); setPicker(null); setValueSearch('')
  }
  const rect = button.current?.getBoundingClientRect()
  const placement = rect ? columnMenuPosition(rect, {width:window.innerWidth,height:window.innerHeight}) : {left:8,top:8,maxHeight:600}
  const tools = <>
    <div className={styles.listSearch}>
      {!searchControl&&<label>{searchLabel}<input type="search" aria-label={searchLabel} placeholder="标题、#编号或仓库" value={state.search} onChange={event => change({ search: event.target.value })}/></label>}
      {state.search && <button onClick={() => change({ search: '' })}>清空</button>}
      <button title="清除搜索、筛选、排序与分组，恢复默认列" onClick={reset}>重置列表</button>
    </div>
    <p className={styles.listScope} title={scope}>{filtered.length} / {rows.length} 项</p>
  </>
  return <>
    {compact ? <div className={styles.tableOptionsBar}>{toolbarContent}<button type="button" aria-label="列表选项" title="本地筛选与列重置" aria-haspopup="dialog" aria-expanded={menu==='__list_options__'} onClick={event=>open('__list_options__',event.currentTarget)}><PanelIcon name="sliders"/></button></div> : tools}
    {compact&&menu==='__list_options__'&&<div ref={popup} role="dialog" aria-label="列表选项" className={`${styles.columnMenu} ${styles.tableOptions}`} style={placement}><div className={styles.columnMenuTitle}><strong>本地列表选项</strong><button type="button" aria-label="关闭列表选项" onClick={close}><PanelIcon name="close"/></button></div>{tools}</div>}
    <div className={styles.activeFilters} aria-label="当前列条件">
      {compact && !searchControl && state.search && <button onClick={() => change({ search: '' })}>搜索：{state.search} ×</button>}
      {Object.entries(state.filters).filter(([, values]) => values.length).map(([id, values]) => <button key={id} onClick={() => change({ filters: { ...state.filters, [id]: [] } })} title="点击清除筛选">{all.find(column => column.id === id)?.label}：{values.map(valueLabel).join(' / ')} ×</button>)}
      {state.sort && <button onClick={() => change({ sort: null })}>排序：{columns.find(column => column.id === state.sort?.id)?.label} {state.sort.direction === 'asc' ? '↑' : '↓'} ×</button>}
      {group && <button onClick={() => change({ group: null })}>分组：{group.label} ×</button>}
      {state.slice && <label>切片：{columns.find(column => column.id === state.slice?.id)?.label}<select aria-label="列切片值" value={state.slice.value} onChange={event => change({ slice: { id: state.slice!.id, value: event.target.value } })}>{listOptions(columns.find(column => column.id === state.slice?.id)!, rows).map(option => <option key={option.value} value={option.value}>{valueLabel(option.value)}（{option.count}）</option>)}</select><button onClick={() => change({ slice: null })}>清除切片</button></label>}
      {state.hidden.map(id => <button key={id} onClick={() => change({ hidden: state.hidden.filter(value => value !== id) })}>显示 {columns.find(column => column.id === id)?.label}</button>)}
    </div>
    <div ref={tableRegion} className={styles.tableScroll} role="region" aria-label={`${label} 滚动区域`} tabIndex={0}>{(!compact || rows.length > 0) && <table className={styles.projectTable} aria-label={label} style={{minWidth:shown.reduce((total,column)=>total+Math.max(100,(column.width??1)*90),0)}}>
      <colgroup>{shown.map(column => <col key={column.id} style={{ width: `${100 * (column.width ?? 1) / shown.reduce((sum, entry) => sum + (entry.width ?? 1), 0)}%` }}/>)}</colgroup>
      <thead><tr>{shown.map(column => <th key={column.id} scope="col" className={state.selected === column.id ? styles.columnSelected : undefined} aria-sort={state.sort?.id === column.id ? state.sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}><div className={styles.columnHead}><span>{column.label}{state.sort?.id === column.id ? state.sort.direction === 'asc' ? ' ↑' : ' ↓' : ''}{state.filters[column.id]?.length ? ' ⏷' : ''}</span><button aria-label={`${column.label} 列操作`} aria-haspopup="dialog" aria-expanded={menu === column.id} onClick={event => open(column.id, event.currentTarget)}>⋯</button></div></th>)}</tr></thead>
      <tbody>{groups.map(entry => <Fragment key={entry.value}>{group && <tr className={styles.groupHeading}><th colSpan={shown.length} scope="rowgroup" title="多值条目可能出现在多个组中">{group.label}：{valueLabel(entry.value)} · {entry.rows.length} 项</th></tr>}{entry.rows.map(row => <tr key={`${entry.value}/${rowKey(row)}`} data-row-key={`${entry.value}/${rowKey(row)}`}>{shown.map(column => <td key={column.id} className={state.selected === column.id ? styles.columnSelected : undefined}><div className={styles.cellClip}>{column.render(row, transformed)}</div></td>)}</tr>)}</Fragment>)}</tbody>
    </table>}
    {unavailable ? <p role="status">{unavailable}</p> : !filtered.length && (rows.length===0 && emptyState ? emptyState : compact ? <div className={styles.issueEmpty} role="status"><h3>没有匹配的结果</h3><p>调整搜索内容，或清除列表内的筛选条件。</p><button onClick={reset}>清除筛选</button></div> : <p role="status">当前搜索与列过滤没有匹配结果；可清空或清除列条件。</p>)}
    <div ref={sentinel} role="status" aria-label={`${label} 加载状态`}>
      {remote?.error ? <p role="alert">后续读取失败，保留已加载内容：{remote.error} <button onClick={remote.retry} disabled={remote.loading}>重试</button></p>
        : remote?.loading ? <p>正在加载更多…</p>
        : !unavailable && (!compact || hasMore || !complete) && <p>{hasMore ? '继续滚动加载' : !complete ? '部分结果' : `共 ${displayed.length} 项`}</p>}
    </div>
    </div>
    {active && <div ref={popup} role="dialog" aria-label={`${active.label} 列菜单`} className={styles.columnMenu} style={placement}>
      <div className={styles.columnMenuTitle}><strong>{active.label}</strong><button aria-label="关闭列菜单" onClick={close}>×</button></div>
      {picking ? <>
        <button onClick={() => { setPicker(null); setValueSearch('') }}>← 返回</button><strong>按值过滤：{picking.label}</strong>
        <input aria-label="查找字段值" placeholder="查找字段值" value={valueSearch} onChange={event => setValueSearch(event.target.value)}/>
        <div className={styles.columnValues}>{listOptions(picking, rows).filter(option => valueLabel(option.value).toLocaleLowerCase().includes(valueSearch.toLocaleLowerCase())).map(option => <label key={option.value}><input type="checkbox" checked={state.filters[picking.id]?.includes(option.value) ?? false} onChange={event => change({ filters: { ...state.filters, [picking.id]: event.target.checked ? [...(state.filters[picking.id] ?? []), option.value] : (state.filters[picking.id] ?? []).filter(value => value !== option.value) } })}/><span>{valueLabel(option.value)}</span><small>{option.count}</small></label>)}</div>
        {!rows.length && <p>当前范围尚无可供选择的字段值。</p>}<button onClick={() => change({ filters: { ...state.filters, [picking.id]: [] } })}>清除筛选</button>
      </> : <>
        <button onClick={() => act({ selected: active.id })}>选择整列</button>
        <button disabled={!!active.unsupported} title={active.unsupported} onClick={() => act({ sort: { id: active.id, direction: 'asc' } })}>升序</button>
        <button disabled={!!active.unsupported} title={active.unsupported} onClick={() => act({ sort: { id: active.id, direction: 'desc' } })}>降序</button>
        <button disabled={!!active.unsupported} title={active.unsupported} onClick={() => setPicker(active.id)}>筛选…</button>
        {active.qualifiers?.map(qualifier => <button key={qualifier.id} onClick={() => setPicker(qualifier.id)}>{qualifier.label}…</button>)}
        <button disabled={!active.groupable || !!active.unsupported} title={active.unsupported ?? (!active.groupable ? '此列为连续值或标识，不支持分组' : undefined)} onClick={() => act({ group: active.id })}>分组</button>
        <button disabled={!active.groupable || !!active.unsupported || !rows.length} title={active.unsupported ?? (!active.groupable ? '此列为连续值或标识，不支持切片' : !rows.length ? '当前范围尚无字段值' : undefined)} onClick={() => act({ slice: { id: active.id, value: listOptions(active, rows)[0]!.value } })}>切片</button>
        <button disabled={active.protected} title={active.protected ? '基础标题列不能隐藏，保留条目入口' : undefined} onClick={() => act({ hidden: [...state.hidden, active.id], ...(state.selected === active.id ? { selected: null } : {}) })}>隐藏列</button>
        {(['left', 'right', 'first', 'last'] as const).map(target => { const at = shown.findIndex(column => column.id === active.id), blocked = target === 'left' || target === 'first' ? at === 0 : at === shown.length - 1; return <button key={target} disabled={blocked} title={blocked ? (at === 0 ? '已是最左列' : '已是最右列') : undefined} onClick={() => act({ order: [...moveColumn(shown.map(column => column.id), active.id, target), ...state.hidden] })}>{({ left: '左移', right: '右移', first: '置于最左', last: '置于最右' })[target]}</button> })}
        {active.unsupported && <p>{active.unsupported}</p>}
      </>}
    </div>}
  </>
}
