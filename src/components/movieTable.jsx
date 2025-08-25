// src/components/MovieTable.jsx
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';


const SortIcon = ({ dir }) => (dir === 'asc' ? '▲' : '▼');
const alignClass = (a) => (a ? `align-${a}` : '');
const getBp = (w) => (w <= 680 ? 'mobile' : w <= 1024 ? 'tablet' : 'desktop');
const defaultCaps = { mobile: 4, tablet: 6, desktop: Infinity };

export default function MovieTable({
                                       rows,
                                       columns,
                                       initialSort = { key: columns.find(c => c.sortable)?.key ?? columns[0]?.key, dir: 'desc' },
                                       initialVisibleKeys,
                                       onRowClick,
                                       filterPlaceholder = 'Filtrer (FR, VO, studio)…',
                                       enableQuickFilter = true,
                                       caps = defaultCaps,
                                       hidePickerOnMobile = false,
                                       searchAccessors,
                                       mobileMode = 'auto',          // 'auto' | 'table' | 'cards'
                                   }) {
    const allKeys = columns.map(c => c.key);
    const [sort, setSort] = useState(initialSort);
    const [visible, setVisible] = useState(new Set(initialVisibleKeys?.length ? initialVisibleKeys : allKeys));
    const [query, setQuery] = useState('');
    const [bp, setBp] = useState(getBp(typeof window !== 'undefined' ? window.innerWidth : 1200));

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onResize = () => setBp(getBp(window.innerWidth));
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    // cap columns per breakpoint
    const cappedVisible = useMemo(() => {
        const cap = caps[bp] ?? Infinity;
        const required = columns.filter(c => c.required).map(c => c.key);
        const kept = columns.filter(c => required.includes(c.key)).map(c => c.key);
        const selectedNonReq = columns
            .filter(c => !c.required && visible.has(c.key))
            .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
        for (const c of selectedNonReq) { if (kept.length >= cap) break; if (!kept.includes(c.key)) kept.push(c.key); }
        if (kept.length === 0) { for (const k of required) { if (kept.length >= cap) break; kept.push(k); } }
        return new Set(kept);
    }, [visible, columns, bp, caps]);

    const visibleColumns = useMemo(() => columns.filter(c => cappedVisible.has(c.key)), [columns, cappedVisible]);

    const handleToggleColumn = (key) => {
        const col = columns.find(c => c.key === key);
        if (col?.required) return;
        const isShown = cappedVisible.has(key);
        const atCap = visibleColumns.length >= (caps[bp] ?? Infinity);
        if (!isShown && atCap) return;
        setVisible(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });
    };

    const handleSort = (key) => setSort(prev => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' });

    // filter (FR + VO + studio), accent-insensitive
    const filteredRows = useMemo(() => {
        if (!enableQuickFilter || !query.trim()) return rows;
        const norm = (s) => (s ?? '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const accessors = searchAccessors?.length ? searchAccessors : [r => r.fr_title, r => r.title, r => r.studio_name];
        const q = norm(query);
        return rows.filter(r => accessors.some(fn => norm(fn?.(r)).includes(q)));
    }, [rows, query, enableQuickFilter, searchAccessors]);

    // sort
    const sortedRows = useMemo(() => {
        const col = columns.find(c => c.key === sort.key) ?? columns[0];
        const get = (row) => col?.sortValue ? col.sortValue(row) : (col?.value ? col.value(row) : row?.[col?.key]);
        const arr = [...filteredRows];
        arr.sort((a, b) => {
            const va = get(a), vb = get(b);
            if (typeof va === 'string' || typeof vb === 'string') {
                const cmp = String(va ?? '').localeCompare(String(vb ?? ''), 'fr');
                return sort.dir === 'asc' ? cmp : -cmp;
            }
            const na = va ?? Number.NEGATIVE_INFINITY, nb = vb ?? Number.NEGATIVE_INFINITY;
            return na === nb ? 0 : (sort.dir === 'asc' ? na - nb : nb - na);
        });
        return arr;
    }, [filteredRows, columns, sort]);


    // resolve widths per breakpoint
    const widthFor = (col) =>
        bp === 'mobile' && col.mobileWidthPct != null ? col.mobileWidthPct :
            bp === 'tablet' && col.tabletWidthPct != null ? col.tabletWidthPct :
                col.widthPct;

    const shownCount = visibleColumns.length;
    const cap = caps[bp] ?? Infinity;

    // ====== MOBILE CARD MODE ======
    if (bp === 'mobile' && (mobileMode === 'cards' || mobileMode === 'auto')) {
        const fields = visibleColumns.filter(c => c.key !== 'title').slice(0, Math.max(0, (caps.mobile ?? 4) - 1));
        return (
            <div className="mobile-cards">
                {enableQuickFilter && (
                    <div className="mobile-filter">
                        <input
                            className="table-filter-input"
                            placeholder={filterPlaceholder}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                        <details className="columns-popover">
                            <summary className="columns-button">
                                <span className="columns-label">Colonnes</span>
                                <span className="columns-badge">{shownCount}</span>
                                <svg className="chev" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                                    <path d="M5 7l5 6 5-6" fill="none" stroke="currentColor" strokeWidth="2" />
                                </svg>
                            </summary>
                            <div className="columns-panel">
                                <div className="picker-caption">
                                    {Number.isFinite(cap) ? `${shownCount}/${cap} visibles` : `${shownCount} visibles`}
                                </div>
                                <div className="columns-grid">
                                    {columns.map(c => {
                                        const isRequired = !!c.required;
                                        const isChecked = cappedVisible.has(c.key);
                                        const atCap = shownCount >= cap;
                                        const disabled = isRequired || (!isChecked && atCap);
                                        return (
                                            <label key={c.key} className={`picker-item ${disabled ? 'disabled' : ''}`}>
                                                <input
                                                    type="checkbox"
                                                    checked={isChecked}
                                                    disabled={disabled}
                                                    onChange={() => handleToggleColumn(c.key)}
                                                />
                                                <span>{c.label}{isRequired ? ' *' : ''}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>
                        </details>
                    </div>
                )}

                <div className="mobile-card-list">
                    {sortedRows.map(row => (
                        <div key={row.id} className="mobile-card" onClick={onRowClick ? () => onRowClick(row) : undefined}>
                            <div className="mobile-card-title">
                                <div className="movie-title-wrap">
                                    <Link to={`/movies/${row.id}`} className="movie-title-fr">{row.fr_title || row.title || '—'}</Link>
                                    {row.title && row.title !== row.fr_title && <span className="movie-title-vo">{row.title}</span>}
                                </div>
                            </div>
                            <dl className="mobile-card-grid">
                                {fields.map(col => {
                                    const v = col.value ? col.value(row) : row[col.key];
                                    const content = col.render ? col.render(v, row) : (v ?? '—');
                                    return (
                                        <div className="mobile-kv" key={col.key}>
                                            <dt>{col.label}</dt>
                                            <dd className={alignClass(col.align)}>{content}</dd>
                                        </div>
                                    );
                                })}
                            </dl>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // ====== TABLE MODE (desktop/tablet, or mobileMode === 'table') ======
    return (
        <div className="table-section">
            <div className="table-toolbar">
                {enableQuickFilter && (
                    <input
                        className="table-filter-input"
                        placeholder={filterPlaceholder}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                )}

                {!(hidePickerOnMobile && bp === 'mobile') && (
                    <details className="columns-popover">
                        <summary className="columns-button">
                            <span className="columns-label">Colonnes</span>
                            <span className="columns-badge">{shownCount}</span>
                            <svg className="chev" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                                <path d="M5 7l5 6 5-6" fill="none" stroke="currentColor" strokeWidth="2" />
                            </svg>
                        </summary>
                        <div className="columns-panel">
                            <div className="picker-caption">
                                {Number.isFinite(cap) ? `${shownCount}/${cap} visibles` : `${shownCount} visibles`}
                            </div>
                            <div className="columns-grid">
                                {columns.map(c => {
                                    const isRequired = !!c.required;
                                    const isChecked = cappedVisible.has(c.key);
                                    const atCap = shownCount >= cap;
                                    const disabled = isRequired || (!isChecked && atCap);
                                    return (
                                        <label key={c.key} className={`picker-item ${disabled ? 'disabled' : ''}`}>
                                            <input type="checkbox" checked={isChecked} disabled={disabled} onChange={() => handleToggleColumn(c.key)} />
                                            <span>{c.label}{isRequired ? ' *' : ''}</span>
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    </details>
                )}
            </div>

            <div className="table-container">
                <table className="box-office-table">
                    <colgroup>
                        {visibleColumns.map(col => (
                            <col
                                key={col.key}
                                className={`col-${col.key}`}
                                style={widthFor(col) != null ? { width: `${widthFor(col)}%` } : undefined}
                            />
                        ))}
                    </colgroup>
                    <thead>
                    <tr>
                        {visibleColumns.map(col => (
                            <th
                                key={col.key}
                                className={`${col.headerClassName ?? ''} ${alignClass(col.headerAlign || col.align)} ${col.sortable ? 'sortable' : ''}`}
                                onClick={col.sortable ? () => handleSort(col.key) : undefined}
                            >
                                <div className="th-inner">
                                    <span>{col.label}</span>
                                    {col.sortable && sort.key === col.key && <SortIcon dir={sort.dir} />}
                                </div>
                            </th>
                        ))}
                    </tr>
                    </thead>
                    <tbody>
                    {sortedRows.map(row => (
                        <tr key={row.id} className={onRowClick ? 'row-clickable' : undefined} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                            {visibleColumns.map(col => {
                                const v = col.value ? col.value(row) : row[col.key];
                                return (
                                    <td key={col.key} className={`${typeof col.className === 'function' ? col.className(row) : (col.className || '')} ${alignClass(col.align)}`}>
                                        {col.render ? col.render(v, row) : (v ?? '—')}
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
