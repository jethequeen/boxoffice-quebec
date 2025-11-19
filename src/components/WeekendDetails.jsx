import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getBoxOfficeData } from '../utils/api';
import {
  getCurrentWeekendId,
  getFridayFromWeekendId,
  getNextWeekendId,
  getPreviousWeekendId,
} from '../utils/weekendUtils';
import { formatCurrency, toNum, pct0 } from '../utils/formatUtils';
import './Dashboard.css';
import './BoxOffice.css';
import MovieTable from '../components/movieTable';
import { createColumnsCatalog } from '../utils/catalog';
import { useLocation } from 'react-router-dom';


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
  const location = useLocation();


  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // sorting
  const [sort] = useState({ key: 'revenue_qc', dir: 'desc' });

  const [weekendMeta, setWeekendMeta] = useState(null);
  const [rawMovies, setRawMovies] = useState([]);
  const { pickColumns } = createColumnsCatalog({ Link, formatCurrency, pct0, toNum });

  useEffect(() => {
    fetchData();
  }, [realWeekendId, showNavigation]);

  // helper: normalize any shape to { weekend, movies }
  const pickPayload = (res) => {
    const payload = res?.data ?? res ?? {};
    return {
      weekend: payload?.weekend ?? null,
      movies: Array.isArray(payload?.movies) ? payload.movies : [],
    };
  };

  const nextWeekendId = useMemo(() => getNextWeekendId(realWeekendId), [realWeekendId]);




  const handleWeekendChange = (newWeekendId) => {
    if (showNavigation) navigate(`/box-office/${newWeekendId}`);
  };
  const navigateToPrevious = () => handleWeekendChange(getPreviousWeekendId(realWeekendId));
  const navigateToNext = () => handleWeekendChange(nextWeekendId);

  const normalizeMovie = (m) => {
    // For release-only movies (no box office data yet), keep null values
    const isReleaseOnly = m.is_release_only === true;

    const revenue_qc = toNum(m.revenue_qc) ?? (isReleaseOnly ? null : 0);

    const rawSC = m.screen_count ?? m.theater_count ?? 0;
    const screen_count = isReleaseOnly && rawSC === 0 ? null : (Number.isFinite(+rawSC) ? +rawSC : 0);

    const rev_per_screen = screen_count > 0 && revenue_qc !== null ? revenue_qc / screen_count : null;

    return {
      ...m,
      revenue_qc,
      revenue_us: toNum(m.revenue_us) ?? (isReleaseOnly ? null : 0),
      change_percent: m.change_percent,
      force_qc_usa: toNum(m.force_qc_usa),
      cumulatif_qc: toNum(m.cumulatif_qc) ?? (isReleaseOnly ? null : revenue_qc),
      week_number: m.week_count ?? 1,
      studio_name: m.studio_name ?? 'Independent',
      screen_count,
      rev_per_screen,
      average_showing_occupancy: toNum(m.average_showing_occupancy ?? m.occupancy),
      showings_proportion:      toNum(m.showings_proportion      ?? m.weight),
    };
  };


  /* ---------- data fetch ---------- */
  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await getBoxOfficeData(75, realWeekendId);
      const { weekend, movies } = pickPayload(res);

      setWeekendMeta(weekend);
      setRawMovies(movies.map(normalizeMovie));

      // optional diagnostics
      console.log('[bo] weekend', realWeekendId, {
        start: weekend?.start_date,
        end: weekend?.end_date,
        count: movies.length,
      });
    } catch (e) {
      console.error(e);
      setError('Erreur lors du chargement des données du weekend');
      setRawMovies([]);
      setWeekendMeta(null);
    } finally {
      setLoading(false);
    }
  };

  const leadCol = {
    key: 'lead',
    label: '',
    required: true,
    sortable: false,
    headerAlign: 'left',
    align: 'left',
    widthPct: 6,                 // any %; mobile will use CSS px
    headerClassName: 'lead-sticky',
    className: 'lead-sticky lead-cell',
    // no value/render here; MovieTable renders LeadCell based on key === 'lead'
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
  const sum = (arr, key) => arr.reduce((s, m) => s + (toNum(m[key]) || 0), 0);
  const totalQC =
      toNum(weekendMeta?.total_revenues_qc) ?? (rawMovies.length ? sum(rawMovies, 'revenue_qc') : null);
  const totalUS =
      toNum(weekendMeta?.total_revenues_us) ?? (rawMovies.length ? sum(rawMovies, 'revenue_us') : null);
  const changeQC = toNum(weekendMeta?.change_qc); // may be null if not provided
  const overallForceQcUsa =
      totalUS && totalUS > 0 ? ((totalQC ?? 0) / totalUS) * 100 / 2.29 * 100 : null;


  const columns = [
    leadCol,
    ...pickColumns(
        ['title','revenue_qc','change_percent','week_number','cumulatif_qc','screen_count','rev_per_screen','qc_usa','occupancy','weight'],
        {
          // text-only title render
          title: {
            render: (_value, m) => {
              const hasVO = !!m.title && m.title !== m.fr_title;
              return (
                  <div id={`movie-${m.id}`} className={`title-text ${hasVO ? 'has-vo' : 'single'}`}>
                    <Link to={`/movies/${m.id}`} className="movie-title-fr" title={m.fr_title || m.title || ''}>
                      {m.fr_title || m.title || ''}
                    </Link>
                    {hasVO && <span className="movie-title-vo" title={m.title}>{m.title}</span>}
                  </div>
              );
            },
          },
        }
    ),
  ];


  useEffect(() => {
    if (!movies.length) return;
    const hash = location.hash?.slice(1); // e.g. "movie-123"
    if (!hash) return;

    const el = document.getElementById(hash);
    if (!el) return;

    // smooth center scroll + transient highlight
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('flash-highlight');
    const t = setTimeout(() => el.classList.remove('flash-highlight'), 1500);
    return () => clearTimeout(t);
  }, [movies, location.hash]);


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
                  className="nav-arrow next"
                  onClick={navigateToNext}
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
                <div className="stat-content">
                  <h3>Recettes totales</h3>
                  <p className="stat-number">{totalQC == null ? 'N/A' : formatCurrency(totalQC)}</p>
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-content">
                  <h3>Changement</h3>
                  <p className={`stat-number ${toNum(changeQC) >= 0 ? 'positive' : 'negative'}`}>
                    {pct0(changeQC)}
                  </p>
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-content">
                  <h3>Force Québec/USA</h3>
                  <p className="stat-number">{pct0(overallForceQcUsa)}</p>
                </div>
              </div>
            </div>
        )}

        {/* Table or Empty */}
        {movies.length > 0 ? (
            <MovieTable
                rows={movies}
                columns={columns}
                initialSort={{ key: 'revenue_qc', dir: 'desc' }}
                initialVisibleKeys={['title','revenue_qc','change_percent','screen_count','rev_per_screen','week_number', 'occupancy']}
                searchAccessors={[r => r.fr_title, r => r.title, r => r.studio_name]}
            />
        ) : (
            <div className="empty-state">
              <p>Aucune donnée disponible pour ce weekend (pour l’instant).</p>
            </div>
        )}
      </div>
  );
}

export default WeekendDetails;
