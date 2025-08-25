// src/components/MovieTable.jsx
import { useEffect, useMemo, useState } from 'react';

// ---------- helpers ----------
const SortIcon = ({ dir }) => (dir === 'asc' ? '▲' : '▼');
const alignClass = (a) => (a ? `align-${a}` : '');

// map window width → breakpoint
const getBp = (w) => (w <= 680 ? 'mobile' : w <= 1024 ? 'tablet' : 'desktop');

// default max visible columns per breakpoint (override via props.caps)
const defaultCaps = { mobile: 4, tablet: 6, desktop: Infinity };

export default function MovieTable({
                                       rows,
                                       columns,
                                       initialSort = { key: columns.find(c => c.sortable)?.key ?? columns[0]?.key, dir: 'desc' },
                                       initialVisibleKeys,                 // optional array of column keys to start visible
                                       onRowClick,                         // optional (row) => void
                                       filterPlaceholder = 'Filtrer (titre, studio)…',
                                       enableQuickFilter = true,
                                       caps = defaultCaps,                 // { mobile, tablet, desktop }
                                       hidePickerOnMobile = false,         // true = hide "Colonnes" picker on mobile
                                   }) {
    const allKeys = columns.map(c => c.key);

    const [sort, setSort] = useState(initialSort);
    const [visible, setVisible] = useState(
        new Set(initialVisibleKeys && initialVisibleKeys.length ? initialVisibleKeys : allKeys)
    );
    const [query, setQuery] = useState('');
    const initialWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const [bp, setBp] = useState(getBp(initialWidth));

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onResize = () => setBp(getBp(window.innerWidth));
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    // ---- cap visible columns by breakpoint (always keep 'required' ones; then fill by 'priority') ----
    const cappedVisible = useMemo(() => {
        const cap = caps[bp] ?? Infinity;
        const required = columns.filter(c => c.required).map(c => c.key);

        // start with required, preserving original order
        const kept = columns.filter(c => required.includes(c.key)).map(c => c.key);

        // then add selected, non-required, by priority (lower is more important)
        const selectedNonReq = columns
            .filter(c => !c.required && visible.has(c.key))
            .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));

        for (const c of selectedNonReq) {
            if (kept.length >= cap) break;
            if (!kept.includes(c.key)) kept.push(c.key);
        }

        // fallback: if nothing left, keep as many required as the cap allows
        if (kept.length === 0) {
            for (const k of required) {
                if (kept.length >= cap) break;
                kept.push(k);
            }
        }
        return new Set(kept);
    }, [visible, columns, bp, caps]);

    const visibleColumns = useMemo(
        () => columns.filter(c => cappedVisible.has(c.key)),
        [columns, cappedVisible]
    );

    const handleToggleColumn = (key) => {
        const col = columns.find(c => c.key === key);
        if (col?.required) return; // cannot hide required
        const cap = caps[bp] ?? Infinity;
        const isShown = cappedVisible.has(key);
        const shownCount = visibleColumns.length;

        // trying to show a new column while at cap → block
        if (!isShown && shownCount >= cap) return;

        setVisible(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    };

    const handleSort = (key) => {
        setSort(prev =>
            prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }
        );
    };

    // ---- filter + sort ----
    const filteredRows = useMemo(() => {
        if (!enableQuickFilter || !query.trim()) return rows;
        const q = query.toLowerCase();
        return rows.filter(r => {
            const title = (r.fr_title || r.title || '').toLowerCase();
            const studio = (r.studio_name || '').toLowerCase();
            return title.includes(q) || studio.includes(q);
        });
    }, [rows, query, enableQuickFilter]);

    const sortedRows = useMemo(() => {
        const col = columns.find(c => c.key === sort.key) ?? columns[0];
        const get = (row) => {
            if (col?.sortValue) return col.sortValue(row);
            if (col?.value) return col.value(row);
            return row?.[col?.key];
        };
        const arr = [...filteredRows];
        arr.sort((a, b) => {
            const va = get(a);
            const vb = get(b);
            const isStr = typeof va === 'string' || typeof vb === 'string';
            if (isStr) {
                const cmp = String(va ?? '').localeCompare(String(vb ?? ''), 'fr');
                return sort.dir === 'asc' ? cmp : -cmp;
            }
            const na = va ?? Number.NEGATIVE_INFINITY;
            const nb = vb ?? Number.NEGATIVE_INFINITY;
            if (na === nb) return 0;
            return sort.dir === 'asc' ? na - nb : nb - na;
        });
        return arr;
    }, [filteredRows, columns, sort]);

    // ---- classes ----
    const tdClass = (col, row) => {
        const base =
            typeof col.className === 'function'
                ? col.className(row) || ''
                : (col.className || '');
        return `${base} ${alignClass(col.align)}`.trim();
    };

    const shownCount = visibleColumns.length;
    const cap = caps[bp] ?? Infinity;

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
                )}
            </div>


            <div className="table-container">
                <table className="box-office-table">
                    {/* dynamic widths from visible columns */}
                    <colgroup>
                        {visibleColumns.map(col => (
                            <col
                                key={col.key}
                                className={`col-${col.key}`}
                                style={col.widthPct ? { width: `${col.widthPct}%` } : undefined}
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
                                title={col.sortable ? 'Trier' : undefined}
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
                    {sortedRows.map((row) => {
                        const clickable = !!onRowClick;
                        return (
                            <tr
                                key={row.id}
                                className={clickable ? 'row-clickable' : undefined}
                                onClick={clickable ? () => onRowClick(row) : undefined}
                            >
                                {visibleColumns.map(col => {
                                    const v = col.value ? col.value(row) : row[col.key];
                                    return (
                                        <td key={col.key} className={tdClass(col, row)}>
                                            {col.render ? col.render(v, row) : (v ?? '—')}
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
