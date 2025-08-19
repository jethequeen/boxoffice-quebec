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

/* ---------------- UI helpers ---------------- */

const formatInt = (n) =>
    n == null ? '—' : new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 0 }).format(n);

const dollarsPerTheater = (revenueQc, theaterCount) =>
    theaterCount > 0 ? revenueQc / theaterCount : null;

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
  const [availableWeekends, setAvailableWeekends] = useState([]);
  const [expanded, setExpanded] = useState(new Set());

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

  /* ---------- row normalization ---------- */
  const normalizeMovie = (m) => {
    const revenue_qc = toNum(m.revenue_qc) ?? 0;
    const theater_count = toNum(m.theater_count);
    const rev_per_theater = dollarsPerTheater(revenue_qc, theater_count);

    return {
      ...m,
      revenue_qc,
      revenue_us: toNum(m.revenue_us) ?? 0,
      change_percent: toNum(m.change_percent ?? m.change_qc),
      force_qc_usa: toNum(m.force_qc_usa),
      cumulatif_qc: toNum(m.cumulatif_qc) ?? revenue_qc,
      week_number: m.week_count ?? 1,
      studio_name: m.studio_name ?? 'Independent',
      theater_count,
      rev_per_theater,
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
        case 'theater_count':
          return toNum(m.theater_count) ?? -Infinity;
        case 'rev_per_theater':
          return toNum(m.rev_per_theater) ?? -Infinity;
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
  const isCurrentWeekend = !realWeekendId || realWeekendId === getCurrentWeekendId();
  const canGoNext = realWeekendId < getCurrentWeekendId();

  const sum = (arr, key) => arr.reduce((s, m) => s + (toNum(m[key]) || 0), 0);
  const totalQC =
      toNum(weekendMeta?.total_revenues_qc) ?? (rawMovies.length ? sum(rawMovies, 'revenue_qc') : null);
  const totalUS =
      toNum(weekendMeta?.total_revenues_us) ?? (rawMovies.length ? sum(rawMovies, 'revenue_us') : null);
  const changeQC = toNum(weekendMeta?.change_qc); // may be null if not provided
  const overallForceQcUsa =
      totalUS && totalUS > 0 ? ((totalQC ?? 0) / totalUS) * 100 / 2.29 * 100 : null;

  const toggle = (id) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

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
        {/* Weekend Navigation */}
        {showNavigation && (
            <div className="box-office-header">
              <div className="weekend-navigation">
                <button className="nav-arrow prev" onClick={navigateToPrevious} title="Weekend précédent">
                  ←
                </button>

                <div className="weekend-selector">
                  <select
                      value={realWeekendId}
                      onChange={(e) => handleWeekendChange(e.target.value)}
                      className="weekend-dropdown"
                  >
                    {availableWeekends.map((w) => (
                        <option key={w.weekend_id} value={w.weekend_id}>
                          {w.display_date}
                        </option>
                    ))}
                  </select>
                </div>

                <button
                    className={`nav-arrow next ${!canGoNext ? 'disabled' : ''}`}
                    onClick={navigateToNext}
                    disabled={!canGoNext}
                    title="Weekend suivant"
                >
                  →
                </button>
              </div>

              {isCurrentWeekend && (
                  <div className="current-badge">
                    <span className="badge">Weekend actuel</span>
                  </div>
              )}
            </div>
        )}

        <div className="dashboard-header">
          <h1>{formatWeekendRange(realWeekendId)}</h1>
          <p>{isCurrentWeekend ? 'Weekend actuel' : 'Détails du weekend'}</p>
        </div>

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
            <div className="table-section">
              <div className="table-container">
                <table className="box-office-table">
                  <thead>
                  <tr>
                    <th className="sortable center" onClick={() => setSortKey('title')}>
                      Film {sort.key === 'title' ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                    </th>
                    <th className="sortable center" onClick={() => setSortKey('revenue_qc')}>
                      Recettes {sort.key === 'revenue_qc' ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                    </th>
                    <th className="sortable center" onClick={() => setSortKey('change_percent')}>
                      Changement {sort.key === 'change_percent' ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                    </th>
                    <th className="sortable center" onClick={() => setSortKey('force_qc_usa')}>
                      Force QC/USA {sort.key === 'force_qc_usa' ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                    </th>
                    <th className="sortable center" onClick={() => setSortKey('week_number')}>
                      Week {sort.key === 'week_number' ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                    </th>
                    <th className="sortable center" onClick={() => setSortKey('cumulatif_qc')}>
                      Cumulatif {sort.key === 'cumulatif_qc' ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                    </th>
                    <th className="sortable center" onClick={() => setSortKey('theater_count')}>
                      Salles {sort.key === 'theater_count' ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                    </th>
                    <th className="sortable center" onClick={() => setSortKey('rev_per_theater')}>
                      $ / salle {sort.key === 'rev_per_theater' ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                    </th>
                    <th>Studio majeur</th>
                  </tr>
                  </thead>

                  <tbody>
                  {movies.map((m) => (
                      <tr key={m.id}>
                        <td className="movie-cell">
                          <div className="movie-title-wrap">
                            <Link to={`/movies/${m.id}`} className="movie-title-fr">
                              {m.fr_title || m.title}
                            </Link>
                            {m.title && m.title !== m.fr_title && (
                                <div className="movie-title-vo">{m.title}</div>
                            )}
                          </div>
                        </td>


                        <td className="gross-cell">{formatCurrency(m.revenue_qc)}</td>

                        <td className={`change-cell ${toNum(m.change_percent) >= 0 ? 'positive' : 'negative'}`}>
                          {pct0(m.change_percent)}
                        </td>

                        <td className="ratio-cell">{pct0(m.force_qc_usa)}</td>

                        <td className="week-cell">{m.week_number}</td>

                        <td className="cumulative-cell">{formatCurrency(m.cumulatif_qc)}</td>

                        <td className="theaters-cell">{formatInt(m.theater_count)}</td>

                        <td className="pertheater-cell">
                          {m.rev_per_theater == null ? '—' : formatCurrency(m.rev_per_theater)}
                        </td>

                        <td className="studio-cell">{m.studio_name}</td>
                      </tr>
                  ))}
                  </tbody>
                </table>

                {/* Mobile cards */}
                <div className="mobile-table-cards">
                  {movies.map((m, index) => {
                    const isOpen = expanded.has(m.id);
                    return (
                        <div key={m.id} className="mobile-movie-card">
                          <div className="mobile-movie-main" onClick={() => toggle(m.id)}>
                            <div className="mobile-movie-header">
                              <span className="mobile-movie-rank">#{index + 1}</span>
                              <Link
                                  to={`/movies/${m.id}`}
                                  className="mobile-movie-title"
                                  onClick={(e) => e.stopPropagation()}
                              >
                                {m.fr_title || m.title}
                                {m.title && m.title !== m.fr_title && (
                                    <div className="mobile-movie-subtitle">{m.title}</div>
                                )}

                              </Link>
                            </div>
                            <button
                                className={`mobile-expand-button ${isOpen ? 'expanded' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggle(m.id);
                                }}
                            >
                              ▼
                            </button>
                          </div>

                          <div className="mobile-stat-item revenue">
                            <span className="mobile-stat-label">Recettes du week-end</span>
                            <span className="mobile-stat-value revenue">{formatCurrency(m.revenue_qc)}</span>
                          </div>

                          <div className={`mobile-movie-details ${isOpen ? 'expanded' : 'collapsed'}`}>
                            <div className="mobile-movie-stats">
                              <div className="mobile-stat-item">
                                <span className="mobile-stat-label">Changement</span>
                                <span
                                    className={`mobile-stat-value ${
                                        toNum(m.change_percent) >= 0 ? 'positive' : 'negative'
                                    }`}
                                >
                            {pct0(m.change_percent)}
                          </span>
                              </div>
                              <div className="mobile-stat-item">
                                <span className="mobile-stat-label">Force QC/USA</span>
                                <span className="mobile-stat-value">{pct0(m.force_qc_usa)}</span>
                              </div>
                              <div className="mobile-stat-item">
                                <span className="mobile-stat-label">Semaine</span>
                                <span className="mobile-stat-value">{m.week_number}</span>
                              </div>
                              <div className="mobile-stat-item">
                                <span className="mobile-stat-label">Cumulatif</span>
                                <span className="mobile-stat-value">{formatCurrency(m.cumulatif_qc)}</span>
                              </div>
                              <div className="mobile-stat-item">
                                <span className="mobile-stat-label">Salles</span>
                                <span className="mobile-stat-value">{formatInt(m.theater_count)}</span>
                              </div>
                              <div className="mobile-stat-item">
                                <span className="mobile-stat-label">$ / salle</span>
                                <span className="mobile-stat-value">
                            {m.rev_per_theater == null ? '—' : formatCurrency(m.rev_per_theater)}
                          </span>
                              </div>
                              <div className="mobile-stat-item">
                                <span className="mobile-stat-label">Studio</span>
                                <span className="mobile-stat-value">{m.studio_name}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                    );
                  })}
                </div>
              </div>
            </div>
        )}
      </div>
  );
}

export default WeekendDetails;
