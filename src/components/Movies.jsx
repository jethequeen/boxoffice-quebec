import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getMovieStats } from '../utils/api'
import './Movies.css'

function Movies() {
  const [movies, setMovies] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [viewType, setViewType] = useState('top_grossing')

  useEffect(() => {
    fetchMovies()
  }, [viewType])

  const fetchMovies = async () => {
    try {
      setLoading(true)
      const result = await getMovieStats(viewType)

      if (result.data) {
        setMovies(result.data)
      }
    } catch (err) {
      console.error('Error fetching movies:', err)
      setError('Erreur lors du chargement des films')
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

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A'
    return new Date(dateString).toLocaleDateString('fr-CA')
  }

  if (loading) {
    return (
      <div className="movies">
        <div className="loading">
          <div className="loading-spinner"></div>
          <p>Chargement des films...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="movies">
        <div className="error">
          <h2>Erreur</h2>
          <p>{error}</p>
          <button onClick={fetchMovies} className="retry-button">
            Réessayer
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="movies">
      <div className="movies-header">
        <h1>Films</h1>
        <p>Statistiques et performances des films au box-office québécois</p>
      </div>

      <div className="movies-grid">
        {movies.map((movie, index) => (
          <div key={movie.id} className="movie-card">
            <div className="movie-rank">#{index + 1}</div>
            <div className="movie-content">
              <Link to={`/movies/${movie.id}`} className="movie-title-link">
                <h3 className="movie-title">{movie.fr_title || movie.title}</h3>
              </Link>
              <div className="movie-details">
                <div className="detail-item">
                  <span className="detail-label">Date de sortie:</span>
                  <span className="detail-value">{formatDate(movie.release_date)}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Recettes totales:</span>
                  <span className="detail-value gross">{formatCurrency(movie.total_gross)}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Semaines en salle:</span>
                  <span className="detail-value">{movie.weeks_in_theaters || 0} semaines</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {movies.length === 0 && (
        <div className="no-data">
          <h3>Aucune donnée disponible</h3>
          <p>Il n'y a pas de films à afficher pour le moment.</p>
        </div>
      )}
    </div>
  )
}

export default Movies
