// src/columns/catalog.jsx
// A tiny catalog of reusable column configs + helpers.

/**
 * Creates the full catalog using your app's deps (formatters, Link, etc.)
 * so column renderers stay pure & reusable.
 */
export function createColumnsCatalog({ Link, formatCurrency, pct0, toNum }) {
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
                {m.title && m.title !== m.fr_title && (
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
            `change-cell ${toNum(m.change_percent) >= 0 ? 'positive' : 'negative'}`,
        value: (m) => m.change_percent,
        render: (v, m) => (
            <span className={toNum(m.change_percent) >= 0 ? 'positive' : 'negative'}>
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
        mobileWidthPct: 12,
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
        label: '$/salle',
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
        widthPct: 16,
        mobileWidthPct: 24,
        headerAlign: 'left',
        align: 'left',
        value: (r) => (r.dateObj ? r.dateObj.getTime() : -Infinity), // numeric for sort
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

    const revenue_qc_hist = {
        key: 'revenue_qc',
        label: 'Recettes',
        sortable: true,
        priority: 1,
        widthPct: 14,
        mobileWidthPct: 16,
        headerAlign: 'center',
        align: 'center',
        value: (r) => (Number(r.revenue_qc_num) || 0),
        render: (v, r) => formatCurrency(r.revenue_qc_num),
    };

    const change_percent_hist = {
        key: 'change_percent',
        label: '% Changement',
        sortable: true,
        priority: 2,
        widthPct: 12,
        mobileWidthPct: 14,
        headerAlign: 'center',
        align: 'center',
        className: (r) =>
            `change-cell ${toNum(r.change_percent) >= 0 ? 'positive' : 'negative'}`,
        value: (r) => (toNum(r.change_percent) ?? -Infinity),
        render: (v, r) =>
            r.change_percent == null ? '—' : `${r.change_percent >= 0 ? '+' : ''}${Number(r.change_percent).toFixed(0)}%`,
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
        widthPct: 8,
        mobileWidthPct: 10,
        headerAlign: 'center',
        align: 'center',
        value: (r) => (Number(r.week_number) || -Infinity),
        render: (v, r) => r.week_number ?? '—',
    };

    /** Export the catalog by key */
    const C = {
        title,
        revenue_qc,
        change_percent,
        week_count,
        cumulatif_qc,
        rev_per_screen, date, rank, revenue_qc_hist, change_percent_hist, theater_count, rev_per_theater, week_number,
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

export const presets = {
    weekendInitialVisible: [
        'title','revenue_qc','change_percent','week_count','cumulatif_qc','rev_per_screen',
    ],
    historyInitialVisible: [
        'date','revenue_qc','change_percent','rank','theater_count','rev_per_theater','week_number',
    ],
};
