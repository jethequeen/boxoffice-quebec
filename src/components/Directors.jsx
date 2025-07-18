import { useState, useEffect } from 'react'
import { getDirectorStats } from '../utils/api'
import './Directors.css'

function Directors() {
  const [directors, setDirectors] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [viewType, setViewType] = useState('top_grossing')

  useEffect(() => {
    fetchDirectors()
  }, [viewType])

  const fetchDirectors = async () => {
    try {
      setLoading(true)
      const result = await getDirectorStats(viewType)

      if (result.data) {
        setDirectors(result.data)
      }
    } catch (err) {
      console.error('Error fetching directors:', err)
      setError('Erreur lors du chargement des réalisateurs')
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

  if (loading) {
    return (
      <div className="directors">
        <div className="loading">
          <div className="loading-spinner"></div>
          <p>Chargement des réalisateurs...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="directors">
        <div className="error">
          <h2>Erreur</h2>
          <p>{error}</p>
          <button onClick={fetchDirectors} className="retry-button">
            Réessayer
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="directors">
      <div className="directors-header">
        <h1>Réalisateurs</h1>
        <p>Statistiques et performances des réalisateurs au box-office québécois</p>
      </div>

      <div className="view-controls">
        <button
          className={`view-button ${viewType === 'top_grossing' ? 'active' : ''}`}
          onClick={() => setViewType('top_grossing')}
        >
          💰 Plus gros succès
        </button>
        <button
          className={`view-button ${viewType === 'most_prolific' ? 'active' : ''}`}
          onClick={() => setViewType('most_prolific')}
        >
          🎬 Plus prolifiques
        </button>
        <button
          className={`view-button ${viewType === 'best_average' ? 'active' : ''}`}
          onClick={() => setViewType('best_average')}
        >
          📊 Meilleure moyenne
        </button>
      </div>

      <div className="directors-grid">
        {directors.map((director, index) => (
          <div key={director.id} className="director-card">
            <div className="director-rank">#{index + 1}</div>
            <div className="director-content">
              <h3 className="director-name">{director.name}</h3>
              <div className="director-details">
                <div className="detail-item">
                  <span className="detail-label">Films:</span>
                  <span className="detail-value">{director.total_movies || 0}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Recettes totales:</span>
                  <span className="detail-value gross">{formatCurrency(director.total_gross)}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Moyenne par week-end:</span>
                  <span className="detail-value">{formatCurrency(director.avg_weekend_gross)}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {directors.length === 0 && (
        <div className="no-data">
          <h3>Aucune donnée disponible</h3>
          <p>Il n'y a pas de réalisateurs à afficher pour le moment.</p>
        </div>
      )}
    </div>
  )
}

export default Directors
