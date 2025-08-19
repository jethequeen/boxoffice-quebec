import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getBoxOfficeData } from '../utils/api'; // if you keep separate weekendInfo
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

function WeekendDetails({ weekendId: propWeekendId, showNavigation = false }) {
  const { weekendId: paramWeekendId } = useParams();
  const navigate = useNavigate();
  const realWeekendId = propWeekendId || paramWeekendId || getCurrentWeekendId();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // NEW compact state
  const [weekendMeta, setWeekendMeta] = useState(null); // { id, start_date, end_date, total_revenues_qc, total_revenues_us, change_qc, change_us }
  const [movies, setMovies] = useState([]);
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
      let w = week - i, y = year;
      if (w <= 0) { y -= 1; w = 52 + w; }
      const id = `${String(y)}${String(w).padStart(2, '0')}`; // YYYYWW canonical
      const fri = getFridayFromWeekendId(id);
      weekends.push({
        weekend_id: id,
        formatted_weekend: formatWeekendId(id),
        display_date: fri
            ? fri.toLocaleDateString('fr-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
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

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await getBoxOfficeData(10, realWeekendId);
      if (res.weekend) setWeekendMeta(res.weekend);
      setMovies((res.movies ?? res.data ?? []).map(normalizeMovie));

    } catch (e) {
      console.error(e);
      setError('Erreur lors du chargement des données du weekend');
      setMovies([]);
      setWeekendMeta(null);
    } finally {
      setLoading(false);
    }
  };

  const normalizeMovie = (m) => ({
    ...m,
    revenue_qc: toNum(m.revenue_qc) ?? 0,
    revenue_us: toNum(m.revenue_us) ?? 0,
    change_percent: toNum(m.change_percent ?? m.change_qc), // after A) you have change_percent
    force_qc_usa: toNum(m.force_qc_usa),
    cumulatif_qc: toNum(m.cumulatif_qc) ?? toNum(m.revenue_qc) ?? 0,
    week_number: m.week_number ?? 1,
    studio_name: m.studio_name ?? 'Independent',
  });

  const isCurrentWeekend = !realWeekendId || realWeekendId === getCurrentWeekendId();
  const canGoNext = realWeekendId < getCurrentWeekendId();

  const totalQC = toNum(weekendMeta?.total_revenues_qc);
  const totalUS = toNum(weekendMeta?.total_revenues_us);
  const changeQC = toNum(weekendMeta?.change_qc);  // already a percent in `weekends`
  const overallForceQcUsa =
      totalUS && totalUS > 0 ? (((totalQC ?? 0) / totalUS) * 100) / 2.29 * 100 : null;

  const toggle = (id) => {
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  if (loading) return <div className="dashboard"><div className="loading-container"><div className="loading-spinner" /><p>Chargement des données du weekend...</p></div></div>;
  if (error)   return <div className="dashboard"><div className="error-container"><h2>Erreur</h2><p>{error}</p><button onClick={fetchData} className="retry-button">Réessayer</button></div></div>;

  return (
      <div className="dashboard">
        {showNavigation && (
            <div className="box-office-header">
              <div className="weekend-navigation">
                <button className="nav-arrow prev" onClick={navigateToPrevious} title="Weekend précédent">←</button>
                <div className="weekend-selector">
                  <select value={realWeekendId} onChange={(e) => handleWeekendChange(e.target.value)} className="weekend-dropdown">
                    {availableWeekends.map(w => (
                        <option key={w.weekend_id} value={w.weekend_id}>{w.display_date}</option>
                    ))}
                  </select>
                </div>
                <button className={`nav-arrow next ${!canGoNext ? 'disabled' : ''}`} onClick={navigateToNext} disabled={!canGoNext} title="Weekend suivant">→</button>
              </div>
              {isCurrentWeekend && <div className="current-badge"><span className="badge">Weekend actuel</span></div>}
            </div>
        )}

        <div className="dashboard-header">
          <h1>{formatWeekendId(realWeekendId)}</h1>
          <p>{isCurrentWeekend ? 'Weekend actuel' : 'Détails du weekend'}</p>
        </div>

        {/* Stats from `weekends` */}
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

        {movies.length > 0 && (
            <div className="table-section">
              <h2>Box-office du week-end</h2>
              <div className="table-container">
                <table className="box-office-table">
                  <thead>
                  <tr>
                    <th>Film</th>
                    <th>Recettes</th>
                    <th>Changement</th>
                    <th>Force Québec/USA</th>
                    <th>Week</th>
                    <th>Cumulatif</th>
                    <th>Studio majeur</th>
                  </tr>
                  </thead>
                  <tbody>
                  {movies.map((m) => (
                      <tr key={m.id}>
                        <td className="movie-cell">
                          <Link to={`/movies/${m.id}`} className="movie-title-link"><strong>{m.fr_title || m.title}</strong></Link>
                        </td>
                        <td className="gross-cell">{formatCurrency(m.revenue_qc)}</td>
                        <td className={`change-cell ${toNum(m.change_percent) >= 0 ? 'positive' : 'negative'}`}>{pct0(m.change_percent)}</td>
                        <td className="ratio-cell">{pct0(m.force_qc_usa)}</td>
                        <td className="week-cell">{m.week_number}</td>
                        <td className="cumulative-cell">{formatCurrency(m.cumulatif_qc)}</td>
                        <td className="studio-cell">{m.studio_name}</td>
                      </tr>
                  ))}
                  </tbody>
                </table>

                <div className="mobile-table-cards">
                  {movies.map((m, index) => {
                    const isOpen = expanded.has(m.id);
                    return (
                        <div key={m.id} className="mobile-movie-card">
                          <div className="mobile-movie-main" onClick={() => toggle(m.id)}>
                            <div className="mobile-movie-header">
                              <span className="mobile-movie-rank">#{index + 1}</span>
                              <Link to={`/movies/${m.id}`} className="mobile-movie-title" onClick={(e) => e.stopPropagation()}>
                                {m.fr_title || m.title}
                              </Link>
                            </div>
                            <button className={`mobile-expand-button ${isOpen ? 'expanded' : ''}`} onClick={(e) => { e.stopPropagation(); toggle(m.id); }}>▼</button>
                          </div>

                          <div className="mobile-stat-item revenue">
                            <span className="mobile-stat-label">Recettes du week-end</span>
                            <span className="mobile-stat-value revenue">{formatCurrency(m.revenue_qc)}</span>
                          </div>

                          <div className={`mobile-movie-details ${isOpen ? 'expanded' : 'collapsed'}`}>
                            <div className="mobile-movie-stats">
                              <div className="mobile-stat-item">
                                <span className="mobile-stat-label">Changement</span>
                                <span className={`mobile-stat-value ${toNum(m.change_percent) >= 0 ? 'positive' : 'negative'}`}>
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
