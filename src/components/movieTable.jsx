import { useEffect, useMemo, useState, useRef } from 'react';
import { Link } from 'react-router-dom';

const SortIcon = ({ dir }) => (dir === 'asc' ? '▲' : '▼');
const alignClass = (a) => (a ? `align-${a}` : '');

const tmdbPoster = (p, size='w92') => (p ? `https://image.tmdb.org/t/p/${size}${p}` : null);

function LeadCell({ row, shape='rounded', showRank=true }) {
    const poster = tmdbPoster(row.poster_path, 'w92');
    return (
        <div className="lead-wrap">
            {showRank && Number.isFinite(row.rank) && <span className="rank-chip">{row.rank}</span>}
            {poster
                ? <img className={`poster-thumb ${shape}`} src={poster} alt="" loading="lazy" />
                : <div className={`poster-thumb ${shape} placeholder`} />}
        </div>
    );
}

function TitleTextCell({ row }) {
    const hasVO = !!row.title && row.title !== row.fr_title;
    return (
        <div className={`title-text ${hasVO ? 'has-vo' : 'single'}`}>
            <Link to={`/movies/${row.id}`} className="movie-title-fr" title={row.fr_title || row.title || ''}>
                {row.fr_title || row.title || ''}
            </Link>
            {hasVO && <span className="movie-title-vo" title={row.title}>{row.title}</span>}
        </div>
    );
}

export default function MovieTable({
                                       rows,
                                       columns,
                                       initialSort = {
                                           key: columns.find((c) => c.sortable)?.key ?? columns[0]?.key,
                                           dir: 'desc',
                                       },
                                       initialVisibleKeys,
                                       onRowClick,
                                       filterPlaceholder = 'Filtrer (FR, VO, studio)…',
                                       enableQuickFilter = true,
                                       searchAccessors,
                                   }) {
    const allKeys = columns.map((c) => c.key);

    const [sort, setSort] = useState(initialSort);
    // Only track non-required visibility; required columns are always shown.
    const requiredKeys = useMemo(
        () => columns.filter((c) => c.required).map((c) => c.key),
        [columns]
    );
    const [visible, setVisible] = useState(
        new Set(
            (initialVisibleKeys?.length ? initialVisibleKeys : allKeys).filter(
                (k) => !requiredKeys.includes(k)
            )
        )
    );
    const [query, setQuery] = useState('');

    // inside MovieTable()
    const containerRef = useRef(null);
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const onScroll = () => {
            el.classList.toggle('is-scrolling-x', el.scrollLeft > 0);
        };
        onScroll(); // set initial state
        el.addEventListener('scroll', onScroll, { passive: true });
        return () => el.removeEventListener('scroll', onScroll);
    }, []);

    // Visible columns = required + selected (keep original order)
    const visibleColumns = useMemo(
        () =>
            columns.filter((c) => c.required || visible.has(c.key)),
        [columns, visible]
    );

    // Force table remount when visible columns (or widths) change to avoid colgroup cache bugs
    const tableKey = "";

    const handleToggleColumn = (key) => {
        const col = columns.find((c) => c.key === key);
        if (!col || col.required) return; // cannot toggle required
        setVisible((prev) => {
            const next = new Set(prev);
            next.has(key) ? next.delete(key) : next.add(key);
            return next;
        });
    };

    const handleSort = (key) =>
        setSort((prev) =>
            prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }
        );

    // filter (FR + VO + studio), accent-insensitive
    const filteredRows = useMemo(() => {
        if (!enableQuickFilter || !query.trim()) return rows;
        const norm = (s) =>
            (s ?? '')
                .toString()
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '');
        const accessors = searchAccessors?.length
            ? searchAccessors
            : [(r) => r.fr_title, (r) => r.title, (r) => r.studio_name];
        const q = norm(query);
        return rows.filter((r) => accessors.some((fn) => norm(fn?.(r)).includes(q)));
    }, [rows, query, enableQuickFilter, searchAccessors]);

    // sort
    const sortedRows = useMemo(() => {
        const col = columns.find((c) => c.key === sort.key) ?? columns[0];
        const get = (row) =>
            col?.sortValue ? col.sortValue(row) : col?.value ? col.value(row) : row?.[col?.key];
        const arr = [...filteredRows];
        arr.sort((a, b) => {
            const va = get(a),
                vb = get(b);
            if (typeof va === 'string' || typeof vb === 'string') {
                const cmp = String(va ?? '').localeCompare(String(vb ?? ''), 'fr');
                return sort.dir === 'asc' ? cmp : -cmp;
            }
            const na = va ?? Number.NEGATIVE_INFINITY,
                nb = vb ?? Number.NEGATIVE_INFINITY;
            return na === nb ? 0 : sort.dir === 'asc' ? na - nb : nb - na;
        });
        return arr;
    }, [filteredRows, columns, sort]);

    const widthFor = (col) => col.widthPct;
    const shownCount = visibleColumns.length;

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

                <details className="columns-popover">
                    <summary className="columns-button">
                        <span className="columns-label">Colonnes</span>
                        <span className="columns-badge">{shownCount}</span>
                        <svg className="chev" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                            <path d="M5 7l5 6 5-6" fill="none" stroke="currentColor" strokeWidth="2" />
                        </svg>
                    </summary>
                    <div className="columns-panel">
                        <div className="picker-caption">{shownCount} visibles</div>
                        <div className="columns-grid">
                            {columns.map((c) => {
                                const isRequired = !!c.required;
                                const isChecked = isRequired || visible.has(c.key);
                                return (
                                    <label key={c.key} className={`picker-item ${isRequired ? 'disabled' : ''}`}>
                                        <input
                                            type="checkbox"
                                            checked={isChecked}
                                            disabled={isRequired}
                                            onChange={() => handleToggleColumn(c.key)}
                                        />
                                        <span>
                      {c.label}
                                            {isRequired ? ' *' : ''}
                    </span>
                                    </label>
                                );
                            })}
                        </div>
                    </div>
                </details>
            </div>

            <div className="table-container" ref={containerRef}>
                <table className="box-office-table">
                    <colgroup key={`cols-${tableKey}`}>
                        {visibleColumns.map((col) => (
                            <col
                                key={col.key}
                                className={`col-${col.key}`}
                                style={widthFor(col) != null ? { width: `${widthFor(col)}%` } : undefined}
                            />
                        ))}
                    </colgroup>

                    <thead>
                    <tr>
                        {visibleColumns.map((col) => (
                            <th
                                key={col.key}
                                className={`${col.headerClassName ?? ''} ${col.key === 'lead' ? 'lead-sticky' : ''} ${alignClass(col.headerAlign || col.align)} ${col.sortable ? 'sortable' : ''}`}
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
                    {sortedRows.map((row) => {
                        const isFirstWeek = row.week_number === 1;
                        const rowClasses = [
                            onRowClick ? 'row-clickable' : '',
                            isFirstWeek ? 'first-week-movie' : ''
                        ].filter(Boolean).join(' ');

                        return (
                        <tr key={row.id} className={rowClasses || undefined}
                            onClick={onRowClick ? () => onRowClick(row) : undefined}>
                            {visibleColumns.map((col) => {
                                const v = col.value ? col.value(row) : row[col.key];
                                const isLead = col.key === 'lead';
                                const isTitleText = col.isTitle || col.key === 'title' || col.key === 'film';
                                const extraHeader = col.key === 'lead' ? 'lead-sticky' : '';
                                const extraCell   = isLead ? 'lead-sticky lead-cell' : '';

                                return (
                                    <td key={col.key}
                                        className={`${typeof col.className === 'function' ? col.className(row) : col.className || ''} ${alignClass(col.align)} ${extraCell}`}>
                                        {isLead
                                            ? <LeadCell row={row} />
                                            : isTitleText
                                                ? <TitleTextCell row={row} />
                                                : col.render
                                                    ? col.render(v, row)
                                                    : (v ?? '—')}
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
