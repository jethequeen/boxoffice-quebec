import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import './CrewDetails.css'

function CrewDetails() {
  const { id } = useParams()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Simulate loading
    setTimeout(() => setLoading(false), 1000)
  }, [id])

  if (loading) {
    return (
      <div className="crew-details">
        <div className="loading">
          <div className="loading-spinner"></div>
          <p>Chargement des détails de la personne...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="crew-details">
      <div className="crew-header">
        <Link to="/" className="back-link">← Retour</Link>
        <h1>Détails de la Personne #{id}</h1>
        <p>Page en développement</p>
      </div>
      
      <div className="coming-soon">
        <div className="coming-soon-icon"></div>
        <h2>Bientôt disponible</h2>
        <p>
          Cette page affichera les détails complets de la personne, incluant :
        </p>
        <div className="features-preview">
          <div className="feature-item">
            <span className="feature-icon"></span>
            <span>Filmographie complète</span>
          </div>
          <div className="feature-item">
            <span className="feature-icon"></span>
            <span>Statistiques de carrière</span>
          </div>
          <div className="feature-item">
            <span className="feature-icon"></span>
            <span>Succès et récompenses</span>
          </div>
          <div className="feature-item">
            <span className="feature-icon"></span>
            <span>Évolution des performances</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CrewDetails
