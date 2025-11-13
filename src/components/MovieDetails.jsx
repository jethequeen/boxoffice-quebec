import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import './MovieDetails.css';
import { getFridayFromWeekendId } from '../utils/weekendUtils';
import { createColumnsCatalog } from '../utils/catalog';
import MovieTable from '../components/movieTable';
import { formatCurrency, toNum, pct0} from "../utils/formatUtils.js";
import { useNavigate } from "react-router-dom";
import Tabs from "../components/Tabs";
import './BoxOffice.css';
import CorrectionIdpanel from "./correctionIdpanel.jsx";
import { getMovieDetails, getMovieShowings } from '../utils/api';

function useIsMobile(breakpoint = 768) {
  const getMatch = () => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;

    const mqWidth  = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const mqCoarse = window.matchMedia(`(pointer: coarse)`); // phones/tablets

    // Mobile if either: small width OR coarse pointer (covers “Desktop site” on phones)
    return mqWidth.matches || mqCoarse.matches;
  };

  const [isMobile, setIsMobile] = useState(getMatch);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const mqWidth  = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const mqCoarse = window.matchMedia(`(pointer: coarse)`);

    const update = () => setIsMobile(mqWidth.matches || mqCoarse.matches);

    // Chromium: 'change'; Safari older: addListener/removeListener fallback
    if (mqWidth.addEventListener) {
      mqWidth.addEventListener("change", update);
      mqCoarse.addEventListener("change", update);
    } else {
      mqWidth.addListener(update);
      mqCoarse.addListener(update);
    }

    // Also listen to resize to catch odd cases
    window.addEventListener("resize", update);
    update();

    return () => {
      if (mqWidth.removeEventListener) {
        mqWidth.removeEventListener("change", update);
        mqCoarse.removeEventListener("change", update);
      } else {
        mqWidth.removeListener(update);
        mqCoarse.removeListener(update);
      }
      window.removeEventListener("resize", update);
    };
  }, [breakpoint]);

  return isMobile;
}

const fmtMoney = (n) =>
    typeof n === 'number' && isFinite(n)
        ? n.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 })
        : '—';

function BarChart({ data, width = 960, height = 420, margin = { top: 20, right: 16, bottom: 120, left: 80 } }) {
  // data: [{ title, budget }]
  const W = width, H = height;
  const innerW = W - margin.left - margin.right;
  const innerH = H - margin.top - margin.bottom;

  const clean = (data || []).filter(d => d && typeof d.budget === 'number' && isFinite(d.budget));
  const maxY = clean.reduce((m, d) => Math.max(m, d.budget), 0) || 1;

  // scales
  const xStep = innerW / Math.max(clean.length, 1);
  const y = (v) => innerH - (v / maxY) * innerH;

  return (
      <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
        <svg width={Math.max(W, margin.left + margin.right + xStep * clean.length)} height={H}>
          {/* axes */}
          <g transform={`translate(${margin.left},${margin.top})`}>
            {/* y axis ticks */}
            {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
              const yPos = y(t * maxY);
              return (
                  <g key={i} transform={`translate(0,${yPos})`}>
                    <line x1={0} x2={innerW} stroke="#eee" />
                    <text x={-12} y={0} dominantBaseline="middle" textAnchor="end" fontSize="12">
                      {fmtMoney(t * maxY)}
                    </text>
                  </g>
              );
            })}

            {/* bars */}
            {clean.map((d, i) => {
              const barW = Math.max(12, Math.min(40, xStep * 0.8));
              const barX = i * xStep + (xStep - barW) / 2;
              const barY = y(d.budget);
              const barH = innerH - barY;
              return (
                  <g key={i} transform={`translate(${barX},${barY})`}>
                    <title>{`${d.title}\n${fmtMoney(d.budget)}`}</title>
                    <rect width={barW} height={barH} fill="#6a67f5" rx="4" />
                  </g>
              );
            })}

            {/* x labels */}
            {clean.map((d, i) => {
              const barX = i * xStep + xStep / 2;
              return (
                  <g key={i} transform={`translate(${barX},${innerH + 8})`}>
                    <text
                        transform="rotate(-60)"
                        textAnchor="end"
                        fontSize="12"
                        x={0}
                        y={12}
                        style={{ fill: '#444' }}
                    >
                      {d.title}
                    </text>
                  </g>
              );
            })}
          </g>

          {/* axis titles */}
          <text x={margin.left + innerW / 2} y={H - 6} textAnchor="middle" fontSize="12" fill="#666">
            Films
          </text>
          <text
              x={16}
              y={margin.top + innerH / 2}
              textAnchor="middle"
              fontSize="12"
              fill="#666"
              transform={`rotate(-90, 16, ${margin.top + innerH / 2})`}
          >
            Budget (CAD)
          </text>
        </svg>
      </div>
  );
}

function Comparateur({ movieId }) {
  const [prompt, setPrompt] = useState(
      'Revenues similaires 10%'
  );
  const [loading, setLoading] = useState(false);
  const [resp,   setResp]   = useState(null);
  const [error,  setError]  = useState(null);

  // lead column identical to WeekendDetails
  const leadCol = {
    key: 'lead',
    label: '',
    required: true,
    sortable: false,
    headerAlign: 'left',
    align: 'left',
    widthPct: 6,
    headerClassName: 'lead-sticky',
    className: 'lead-sticky lead-cell',
  };

  async function run() {
    setLoading(true); setError(null);
    try {
      const r = await fetch('/.netlify/functions/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, movieId: Number(movieId) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Query failed');

      const rows = Array.isArray(j.data) ? j.data : (j.data?.rows ?? []);

      // minimal dedupe by id/title
      const seen = new Set();
      const deduped = rows.filter(row => {
        const key = row?.id ?? row?.movie_id ?? row?.title;
        if (key == null) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // ensure target at top if missing
      const ensureTarget =
          movieId && !deduped.some(r => Number(r.id) === Number(movieId))
              ? [{ id: Number(movieId), title: `#${movieId}` }, ...deduped]
              : deduped;

      setResp({ ...j, data: ensureTarget });
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  // normalize rows to what MovieTable expects (Comparateur)
// -> no weekend fields; keep only what we need (id, titles, poster, budget, studio, a bit of meta)
  const tableRows = useMemo(() => {
    const rows = resp?.data || [];
    return rows.map((m, i) => {
      const posterUrl = m?.poster_path
          ? `https://image.tmdb.org/t/p/w92${m.poster_path}`
          : undefined;

      const studioName = m?.studio_name ?? m?.studio ?? undefined;
      const studioId   = m?.studio_id ?? m?.principal_studio_id ?? undefined;

      const year =
          m?.year ??
          (m?.release_date ? new Date(m.release_date).getFullYear() : undefined);

      return {
        id: m?.id ?? m?.movie_id ?? i,

        // titles
        title: m?.fr_title || m?.title || '—',
        fr_title: m?.fr_title,
        vo_title: m?.vo_title,

        // poster for lead cell
        poster_path: m?.poster_path,
        poster_url: posterUrl,

        // what we actually compare/show
        budget: Number(m?.budget) || undefined,

        // studio (keep both keys for compatibility with your catalog)
        studio_id: studioId,
        studio_name: studioName,
        studio: studioName,

        // light metadata (handy for tooltips / future columns)
        year,
        release_date: m?.release_date ?? undefined,
        runtime: m?.runtime != null ? Number(m.runtime) : undefined,

        // ✅ Recettes (QC) — what your columns call "revenue_qc"
        revenue_qc:
            m?.revenue_qc != null
                ? Number(m.revenue_qc)
                : (m?.total_revenue_qc != null ? Number(m.total_revenue_qc) : undefined),

        // (optional alias if some renderers look for cumulatif_qc)
        cumulatif_qc:
            m?.cumulatif_qc != null
                ? Number(m.cumulatif_qc)
                : (m?.total_revenue_qc != null ? Number(m.total_revenue_qc) : undefined),

        // optional US total if you ever show it
        total_revenue_us: m?.total_revenue_us != null ? Number(m.total_revenue_us) : undefined,
      };
    });
  }, [resp?.data]);


  // columns: same pattern as WeekendDetails, only the set differs
  const { pickColumns } = createColumnsCatalog({ Link, formatCurrency, pct0, toNum });
  const columns = useMemo(() => ([
    leadCol,
    ...pickColumns(
        ['title','revenue_qc', 'budget', 'studio', 'year'],
        {
          // same FR/VO title renderer as WeekendDetails
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
  ]), []); // columns static; renderers already read row values dynamically

  return (
      <section className="compare-card">
        <div className="compare-row">
        <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="compare-input"
            rows={3}
            placeholder="Ex.: Compare ce film par budget vs films du même genre"
        />
          <button className="btn" onClick={run} disabled={loading}>
            {loading ? 'Analyse…' : 'Lancer'}
          </button>
        </div>

        {error && <div className="error">Erreur: {error}</div>}

        {resp ? (
            tableRows.length > 0 ? (
                <div className="dashboard table-context compare-table">
                  <MovieTable
                      rows={tableRows}
                      columns={columns}
                      initialSort={{ key: 'revenue_qc', dir: 'desc' }}
                      initialVisibleKeys={['title','revenue_qc', 'budget', 'studio', 'year']}
                      searchAccessors={[r => r.fr_title, r => r.title, r => r.studio_name]}
                  />
                </div>
            ) : (
                <div className="empty-state">
                  <p>Aucun résultat pour ce prompt.</p>
                  {import.meta.env.DEV && resp?.query ? (
                      <pre className="sql-preview"><code>{resp.query}</code></pre>
                  ) : null}
                </div>
            )
        ) : null}
      </section>
  );
}

function ShowingsTab({ movieId }) {
  const TICKET_PRICE = 13; // $13 per ticket

  // Get today's date in YYYY-MM-DD format
  const getTodayDate = () => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  };

  const [selectedDate, setSelectedDate] = useState(getTodayDate());
  const [selectedTheatre, setSelectedTheatre] = useState('');
  const [showingsData, setShowingsData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchShowings();
  }, [movieId, selectedDate, selectedTheatre]);

  async function fetchShowings() {
    try {
      setLoading(true);
      setError(null);
      const result = await getMovieShowings(
        movieId,
        selectedDate || undefined,
        selectedTheatre || undefined
      );
      setShowingsData(result);
    } catch (err) {
      console.error('Error fetching showings:', err);
      setError('Erreur lors du chargement des représentations');
    } finally {
      setLoading(false);
    }
  }

  // Group showings by theater and auditorium
  const groupedShowings = useMemo(() => {
    if (!showingsData?.showings) return {};

    const groups = {};
    showingsData.showings.forEach((showing) => {
      const theatreKey = `${showing.theater_id}-${showing.theatre_name}`;
      if (!groups[theatreKey]) {
        groups[theatreKey] = {
          theatre_id: showing.theater_id,
          theatre_name: showing.theatre_name,
          theatre_company: showing.theatre_city,
          auditoriums: {}
        };
      }

      const auditorium = showing.auditorium || 'N/A';
      if (!groups[theatreKey].auditoriums[auditorium]) {
        groups[theatreKey].auditoriums[auditorium] = [];
      }

      groups[theatreKey].auditoriums[auditorium].push(showing);
    });

    return groups;
  }, [showingsData]);

  const handleDateChange = (e) => {
    setSelectedDate(e.target.value);
  };

  const handleTheatreChange = (e) => {
    setSelectedTheatre(e.target.value);
  };

  const formatTime = (timeStr) => {
    if (!timeStr) return '—';
    // Handle timestamp with timezone format
    const date = new Date(timeStr);
    return date.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const calculateOccupancy = (seatsSold, totalSeats) => {
    if (!totalSeats || totalSeats === 0) return 0;
    return (seatsSold / totalSeats) * 100;
  };

  const calculateRevenue = (seatsSold) => {
    return seatsSold * TICKET_PRICE;
  };

  if (loading && !showingsData) {
    return (
      <div style={{ padding: '24px', textAlign: 'center' }}>
        <div className="loading-spinner" />
        <p>Chargement des représentations...</p>
      </div>
    );
  }

  return (
    <div className="showings-tab" style={{ padding: '12px 0' }}>
      {/* Filters */}
      <div className="showings-filters" style={{
        display: 'flex',
        gap: '12px',
        marginBottom: '20px',
        flexWrap: 'wrap',
        alignItems: 'flex-end'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label htmlFor="date-filter" style={{ fontSize: '14px', fontWeight: '500' }}>
            Date
          </label>
          <input
            id="date-filter"
            type="date"
            value={selectedDate}
            onChange={handleDateChange}
            style={{
              padding: '8px 12px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '14px'
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '200px' }}>
          <label htmlFor="theatre-filter" style={{ fontSize: '14px', fontWeight: '500' }}>
            Cinéma
          </label>
          <select
            id="theatre-filter"
            value={selectedTheatre}
            onChange={handleTheatreChange}
            style={{
              padding: '8px 12px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '14px'
            }}
          >
            <option value="">Tous les cinémas</option>
            {showingsData?.theaters?.map((theatre) => (
              <option key={theatre.id} value={theatre.id}>
                {theatre.name} {theatre.company ? `(${theatre.company})` : ''}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={fetchShowings}
          style={{
            padding: '8px 16px',
            background: '#6a67f5',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '500'
          }}
        >
          Actualiser
        </button>
      </div>

      {error && (
        <div style={{ padding: '12px', background: '#fee', borderRadius: '4px', marginBottom: '12px' }}>
          {error}
        </div>
      )}

      {/* Results count */}
      {showingsData && (
        <div style={{ marginBottom: '12px', fontSize: '14px', color: '#666' }}>
          {showingsData.count} représentation{showingsData.count !== 1 ? 's' : ''} trouvée{showingsData.count !== 1 ? 's' : ''}
        </div>
      )}

      {/* Showings grouped by theater and auditorium */}
      {Object.keys(groupedShowings).length > 0 ? (
        <div className="showings-list" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {Object.entries(groupedShowings).map(([theatreKey, theatreData]) => (
            <div key={theatreKey} className="theatre-group" style={{
              border: '1px solid #e0e0e0',
              borderRadius: '8px',
              overflow: 'hidden'
            }}>
              {/* Theater header */}
              <div style={{
                background: '#f5f5f5',
                padding: '12px 16px',
                borderBottom: '1px solid #e0e0e0'
              }}>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>
                  {theatreData.theatre_name}
                  {theatreData.theatre_company && (
                    <span style={{ fontWeight: '400', color: '#666', marginLeft: '8px' }}>
                      ({theatreData.theatre_company})
                    </span>
                  )}
                </h3>
              </div>

              {/* Auditoriums */}
              {Object.entries(theatreData.auditoriums).map(([auditorium, showings]) => (
                <div key={auditorium} style={{ padding: '16px' }}>
                  <h4 style={{
                    margin: '0 0 12px 0',
                    fontSize: '14px',
                    fontWeight: '600',
                    color: '#333'
                  }}>
                    {auditorium}
                  </h4>

                  {/* Showings table */}
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      fontSize: '14px'
                    }}>
                      <thead>
                        <tr style={{ background: '#fafafa', borderBottom: '2px solid #e0e0e0' }}>
                          <th style={{ padding: '8px', textAlign: 'left', fontWeight: '600' }}>Heure</th>
                          <th style={{ padding: '8px', textAlign: 'right', fontWeight: '600' }}>Sièges totaux</th>
                          <th style={{ padding: '8px', textAlign: 'right', fontWeight: '600' }}>Sièges vendus</th>
                          <th style={{ padding: '8px', textAlign: 'right', fontWeight: '600' }}>Occupation</th>
                          <th style={{ padding: '8px', textAlign: 'right', fontWeight: '600' }}>Recettes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {showings.map((showing) => {
                          const occupancy = calculateOccupancy(showing.seats_sold, showing.total_seats);
                          const revenue = calculateRevenue(showing.seats_sold);

                          return (
                            <tr key={showing.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                              <td style={{ padding: '8px' }}>{formatTime(showing.start_at)}</td>
                              <td style={{ padding: '8px', textAlign: 'right' }}>
                                {showing.total_seats?.toLocaleString('fr-CA') || '—'}
                              </td>
                              <td style={{ padding: '8px', textAlign: 'right' }}>
                                {showing.seats_sold?.toLocaleString('fr-CA') || '0'}
                              </td>
                              <td style={{ padding: '8px', textAlign: 'right' }}>
                                <span style={{
                                  color: occupancy >= 80 ? '#0a0' : occupancy >= 50 ? '#fa0' : '#666'
                                }}>
                                  {occupancy.toFixed(1)}%
                                </span>
                              </td>
                              <td style={{ padding: '8px', textAlign: 'right', fontWeight: '500' }}>
                                {formatCurrency(revenue)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div style={{
          padding: '40px',
          textAlign: 'center',
          color: '#999',
          border: '1px dashed #ddd',
          borderRadius: '8px'
        }}>
          {loading ? 'Chargement...' : 'Aucune représentation trouvée pour cette date'}
        </div>
      )}
    </div>
  );
}

function MovieDetails() {
  const { id } = useParams();

  const [movieData, setMovieData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const isTempId = true;

  const formatWeekendRange = (weekendId) => {
    const fri = getFridayFromWeekendId(String(weekendId));
    if (!fri) return '—';
    const sun = new Date(fri);
    sun.setDate(sun.getDate() + 2);
    const dd = (d) => d.toLocaleString('fr-CA', { day: '2-digit' });
    const month = sun.toLocaleString('fr-CA', { month: 'long' });
    const year = sun.getFullYear();
    return `${dd(fri)} au ${dd(sun)} ${month} ${year}`;
  };

  useEffect(() => { fetchMovieDetails(); }, [id]);

  async function fetchMovieDetails() {
    try {
      setLoading(true);
      const result = await getMovieDetails(id);
      setMovieData(result);
    } catch (err) {
      console.error('Error fetching movie details:', err);
      setError('Erreur lors du chargement des détails du film');
    } finally {
      setLoading(false);
    }
  }

  function handleIdCorrected(newId) {
    navigate(`/box-office`, { replace: true });
    // on pourrait aussi refetch ici si tu veux rester sur place
  }

  const { pickColumns } = createColumnsCatalog({ Link, formatCurrency, pct0, toNum })



// Vite dev flag + localhost check (covers netlify dev on 8888)
  const isDev =
      import.meta.env.DEV ||
      /^(localhost|127\.0\.0\.1|::1)$/.test(window.location.hostname);


  if (loading) {
    return (
        <div className="movie-details">
          <div className="loading">
            <div className="loading-spinner" />
            <p>Chargement des détails du film...</p>
          </div>
        </div>
    );
  }

  if (error || !movieData) {
    return (
        <div className="movie-details">
          <div className="error">
            <h2>Erreur</h2>
            <p>{error || 'Film non trouvé'}</p>
          </div>
        </div>
    );
  }

  const { movie, revenues = [], directors = [], genres = [], cast = [], statistics = {} } = movieData;


  const TMDB = {
    poster: (p) => (p ? `https://image.tmdb.org/t/p/w185${p}` : null),
    backdrop: (p) => (p ? `https://image.tmdb.org/t/p/w1280${p}` : null),
    profile: (p) => (p ? `https://image.tmdb.org/t/p/w185${p}` : null),
  };

  const backdropUrl = TMDB.backdrop(movie?.backdrop_path) || TMDB.poster(movie?.poster_path) || null;
  const year = movie.release_date ? new Date(movie.release_date).getFullYear() : '';
  const runtime = movie.runtime ? `${movie.runtime} min` : null;

  // --- KPI calculs ---
  const maxOf = (arr, key) =>
      arr.reduce((mx, r) => Math.max(mx, Number(r?.[key]) || 0), 0);

// Prefer the real running totals; fall back to movie/statistics if needed.
  const totalQC =
      maxOf(revenues, 'cumulatif_qc_to_date') ||
      Number(statistics.total_revenue_qc) ||
      0;

  const totalUS =
      maxOf(revenues, 'cumulatif_us_to_date') ||
      Number(statistics.total_revenue_us) ||
      0;

  // Force QC/USA globale (référence ~2.29% de part de marché)
  const POP_RATIO = 0.0229; // 2.29%
  const forceQcUsa = totalUS > 0 ? ((totalQC / totalUS) / POP_RATIO) * 100 : null;

  // semaines en salle (prends le max si week_count existe, sinon longueur)
  const maxWeeks = Math.max(
      revenues.length,
      ...revenues.map((r, i) => Number(r.week_count) || (i + 1))
  );

  // budget (si présent sur movie)
  const budget = Number(movie.budget) || null;

  // Pills genres (look “chip”)
  const genreChips = (genres || []).slice(0, 8).map((g) => (
      <Link key={g.id ?? g.name} to={`/genres/${g.id ?? encodeURIComponent(g.name)}`} className="chip chip--link chip--genre">
        {g.name}
      </Link>
  ));

  // Pays (après genres) – format pill “ghost”
  const countries = movie?.production_countries || movie?.countries || [];
  const countryChips = countries.map((c) => (
      <span key={c.iso_3166_1 ?? c.name} className="chip chip--ghost">
      {c.name ?? c.iso_3166_1}
    </span>
  ));

  // 9 acteurs
  const TOP_CAST_COUNT = 9;
  const topCast = cast.slice(0, TOP_CAST_COUNT);


// Build rows with the fields we need for sorting/formatting
  const revRows = revenues.map((r, i) => {
    const dateObj = r.start_date
        ? new Date(r.start_date)
        : getFridayFromWeekendId(String(r.weekend_id));
    const revenue_qc_num = Number(r.revenue_qc) || 0;
    const prev = i > 0 ? Number(revenues[i - 1].revenue_qc) || 0 : null;
    const change_percent = prev ? ((revenue_qc_num - prev) / prev) * 100 : null;
    const screen_count = Number(r.screen_count) || 0;
    const rev_per_screen = screen_count > 0 ? revenue_qc_num / screen_count : null;
    const week_number = Number(r.week_count) || i + 1;

    return {
      id: r.weekend_id || `${r.start_date || ''}-${i}`,
      ...r,
      dateObj,
      dateStr: dateObj
          ? dateObj.toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' })
          : '—',
      rankNum: Number(r.rank) || 0,
      revenue_qc_num,
      change_percent,
      screen_count,
      rev_per_screen,
      week_number,
    };
  });

  // --- Desktop header (reprend ton hero complet) ---
  const DesktopHeader = (
      <section className="tmdb-hero">
        {backdropUrl && (
            <div className="tmdb-hero__backdrop">
              <img src={backdropUrl} alt="" />
            </div>
        )}
        <div className="tmdb-hero__overlay" />

        <div className="tmdb-hero__content tmdb-hero__content--top">
          {/* Poster (small) */}
          <div className="tmdb-hero__poster tmdb-hero__poster--sm">
            {movie.poster_path ? (
                <img
                    src={TMDB.poster(movie.poster_path)}
                    alt={movie.fr_title || movie.title}
                    onError={(e) => { e.target.style.display = 'none'; }}
                />
            ) : (
                <div className="poster-placeholder"><span>🎬</span></div>
            )}
          </div>

          {/* Text + KPI + people */}
          <div className="tmdb-hero__text">
            <div className="tmdb-hero__titleblock">
              <h1 className="tmdb-hero__title">
                {movie.fr_title || movie.title}
                {year ? <span className="tmdb-hero__year">({year})</span> : null}
              </h1>
              {movie.fr_title && movie.title && movie.title !== movie.fr_title && (
                  <div className="tmdb-hero__subtitle">{movie.title}</div>
              )}
            </div>

            <div className="tmdb-hero__chips">
              {movie.release_date && (
                  <span className="chip chip--meta">
                {new Date(movie.release_date).toLocaleDateString('fr-CA')}
              </span>
              )}
              {runtime && <span className="chip chip--meta">{runtime}</span>}
              {genreChips}
              {countryChips}
            </div>

            {/* KPIs */}
            <div className="metrics">
              <div className="metric"><div className="metric__label">Recettes totales QC</div><div className="metric__value">{formatCurrency(totalQC)}</div></div>
              <div className="metric"><div className="metric__label">Recettes totales US</div><div className="metric__value">{formatCurrency(totalUS)}</div></div>
              <div className="metric"><div className="metric__label">Force Québec/USA</div><div className="metric__value">{forceQcUsa == null ? '—' : `${forceQcUsa.toFixed(0)}%`}</div></div>
              <div className="metric"><div className="metric__label">Semaines en salle</div><div className="metric__value">{maxWeeks || '—'}</div></div>
              <div className="metric"><div className="metric__label">Budget</div><div className="metric__value">{budget ? formatCurrency(budget) : '—'}</div></div>
            </div>

            {/* People */}
            <div className="people-block">
              {directors.length > 0 && (
                  <div className="people-group">
                    <div className="people-label">Réalisation</div>
                    <div className="people-list">
                      {directors.map((d) => (
                          <Link className="person person--text" to={`/crew/${d.id}`} key={`dir-${d.id}`}>
                            <span className="person-name">{d.name}</span>
                          </Link>
                      ))}
                    </div>
                  </div>
              )}

              {topCast.length > 0 && (
                  <div className="people-group">
                    <div className="people-label">Distribution</div>
                    <div className="people-list">
                      {topCast.map((a) => (
                          <Link className="person" to={`/crew/${a.id}`} key={`cast-${a.id}`}>
                            <div className="avatar">
                              <img
                                  src={TMDB.profile(a.profile_path) || ''}
                                  onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                                  alt=""
                              />
                            </div>
                            <span className="person-name">{a.name}</span>
                          </Link>
                      ))}
                    </div>
                  </div>
              )}
            </div>

            {movie.overview && (
                <div className="tmdb-hero__overview tmdb-hero__overview--short">
                  <p>{movie.overview}</p>
                </div>
            )}
          </div>
        </div>
      </section>
  );


  // le contenu Box Office (ta MovieTable)
  const tabBoxOffice = (
      revRows.length > 0 ? (
          <MovieTable
              rows={revRows}
              columns={pickColumns(
                  ['date','revenue_qc','change_percent','rank','screen_count','rev_per_screen','qc_usa','week_number','occupancy','weight'],
                  {
                    date: {
                      render: (_, r) => (
                          <Link to={`/box-office/${r.weekend_id}#movie-${movie.id}`} className="date-link" title="Voir le weekend">
                            {formatWeekendRange(r.weekend_id)}
                          </Link>
                      ),
                    },
                  }
              )}
              initialSort={{ key: 'date', dir: 'asc' }}
              initialVisibleKeys={['date','revenue_qc','change_percent','rank','screen_count','rev_per_screen','qc_usa']}
              caps={{ mobile: Infinity, tablet: Infinity, desktop: Infinity }}
              mobileMode="auto"
              searchAccessors={[r => r.dateObj?.toISOString?.().slice(0,10), r => String(r.rank)]}
          />
      ) : <div>Aucune donnée box-office.</div>
  );

  const tabInfo = (
      <section className="info-card">
        {/* Top meta (date + runtime) */}
        <div className="info-row info-meta">
          {movie.release_date && (
              <span className="chip chip--meta">
          {new Date(movie.release_date).toLocaleDateString('fr-CA')}
        </span>
          )}
          {runtime && <span className="chip chip--meta">{runtime}</span>}
        </div>

        {/* Genres */}
        {genres?.length > 0 && (
            <div className="info-row">
              <div className="info-subtle">Genres</div>
              <div className="info-chips">{genreChips}</div>
            </div>
        )}

        {/* Countries + Budget (if any) */}
        {(countries?.length || budget) ? (
            <div className="info-row info-kpis">
              {countries?.length ? (
                  <div className="info-kpi">
                    <div className="info-kpi__label">Pays</div>
                    <div className="info-kpi__value">{countryChips}</div>
                  </div>
              ) : null}
              {budget ? (
                  <div className="info-kpi">
                    <div className="info-kpi__label">Budget</div>
                    <div className="info-kpi__value">{formatCurrency(budget)}</div>
                  </div>
              ) : null}
            </div>
        ) : null}

        {/* Synopsis */}
        {movie.overview ? (
            <div className="info-row">
              <h3 className="info-h3">Synopsis</h3>
              <p className="info-text">{movie.overview}</p>
            </div>
        ) : null}

        {/* Cast */}
        {topCast.length > 0 && (
            <div className="info-row">
              <h3 className="info-h3">Distribution</h3>
              <ul className="info-cast">
                {topCast.map((a) => (
                    <li key={`cast-${a.id}`} className="info-cast__item">
                      <div className="avatar avatar--md">
                        <img
                            src={TMDB.profile(a.profile_path) || ''}
                            onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                            alt=""
                        />
                      </div>
                      <Link to={`/crew/${a.id}`} className="info-cast__name">
                        {a.name}
                      </Link>
                    </li>
                ))}
              </ul>
            </div>
        )}
      </section>
  );


  const tabStats = (
      <div style={{padding:"12px 0"}}>Statistiques à venir.</div>
  );

  const tabHoraire = <ShowingsTab movieId={movie?.id} />;

  const tabComparateur = (
      <div style={{ padding: '12px 0' }}>
        <Comparateur movieId={movie?.id} />
      </div>
  );


  const tabCorrection = (
      <CorrectionIdpanel tempId={id} onSuccess={handleIdCorrected} />
  );

  const MobileHeader = (
      <section className="tmdb-hero tmdb-hero--compact">
        {backdropUrl && (
            <div className="tmdb-hero__backdrop"><img src={backdropUrl} alt=""/></div>
        )}
        <div className="tmdb-hero__overlay" />
        <div className="tmdb-hero__content">
          <div className="tmdb-hero__poster">
            {movie.poster_path ? (
                <img src={TMDB.poster(movie.poster_path)} alt={movie.fr_title || movie.title}/>
            ) : <div className="poster-placeholder"><span>🎬</span></div>}
          </div>
          <div className="tmdb-hero__text">
            <div className="tmdb-hero__titleblock">
              <h1 className="tmdb-hero__title">
                {movie.fr_title || movie.title}
                {year ? <span className="tmdb-hero__year">({year})</span> : null}
              </h1>
              {movie.fr_title && movie.title && movie.title !== movie.fr_title && (
                  <div className="tmdb-hero__subtitle">{movie.title}</div>
              )}
            </div>

            {/* KPI minimal: Recettes QC */}
            <div className="metrics" style={{gridTemplateColumns:"1fr"}}>
              <div className="metric">
                <div className="metric__label">Recettes totales QC</div>
                <div className="metric__value">{formatCurrency(totalQC)}</div>
              </div>
            </div>

            {/* Réalisateur seulement */}
            {directors.length > 0 && (
                <div className="people-group">
                  <div className="people-label">Réalisation</div>
                  <div className="people-list">
                    {directors.map(d => (
                        <Link className="person person--text" to={`/crew/${d.id}`} key={`dir-${d.id}`}>
                          <span className="person-name">{d.name}</span>
                        </Link>
                    ))}
                  </div>
                </div>
            )}
          </div>
        </div>
      </section>
  );

// Tabs: only add the correction tab when isDev && isTempId
  const mobileTabs = [
    { key: "box", label: "Box Office", content: tabBoxOffice },
    { key: "info", label: "Info", content: tabInfo },
    { key: "stats", label: "Stats", content: tabStats },
    { key: "showings", label: "Horaire", content: tabHoraire },
    { key: "comparing", label: "Comparateur", content: tabComparateur },
    ...(isDev && isTempId ? [{ key: "fix", label: "Correction de l’ID", content: tabCorrection }] : []),
  ];

  const desktopTabs = [
    { key: "box", label: "Box Office", content: tabBoxOffice },
    { key: "stats", label: "Stats", content: tabStats },
    { key: "showings", label: "Horaire", content: tabHoraire },
    { key: "comparing", label: "Comparateur", content: tabComparateur },
    ...(isDev && isTempId ? [{ key: "fix", label: "Correction de l’ID", content: tabCorrection }] : []),
  ];

  // --- Rendu ---
  return (
      <div className="movie-details">
        <div className="movie-header">
          {isMobile ? (
              <>
                {MobileHeader}
                <Tabs tabs={mobileTabs} initialKey="box" />
              </>
          ) : (
              <>
                {DesktopHeader}
                <Tabs tabs={desktopTabs} initialKey="box" />
              </>
          )}
        </div>
      </div>
  );
}

export default MovieDetails;