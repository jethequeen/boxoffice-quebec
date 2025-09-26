import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiCall } from '../utils/api';
import './MovieDetails.css';
import { getFridayFromWeekendId } from '../utils/weekendUtils';
import { createColumnsCatalog } from '../utils/catalog';
import MovieTable from '../components/movieTable';
import { formatCurrency, toNum, pct0} from "../utils/formatUtils.js";
import { useNavigate } from "react-router-dom";
import Tabs from "../components/Tabs";
import CorrectionIdPanel from "../components/CorrectionIdPanel";

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(`(max-width:${breakpoint}px)`).matches);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width:${breakpoint}px)`);
    const onChange = e => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [breakpoint]);
  return isMobile;
}


function MovieDetails() {
  const { id } = useParams();
  const [movieData, setMovieData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const isTempId = Number(id) >= 10_000_000; // Temporaire

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
      const result = await apiCall(`getMovieDetails?movieId=${id}`);
      setMovieData(result);
    } catch (err) {
      console.error('Error fetching movie details:', err);
      setError('Erreur lors du chargement des détails du film');
    } finally {
      setLoading(false);
    }
  }

  function handleIdCorrected(newId) {
    navigate(`/movie/${newId}`, { replace: true });
    // on pourrait aussi refetch ici si tu veux rester sur place
  }

  const { pickColumns } = createColumnsCatalog({ Link, formatCurrency, pct0, toNum })


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

  const tabCorrection = (
      <CorrectionIdPanel tempId={id} onSuccess={handleIdCorrected} />
  );

  // Header minimal pour mobile (poster/banner, titres, recettes QC, réal)
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

  // Construction des onglets selon la plateforme
  const mobileTabs = [
    { key: "box", label: "Box Office", content: tabBoxOffice },
    { key: "info", label: "Info", content: tabInfo },
    { key: "stats", label: "Stats", content: tabStats },
    ...(isTempId ? [{ key: "fix", label: "Correction de l’ID", content: tabCorrection }] : []),
  ];

  const desktopTabs = [
    { key: "box", label: "Box Office", content: tabBoxOffice },
    { key: "stats", label: "Stats", content: tabStats },
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
                {DesktopHeader}                                   {/* <-- remet le vrai header */}
                <Tabs tabs={desktopTabs} initialKey="box" />
              </>
          )}
        </div>
      </div>
  );
}

export default MovieDetails;