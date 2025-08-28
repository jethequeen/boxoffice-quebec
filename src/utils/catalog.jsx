// src/columns/catalog.jsx
// A tiny catalog of reusable column configs + helpers.

/**
 * Creates the full catalog using your app's deps (formatters, Link, etc.)
 * so column renderers stay pure & reusable.
 */
export function createColumnsCatalog({ Link, formatCurrency, pct0, toNum }) {

    const asPct = (v) => {
        const n = toNum(v);
        if (n == null || Number.isNaN(n)) return null;
        // if it's a ratio (0..1), scale to percent; if it's already 0..100, keep it
        return Math.abs(n) <= 1 ? n * 100 : n;
    };

    const title = {
        key: 'title',
        label: 'Film',
        sortable: false,
        required: true,
        priority: 0,
        widthPct: 20,
        mobileWidthPct: 18,
        align: 'left',
        headerAlign: 'left',
        className: 'movie-cell',
        value: (m) => (m.fr_title || m.title || ''),
        render: (value, m) => (
            <div className="movie-title-wrap">
                <Link to={`/movies/${m.id}`} className="movie-title-fr">{value}</Link>
                {m.title && (
                    <span className="movie-title-vo">{m.title}</span>
                )}
            </div>
        ),
    };

    const revenue_qc = {
        key: 'revenue_qc',
        label: 'Recettes',
        sortable: true,
        priority: 1,
        widthPct: 9,
        mobileWidthPct: 18,
        align: 'center',
        headerAlign: 'center',
        value: (m) => m.revenue_qc,
        render: (v) => formatCurrency(v),
    };

    const change_percent = {
        key: 'change_percent',
        label: 'Delta',
        sortable: true,
        priority: 2,
        widthPct: 6,
        mobileWidthPct: 14,
        headerAlign: 'center',
        className: (m) =>
            `change-cell ${toNum(m.change_percent) >= -40 ? 'positive' : 'negative'}`,
        value: (m) => m.change_percent || "-",
        render: (v, m) => (
            <span className={toNum(m.change_percent) >= -40 ? 'positive' : 'negative'}>
        {pct0(v)}
      </span>
        ),
    };

    const week_count = {
        key: 'week_number',
        label: 'Semaine',
        sortable: true,
        priority: 3,
        widthPct: 6,
        mobileWidthPct: 7,
        align: 'center',
        headerAlign: 'center',
        value: (m) => m.week_number,
    };

    const cumulatif_qc = {
        key: 'cumulatif_qc',
        label: 'Cumulatif',
        sortable: true,
        priority: 4,
        widthPct: 10,
        mobileWidthPct: 12,
        align: 'center',
        headerAlign: 'center',
        value: (m) => m.cumulatif_qc,
        render: (v) => formatCurrency(v),
    };

    const rev_per_screen = {
        key: 'rev_per_screen',
        label: '$/Shows',
        sortable: true,
        priority: 5,
        widthPct: 6,
        mobileWidthPct: 14,
        align: 'center',
        headerAlign: 'center',
        value: (m) => m.rev_per_screen,
        render: (v) => (v == null ? '—' : formatCurrency(v)),
    };

    const date = {
        key: 'date',
        label: 'Date',
        sortable: true,
        priority: 0,
        widthPct: 10,
        mobileWidthPct: 24,
        headerAlign: 'left',
        align: 'left',
        value: (r) => (r.dateObj ? r.dateObj.getTime() : -Infinity),
        render: (_, r) =>
            r.dateObj
                ? r.dateObj.toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' })
                : '—',
    };

    const rank = {
        key: 'rank',
        label: 'Rank',
        sortable: true,
        priority: 10,
        widthPct: 8,
        mobileWidthPct: 10,
        headerAlign: 'center',
        align: 'center',
        value: (r) => (Number(r.rank) || 0),
        render: (v, r) => `#${Number(r.rank) || 0}`,
    };

    const qc_usa = {
        key: 'qc_usa',
        label: 'QC/USA',
        sortable: true,
        priority: 10,
        widthPct: 8,
        mobileWidthPct: 10,
        headerAlign: 'center',
        align: 'center',
        value: (m) => m.force_qc_usa || "-",
        render: (v) => (
            <span className={toNum(v) >= 75 ? 'positive' : 'negative'}>
      {pct0(v)}
    </span>
        ),
    };

    const theater_count = {
        key: 'theater_count',
        label: 'Salles',
        sortable: true,
        priority: 4,
        widthPct: 10,
        mobileWidthPct: 12,
        headerAlign: 'center',
        align: 'center',
        value: (r) => (Number(r.theater_count_num) || 0),
        render: (v, r) => (r.theater_count_num == null ? '—' : Number(r.theater_count_num).toLocaleString('fr-CA')),
    };

    const rev_per_theater = {
        key: 'rev_per_theater',
        label: '$ / salle',
        sortable: true,
        priority: 5,
        widthPct: 12,
        mobileWidthPct: 14,
        headerAlign: 'center',
        align: 'center',
        value: (r) => (toNum(r.rev_per_theater) ?? -Infinity),
        render: (v, r) => (r.rev_per_theater == null ? '—' : formatCurrency(r.rev_per_theater)),
    };

    const week_number = {
        key: 'week_number',
        label: 'Week',
        sortable: true,
        priority: 6,
        widthPct: 7,
        mobileWidthPct: 10,
        headerAlign: 'center',
        align: 'center',
        value: (r) => (Number(r.week_number) || -Infinity),
        render: (v, r) => r.week_number ?? '—',
    };

    const screen_count = {
        key: 'screen_count',
        label: 'Shows',
        sortable: true,
        priority: 6,
        widthPct: 8,
        mobileWidthPct: 10,
        headerAlign: 'center',
        align: 'center',
        value: (r) => (Number(r.screen_count) || -Infinity),
        render: (v, r) => r.screen_count ?? '—',
    };

    const occupancy = {
        key: 'occupancy',
        label: 'Occupation',
        sortable: true,
        priority: 6,
        widthPct: 8,
        mobileWidthPct: 10,
        headerAlign: 'center',
        align: 'center',
        // sort on percentage value
        value: (r) => {
            const p = asPct(r.average_showing_occupancy);
            return p == null ? -Infinity : p;
        },
        render: (_v, r) => {
            const p = asPct(r.average_showing_occupancy);
            return p == null ? '—' : pct0(p);
        },
    };

    const weight = {
        key: 'weight',
        label: 'Poids total',
        sortable: true,
        priority: 6,
        widthPct: 8,
        mobileWidthPct: 10,
        headerAlign: 'center',
        align: 'center',
        value: (r) => {
            const p = asPct(r.showings_proportion);
            return p == null ? -Infinity : p;
        },
        render: (_v, r) => {
            const p = asPct(r.showings_proportion);
            return p == null ? '—' : pct0(p);
        },
    };

    /** Export the catalog by key */
    const C = {
        title,
        revenue_qc,
        change_percent,
        week_count,
        cumulatif_qc,
        rev_per_screen, date, rank, qc_usa, theater_count, rev_per_theater, week_number, screen_count,
        occupancy,
        weight
        // add more columns over time, all in one place
    };

    /**
     * Pick columns by key, with optional shallow overrides per key.
     * Example: pickColumns(['title','revenue_qc'], { revenue_qc: { align:'right' } })
     */
    function pickColumns(keys, overrides = {}) {
        return keys.map((k) => ({ ...C[k], ...(overrides[k] || {}) }));
    }

    return { C, pickColumns };
}
