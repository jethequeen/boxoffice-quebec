import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts'
import { apiCall } from '../utils/api'
import './MovieDetails.css'

function MovieDetails() {
  const { id } = useParams()
  const [movieData, setMovieData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchMovieDetails()
  }, [id])

  const fetchMovieDetails = async () => {
    try {
      setLoading(true)
      const result = await apiCall(`getMovieDetails?movieId=${id}`)
      setMovieData(result)
    } catch (err) {
      console.error('Error fetching movie details:', err)
      setError('Erreur lors du chargement des détails du film')
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (amount) => {
    if (!amount) return 'N/A'
    return new Intl.NumberFormat('fr-CA', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 0
    }).format(amount)
  }

  const formatWeekendId = (weekendId) => {
    const str = weekendId.toString()
    const year = str.slice(-4)
    const week = str.slice(0, -4)
    return `S${week} ${year}`
  }

  const formatWeekendDate = (weekendId) => {
    const str = weekendId.toString()
    const year = str.slice(-4)
    const week = parseInt(str.slice(0, -4))

    // Calculate approximate date (first day of year + (week-1) * 7 days)
    const startOfYear = new Date(parseInt(year), 0, 1)
    const weekStart = new Date(startOfYear.getTime() + (week - 1) * 7 * 24 * 60 * 60 * 1000)

    return weekStart.toLocaleDateString('fr-CA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  const calculatePercentChange = (current, previous) => {
    if (!previous || previous === 0) return null
    const change = ((current - previous) / previous) * 100
    return change
  }

  if (loading) {
    return (
      <div className="movie-details">
        <div className="loading">
          <div className="loading-spinner"></div>
          <p>Chargement des détails du film...</p>
        </div>
      </div>
    )
  }

  if (error || !movieData) {
    return (
      <div className="movie-details">
        <div className="error">
          <h2>Erreur</h2>
          <p>{error || 'Film non trouvé'}</p>
          <Link to="/movies" className="back-link">← Retour aux films</Link>
        </div>
      </div>
    )
  }

  const { movie, revenues, directors, genres, cast, statistics } = movieData

  // Prepare chart data - only Quebec data
  const revenueChartData = revenues.map(rev => ({
    weekend: formatWeekendId(rev.weekend_id),
    revenue_qc: parseFloat(rev.revenue_qc) || 0,
    rank: parseInt(rev.rank) || 0
  }))

  return (
    <div className="movie-details">
      <div className="movie-header">
        <Link to="/movies" className="back-link">← Retour aux films</Link>
        
        <div className="movie-hero">
          <div className="movie-poster">
            {movie.poster_path ? (
              <img 
                src={`https://image.tmdb.org/t/p/w500${movie.poster_path}`}
                alt={movie.fr_title || movie.title}
                onError={(e) => {
                  e.target.style.display = 'none'
                }}
              />
            ) : (
              <div className="poster-placeholder">
                <span>🎬</span>
              </div>
            )}
          </div>
          
          <div className="movie-info">
            <h1 className="movie-title">{movie.fr_title || movie.title}</h1>
            {movie.fr_title && movie.title !== movie.fr_title && (
              <h2 className="original-title">{movie.title}</h2>
            )}
            
            <div className="movie-meta">
              <div className="meta-item">
                <span className="meta-label">Date de sortie:</span>
                <span className="meta-value">
                  {movie.release_date ? new Date(movie.release_date).toLocaleDateString('fr-CA') : 'N/A'}
                </span>
              </div>
              
              {movie.runtime && (
                <div className="meta-item">
                  <span className="meta-label">Durée:</span>
                  <span className="meta-value">{movie.runtime} minutes</span>
                </div>
              )}
              
              <div className="meta-item">
                <span className="meta-label">Semaines en salle:</span>
                <span className="meta-value">{statistics.weeks_in_theaters} semaines</span>
              </div>
            </div>

            {movie.overview && (
              <div className="movie-overview">
                <h3>Synopsis</h3>
                <p>{movie.overview}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Performance Statistics */}
      <div className="stats-section">
        <h2>Performance au box-office</h2>
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon">💰</div>
            <div className="stat-content">
              <h3>Recettes totales QC</h3>
              <p className="stat-number">{formatCurrency(statistics.total_revenue_qc)}</p>
            </div>
          </div>
          
          <div className="stat-card">
            <div className="stat-icon">🇺🇸</div>
            <div className="stat-content">
              <h3>Recettes totales US</h3>
              <p className="stat-number">{formatCurrency(statistics.total_revenue_us)}</p>
            </div>
          </div>
          
          <div className="stat-card">
            <div className="stat-icon">📅</div>
            <div className="stat-content">
              <h3>Recettes week-ends QC</h3>
              <p className="stat-number">{formatCurrency(statistics.weekend_revenue_qc)}</p>
            </div>
          </div>
          
          <div className="stat-card">
            <div className="stat-icon">🏆</div>
            <div className="stat-content">
              <h3>Meilleur classement</h3>
              <p className="stat-number">#{statistics.best_rank}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Revenue Chart - Quebec only */}
      {revenueChartData.length > 0 && (
        <div className="chart-section">
          <h2>Évolution des recettes - Québec</h2>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={revenueChartData} margin={{ top: 20, right: 20, left: 20, bottom: 20 }}>
                <Tooltip
                  formatter={(value) => [formatCurrency(value), 'Recettes']}
                  labelFormatter={(label) => `Semaine ${label}`}
                  contentStyle={{
                    backgroundColor: 'white',
                    border: '1px solid #ccc',
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="revenue_qc"
                  stroke="#667eea"
                  strokeWidth={4}
                  dot={{ fill: '#667eea', strokeWidth: 2, r: 6 }}
                  activeDot={{ r: 8, fill: '#667eea' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Weekend Performance Table */}
      {revenues.length > 0 && (
        <div className="table-section">
          <h2>Weekend Box Office Performance</h2>
          <div className="table-container">
            <table className="performance-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Rank</th>
                  <th>Gross</th>
                  <th>% Change</th>
                  <th>Theaters</th>
                  <th>Per Theater</th>
                  <th>Week</th>
                </tr>
              </thead>
              <tbody>
                {revenues.map((rev, index) => {
                  const currentRevenue = parseFloat(rev.revenue_qc) || 0
                  const previousRevenue = index > 0 ? parseFloat(revenues[index - 1].revenue_qc) || 0 : null
                  const percentChange = calculatePercentChange(currentRevenue, previousRevenue)
                  const theaterCount = parseInt(rev.theater_count) || 0
                  const perTheater = theaterCount > 0 ? currentRevenue / theaterCount : 0

                  return (
                    <tr key={rev.weekend_id}>
                      <td className="date-cell">{formatWeekendDate(rev.weekend_id)}</td>
                      <td className="rank-cell">#{rev.rank}</td>
                      <td className="gross-cell">{formatCurrency(currentRevenue)}</td>
                      <td className={`change-cell ${percentChange !== null ? (percentChange >= 0 ? 'positive' : 'negative') : ''}`}>
                        {percentChange !== null ? `${percentChange > 0 ? '+' : ''}${percentChange.toFixed(0)}%` : '-'}
                      </td>
                      <td className="theater-cell">{theaterCount.toLocaleString()}</td>
                      <td className="per-theater-cell">{formatCurrency(perTheater)}</td>
                      <td className="week-cell">{index + 1}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cast and Crew */}
      <div className="details-grid">
        {/* Directors */}
        {directors.length > 0 && (
          <div className="detail-section">
            <h3>Réalisation</h3>
            <div className="person-list">
              {directors.map(director => (
                <Link 
                  key={director.id} 
                  to={`/crew/${director.id}`} 
                  className="person-link"
                >
                  🎭 {director.name}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Genres */}
        {genres.length > 0 && (
          <div className="detail-section">
            <h3>Genres</h3>
            <div className="genre-list">
              {genres.map(genre => (
                <Link 
                  key={genre.id} 
                  to={`/genres/${genre.id}`} 
                  className="genre-tag"
                >
                  {genre.name}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Cast */}
        {cast.length > 0 && (
          <div className="detail-section">
            <h3>Distribution</h3>
            <div className="cast-list">
              {cast.map(actor => (
                <div key={actor.id} className="cast-member">
                  <Link to={`/crew/${actor.id}`} className="actor-name">
                    {actor.name}
                  </Link>
                  {actor.character_name && (
                    <span className="character-name">({actor.character_name})</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default MovieDetails
