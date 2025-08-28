import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiCall } from '../utils/api';
import './MovieDetails.css';
import { getFridayFromWeekendId } from '../utils/weekendUtils';
import { createColumnsCatalog } from '../utils/catalog';
import MovieTable from '../components/movieTable';
import { formatCurrency, toNum, pct0} from "../utils/formatUtils.js";


function MovieDetails() {
  const { id } = useParams();
  const [movieData, setMovieData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const formatWeekendRange = (weekendId) => {
    const fri = getFridayFromWeekendId(String(weekendId));
    if (!fri) return '—';
    const sun = new Date(fri);
    sun.setDate(sun.getDate() + 2);
    const dd = (d) => d.toLocaleString('fr-CA', { day: '2-digit' });
    const month = sun.toLocaleString('fr-CA', { month: 'long' });
    const year = sun.getFullYear();
    return `Du ${dd(fri)} au ${dd(sun)} ${month} ${year}`;
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


  return (
      <div className="movie-details">
        <div className="movie-header compact">

          <section className="tmdb-hero tmdb-hero--tight">
            {backdropUrl && (
                <div className="tmdb-hero__backdrop">
                  <img src={backdropUrl} alt="" loading="lazy" />
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
                      <span className="chip chip--meta">{new Date(movie.release_date).toLocaleDateString('fr-CA')}</span>
                  )}
                  {runtime && <span className="chip chip--meta">{runtime}</span>}
                  {genreChips}
                  {countryChips}
                </div>

                {/* KPIs (5 tuiles) */}
                <div className="metrics">
                  <div className="metric">
                    <div className="metric__label">Recettes totales QC</div>
                    <div className="metric__value">{formatCurrency(totalQC)}</div>
                  </div>
                  <div className="metric">
                    <div className="metric__label">Recettes totales US</div>
                    <div className="metric__value">{formatCurrency(totalUS)}</div>
                  </div>
                  <div className="metric">
                    <div className="metric__label">Force Québec/USA</div>
                    <div className="metric__value">{forceQcUsa == null ? '—' : `${forceQcUsa.toFixed(0)}%`}</div>
                  </div>
                  <div className="metric">
                    <div className="metric__label">Semaines en salle</div>
                    <div className="metric__value">{maxWeeks || '—'}</div>
                  </div>
                  <div className="metric">
                    <div className="metric__label">Budget</div>
                    <div className="metric__value">{budget ? formatCurrency(budget) : '—'}</div>
                  </div>
                </div>

                {/* People: réal (sans avatar) + cast (avec avatar) */}
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
        </div>

        {/* Table (same behavior/style as WeekendDetails) */}
        {revRows.length > 0 && (
            <MovieTable
                rows={revRows}
                columns={pickColumns(
                    ['date','revenue_qc','change_percent','rank','screen_count','rev_per_screen','qc_usa','week_number', 'occupancy', 'weight'],
                    {
                      date: {
                        // keep default value/sort from catalog; just change how it renders
                        render: (_, r) => (
                            <Link
                                to={`/box-office/${r.weekend_id}#movie-${movie.id}`}
                                className="date-link"
                                title="Voir le weekend"
                            >
                              {formatWeekendRange(r.weekend_id)}
                            </Link>
                        ),
                      },
                    }
                )}
                initialSort={{ key: 'date', dir: 'asc' }}
                initialVisibleKeys={['date','revenue_qc','change_percent','rank','screen_count','rev_per_screen','qc_usa']}
                caps={{ mobile: 4, tablet: 7, desktop: Infinity }}
                mobileMode="auto"
                searchAccessors={[r => r.dateObj?.toISOString?.().slice(0,10), r => String(r.rank)]}
            />

        )}
      </div>
  );
}

export default MovieDetails;
