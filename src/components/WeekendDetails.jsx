import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getBoxOfficeData } from '../utils/api';
import {
  formatWeekendId,
  getCurrentWeekendId,
  getFridayFromWeekendId,
  getNextWeekendId,
  getPreviousWeekendId,
  parseWeekendId,
} from '../utils/weekendUtils';
import { formatCurrency, toNum, pct0 } from '../utils/formatUtils';
import './Dashboard.css';
import './BoxOffice.css';
import MovieTable from '../components/movieTable';

/* ---------------- UI helpers ---------------- */

const formatWeekendRange = (weekendId) => {
  const fri = getFridayFromWeekendId(weekendId);
  if (!fri) return '';
  const sun = new Date(fri);
  sun.setDate(sun.getDate() + 2);
  const dd = (d) => d.toLocaleString('fr-CA', { day: '2-digit' });
  const month = sun.toLocaleString('fr-CA', { month: 'long' });
  return `Du ${dd(fri)} au ${dd(sun)} ${month}`;
};

/* ---------------- Component ---------------- */

function WeekendDetails({ weekendId: propWeekendId, showNavigation = false }) {
  const { weekendId: paramWeekendId } = useParams();
  const navigate = useNavigate();
  const realWeekendId = propWeekendId || paramWeekendId || getCurrentWeekendId();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // sorting
  const [sort, setSort] = useState({ key: 'revenue_qc', dir: 'desc' });
  const setSortKey = (key) =>
      setSort((prev) =>
          prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }
      );

  const [weekendMeta, setWeekendMeta] = useState(null);
  const [rawMovies, setRawMovies] = useState([]);

  useEffect(() => {
    fetchData();
    if (showNavigation) generateAvailableWeekends();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realWeekendId, showNavigation]);

  const generateAvailableWeekends = () => {
    const current = getCurrentWeekendId();
    const weekends = [];
    const { week, year } = parseWeekendId(current);
    for (let i = 0; i < 5; i++) {
      let w = week - i,
          y = year;
      if (w <= 0) {
        y -= 1;
        w = 52 + w;
      }
      const id = `${String(y)}${String(w).padStart(2, '0')}`; // YYYYWW canonical
      const fri = getFridayFromWeekendId(id);
      weekends.push({
        weekend_id: id,
        formatted_weekend: formatWeekendId(id),
        display_date: fri
            ? fri.toLocaleDateString('fr-CA', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })
            : 'Date inconnue',
      });
    }
    setAvailableWeekends(weekends);
  };

  const handleWeekendChange = (newWeekendId) => {
    if (showNavigation) navigate(`/box-office/${newWeekendId}`);
  };
  const navigateToPrevious = () => handleWeekendChange(getPreviousWeekendId(realWeekendId));
  const navigateToNext = () => {
    const current = getCurrentWeekendId();
    if (realWeekendId >= current) return;
    handleWeekendChange(getNextWeekendId(realWeekendId));
  };

  const normalizeMovie = (m) => {
    const revenue_qc = toNum(m.revenue_qc) ?? 0;

    const rawSC = m.screen_count ?? m.theater_count ?? 0;
    const screen_count = Number.isFinite(+rawSC) ? +rawSC : 0;

    const rev_per_screen = screen_count > 0 ? revenue_qc / screen_count : null;

    return {
      ...m,
      revenue_qc,
      revenue_us: toNum(m.revenue_us) ?? 0,
      change_percent: toNum(m.change_percent ?? m.change_qc),
      force_qc_usa: toNum(m.force_qc_usa),
      cumulatif_qc: toNum(m.cumulatif_qc) ?? revenue_qc,
      week_number: m.week_count ?? 1,
      studio_name: m.studio_name ?? 'Independent',
      screen_count,
      rev_per_screen,
    };
  };


  /* ---------- data fetch ---------- */
  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await getBoxOfficeData(10, realWeekendId);
      if (res.weekend) setWeekendMeta(res.weekend); // optional meta if your API returns it

      const rows = res.data ?? res.movies ?? [];
      setRawMovies(rows.map(normalizeMovie));
    } catch (e) {
      console.error(e);
      setError('Erreur lors du chargement des données du weekend');
      setRawMovies([]);
      setWeekendMeta(null);
    } finally {
      setLoading(false);
    }
  };

  /* ---------- sorting ---------- */
  const movies = useMemo(() => {
    const val = (m, key) => {
      switch (key) {
        case 'title':
          return (m.fr_title || m.title || '').toLowerCase();
        case 'revenue_qc':
          return toNum(m.revenue_qc) ?? -Infinity;
        case 'change_percent':
          return toNum(m.change_percent) ?? -Infinity;
        case 'force_qc_usa':
          return toNum(m.force_qc_usa) ?? -Infinity;
        case 'week_number':
          return toNum(m.week_number) ?? -Infinity;
        case 'cumulatif_qc':
          return toNum(m.cumulatif_qc) ?? -Infinity;
        case 'screen_count':
          return toNum(m.screen_count) ?? -Infinity;
        case 'rev_per_screen':
          return toNum(m.rev_per_screen) ?? -Infinity;
        default:
          return toNum(m.revenue_qc) ?? -Infinity;
      }
    };

    const arr = [...rawMovies];
    arr.sort((a, b) => {
      const va = val(a, sort.key);
      const vb = val(b, sort.key);
      if (typeof va === 'string' || typeof vb === 'string') {
        const cmp = String(va).localeCompare(String(vb), 'fr');
        return sort.dir === 'asc' ? cmp : -cmp;
      }
      if (va === vb) return 0;
      return sort.dir === 'asc' ? va - vb : vb - va;
    });
    return arr;
  }, [rawMovies, sort]);

  /* ---------- header + cards data ---------- */
  const canGoNext = realWeekendId < getCurrentWeekendId();

  const sum = (arr, key) => arr.reduce((s, m) => s + (toNum(m[key]) || 0), 0);
  const totalQC =
      toNum(weekendMeta?.total_revenues_qc) ?? (rawMovies.length ? sum(rawMovies, 'revenue_qc') : null);
  const totalUS =
      toNum(weekendMeta?.total_revenues_us) ?? (rawMovies.length ? sum(rawMovies, 'revenue_us') : null);
  const changeQC = toNum(weekendMeta?.change_qc); // may be null if not provided
  const overallForceQcUsa =
      totalUS && totalUS > 0 ? ((totalQC ?? 0) / totalUS) * 100 / 2.29 * 100 : null;

  const columns = [
    {
      key: 'title',
      label: 'Film',
      sortable: false,
      widthPct: 17,
      align: 'left',
      headerClassName: 'left',
      className: 'movie-cell',
      value: (m) => (m.fr_title || m.title || ''),
      sortValue: (m) => (m.fr_title || m.title || '').toLowerCase(),
      render: (value, m) => (
          <div className="movie-title-wrap">
            <Link to={`/movies/${m.id}`} className="movie-title-fr">{value}</Link>
            {m.title && m.title !== m.fr_title && <span className="movie-title-vo">{m.title}</span>}
          </div>
      ),
    },
    {
      key: 'revenue_qc',
      label: 'Recettes',
      sortable: true,
      widthPct: 9,
      align: 'center',
      headerClassName: 'center',
      value: (m) => m.revenue_qc,
      render: (v) => formatCurrency(v),
      sortValue: (m) => toNum(m.revenue_qc) ?? Number.NEGATIVE_INFINITY,
    },
    {
      key: 'change_percent',
      label: 'Delta',
      sortable: true,
      widthPct: 6,
      headerClassName: 'center',
      className: (m) => `change-cell ${toNum(m.change_percent) >= 0 ? 'positive' : 'negative'} align-center`,
      value: (m) => m.change_percent,
      render: (v, m) => <span className={toNum(m.change_percent) >= 0 ? 'positive' : 'negative'}>{pct0(v)}</span>,
      sortValue: (m) => toNum(m.change_percent) ?? Number.NEGATIVE_INFINITY,
    },
    {
      key: 'force_qc_usa',
      label: 'QC/USA',
      sortable: true,
      widthPct: 6,
      align: 'center',
      headerClassName: 'center',
      value: (m) => m.force_qc_usa,
      render: (v) => pct0(v),
      sortValue: (m) => toNum(m.force_qc_usa) ?? Number.NEGATIVE_INFINITY,
    },
    {
      key: 'week_number',
      label: 'Semaine',
      sortable: true,
      widthPct: 6,
      headerClassName: 'center',
      className: 'week-cell align-center',
      value: (m) => m.week_number,
    },
    {
      key: 'cumulatif_qc',
      label: 'Cumulatif',
      sortable: true,
      widthPct: 10,
      align: 'center',
      headerClassName: 'center',
      value: (m) => m.cumulatif_qc,
      render: (v) => formatCurrency(v),
      sortValue: (m) => toNum(m.cumulatif_qc) ?? Number.NEGATIVE_INFINITY,
    },
    {
      key: 'rev_per_screen',
      label: '$/salle',
      sortable: true,
      widthPct: 6,
      align: 'center',
      headerClassName: 'center',
      value: (m) => m.rev_per_screen,
      render: (v) => (v == null ? '—' : formatCurrency(v)),
      sortValue: (m) => toNum(m.rev_per_screen) ?? Number.NEGATIVE_INFINITY,
    },
    {
      key: 'studio_name',
      label: 'Studio majeur',
      sortable: false,
      widthPct: 8,
      headerClassName: 'center',
      className: 'studio-cell',
      value: (m) => m.studio_name ?? 'Independent',
      sortValue: (m) => (m.studio_name ?? 'Independent').toLowerCase(),
    },
  ];


  if (loading)
    return (
        <div className="dashboard">
          <div className="loading-container">
            <div className="loading-spinner" />
            <p>Chargement des données du weekend...</p>
          </div>
        </div>
    );

  if (error)
    return (
        <div className="dashboard">
          <div className="error-container">
            <h2>Erreur</h2>
            <p>{error}</p>
            <button onClick={fetchData} className="retry-button">
              Réessayer
            </button>
          </div>
        </div>
    );

  return (
      <div className="dashboard">
        {/* Weekend Navigation + Title (cardless) */}
        {showNavigation && (
            <div className="weekend-hero-plain">
              <button
                  className="nav-arrow prev"
                  onClick={navigateToPrevious}
                  title="Weekend précédent"
                  aria-label="Weekend précédent"
              >
                ←
              </button>

              <h1 className="weekend-title">{formatWeekendRange(realWeekendId)}</h1>

              <button
                  className={`nav-arrow next ${!canGoNext ? 'disabled' : ''}`}
                  onClick={navigateToNext}
                  disabled={!canGoNext}
                  title="Weekend suivant"
                  aria-label="Weekend suivant"
              >
                →
              </button>
            </div>
        )}




        {/* Stat Cards */}
        {(totalQC != null || changeQC != null || overallForceQcUsa != null) && (
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-icon">💰</div>
                <div className="stat-content">
                  <h3>Recettes totales</h3>
                  <p className="stat-number">{totalQC == null ? 'N/A' : formatCurrency(totalQC)}</p>
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-icon">📈</div>
                <div className="stat-content">
                  <h3>Changement</h3>
                  <p className={`stat-number ${toNum(changeQC) >= 0 ? 'positive' : 'negative'}`}>
                    {pct0(changeQC)}
                  </p>
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-icon"></div>
                <div className="stat-content">
                  <h3>Force Québec/USA</h3>
                  <p className="stat-number">{pct0(overallForceQcUsa)}</p>
                </div>
              </div>
            </div>
        )}

        {/* Table */}
        {movies.length > 0 && (
            <MovieTable
                rows={movies}
                columns={columns}
                initialSort={{ key: 'revenue_qc', dir: 'desc' }}
                initialVisibleKeys={[
                  'title','revenue_qc','change_percent','week_number','cumulatif_qc', 'rev_per_screen'
                ]}
            />
        )}
      </div>
  );
}

export default WeekendDetails;
