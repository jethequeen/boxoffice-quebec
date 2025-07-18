import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import './GenreDetails.css'

function GenreDetails() {
  const { id } = useParams()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Simulate loading
    setTimeout(() => setLoading(false), 1000)
  }, [id])

  if (loading) {
    return (
      <div className="genre-details">
        <div className="loading">
          <div className="loading-spinner"></div>
          <p>Chargement des détails du genre...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="genre-details">
      <div className="genre-header">
        <Link to="/movies" className="back-link">← Retour</Link>
        <h1>Détails du Genre #{id}</h1>
        <p>Page en développement</p>
      </div>
      
      <div className="coming-soon">
        <div className="coming-soon-icon">🎭</div>
        <h2>Bientôt disponible</h2>
        <p>
          Cette page affichera les détails complets du genre, incluant :
        </p>
        <div className="features-preview">
          <div className="feature-item">
            <span className="feature-icon">🎬</span>
            <span>Films du genre</span>
          </div>
          <div className="feature-item">
            <span className="feature-icon">📊</span>
            <span>Statistiques de performance</span>
          </div>
          <div className="feature-item">
            <span className="feature-icon">📈</span>
            <span>Tendances temporelles</span>
          </div>
          <div className="feature-item">
            <span className="feature-icon">🏆</span>
            <span>Top films du genre</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default GenreDetails
