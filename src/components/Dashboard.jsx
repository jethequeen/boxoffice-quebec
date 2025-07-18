import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { getBoxOfficeData, getMovieStats, getWeekendInfo, getPreviousWeekend, getWeekCounts } from '../utils/api'
import './Dashboard.css'

function Dashboard() {
  const [weekendData, setWeekendData] = useState([])
  const [previousWeekendData, setPreviousWeekendData] = useState([])
  const [weekCounts, setWeekCounts] = useState({})
  const [movieStats, setMovieStats] = useState(null)
  const [weekendInfo, setWeekendInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchDashboardData()
  }, [])

  const fetchDashboardData = async () => {
    try {
      setLoading(true)

      // Fetch weekend box office data
      const weekendResult = await getBoxOfficeData('weekend', 10)

      // Fetch movie statistics
      const statsResult = await getMovieStats('summary')

      // Fetch latest weekend info
      const weekendInfoResult = await getWeekendInfo()

      if (weekendResult.data) {
        setWeekendData(weekendResult.data)
        
        // Get the current weekend ID from the first movie
        if (weekendResult.data.length > 0) {
          const currentWeekendId = weekendResult.data[0].weekend_id
          
          // Fetch previous weekend data
          try {
            const previousResult = await getPreviousWeekend(currentWeekendId)
            if (previousResult.data) {
              setPreviousWeekendData(previousResult.data)
            }
          } catch (err) {
            console.log('Previous weekend data not available:', err)
          }
          
          // Fetch week counts
          try {
            const weekCountsResult = await getWeekCounts(currentWeekendId)
            if (weekCountsResult.data) {
              setWeekCounts(weekCountsResult.data)
            }
          } catch (err) {
            console.log('Week counts not available:', err)
          }
        }
      }

      if (statsResult.data) {
        setMovieStats(statsResult.data)
      }

      if (weekendInfoResult.data && weekendInfoResult.data.length > 0) {
        setWeekendInfo(weekendInfoResult.data[0]) // Get the latest weekend
      }

    } catch (err) {
      console.error('Error fetching dashboard data:', err)
      setError('Erreur lors du chargement des données')
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (amount) => {
    if (!amount) return 'N/A'
    return new Intl.NumberFormat('fr-CA', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount)
  }

  // Calculate enhanced data for box office table
  const getEnhancedMovieData = () => {
    if (!weekendData.length) return []

    // Create lookup for previous weekend data
    const previousLookup = {}
    previousWeekendData.forEach(movie => {
      previousLookup[movie.id] = movie
    })

    return weekendData.map(movie => {
      const currentRevQC = parseFloat(movie.revenue_qc) || 0
      const currentRevUS = parseFloat(movie.revenue_us) || 0
      const previousMovie = previousLookup[movie.id]

      // Calculate change percent
      let changePercent = 0
      if (previousMovie) {
        const prevRevQC = parseFloat(previousMovie.revenue_qc) || 0
        if (prevRevQC > 0) {
          changePercent = ((currentRevQC - prevRevQC) / prevRevQC) * 100
        }
      }
      // If no previous movie found, changePercent stays 0 (new release)

      // Calculate Force Québec/USA using 2.29% population ratio
      let forceQuebecUSA = null
      if (currentRevUS > 0) {
        const actualRatio = (currentRevQC / currentRevUS) * 100
        const expectedRatio = 2.29
        forceQuebecUSA = (actualRatio / expectedRatio) * 100
      }

      // Get week number from database
      const weekNumber = weekCounts[movie.id] || 1

      // Simple studio assignment
      let studioName = 'Independent'
      const title = (movie.title || movie.fr_title || '').toLowerCase()
      if (title.includes('superman')) studioName = 'DC Studios'
      else if (title.includes('jurassic')) studioName = 'Universal Pictures'
      else if (title.includes('menteuse')) studioName = 'Amalga'
      else if (title.includes('f1')) studioName = 'Plan B Entertainment'
      else if (title.includes('dragon')) studioName = 'DreamWorks Animation'
      else if (title.includes('lilo') || title.includes('stitch')) studioName = 'Walt Disney Pictures'
      else if (title.includes('elio')) studioName = 'Pixar'
      else if (title.includes('mission')) studioName = 'Paramount Pictures'
      else if (title.includes('28 years')) studioName = 'Columbia Pictures'
      else if (title.includes('deux femmes')) studioName = 'Amérique Film'

      return {
        ...movie,
        change_percent: changePercent,
        force_quebec_usa: forceQuebecUSA,
        week_number: weekNumber,
        studio_name: studioName,
        cumulatif_qc: parseFloat(movie.cumulatif_qc) || currentRevQC
      }
    })
  }

  if (loading) {
    return (
      <div className="dashboard">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Chargement du tableau de bord...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="dashboard">
        <div className="error-container">
          <h2>Erreur</h2>
          <p>{error}</p>
          <button onClick={fetchDashboardData} className="retry-button">
            Réessayer
          </button>
        </div>
      </div>
    )
  }

  const enhancedMovies = getEnhancedMovieData()

  // Calculate overall statistics
  const calculateOverallStats = () => {
    if (!enhancedMovies.length) return { totalChange: 0, totalForceQcUsa: 0 }

    // Calculate average change percent (excluding 0% values for new releases)
    const moviesWithChange = enhancedMovies.filter(movie => movie.change_percent !== 0)
    const avgChange = moviesWithChange.length > 0
      ? moviesWithChange.reduce((sum, movie) => sum + movie.change_percent, 0) / moviesWithChange.length
      : 0

    // Calculate overall Force Québec/USA
    const totalRevQC = enhancedMovies.reduce((sum, movie) => sum + (parseFloat(movie.revenue_qc) || 0), 0)
    const totalRevUS = enhancedMovies.reduce((sum, movie) => sum + (parseFloat(movie.revenue_us) || 0), 0)
    const overallForceQcUsa = totalRevUS > 0
      ? ((totalRevQC / totalRevUS) * 100) / 2.29 * 100
      : 0

    return {
      totalChange: avgChange,
      totalForceQcUsa: overallForceQcUsa
    }
  }

  const overallStats = calculateOverallStats()

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Tableau de bord</h1>
        <p>Vue d'ensemble du box-office québécois</p>
        {weekendInfo && (
          <div className="current-weekend">
            <span className="weekend-badge">
              📅 {weekendInfo.formatted_weekend} - {weekendInfo.total_movies} films
            </span>
          </div>
        )}
      </div>

      {/* Box Office Statistics Cards */}
      {enhancedMovies.length > 0 && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon"></div>
            <div className="stat-content">
              <h3>Films suivis</h3>
              <p className="stat-number">{enhancedMovies.length}</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon"></div>
            <div className="stat-content">
              <h3>Recettes totales</h3>
              <p className="stat-number">
                {formatCurrency(enhancedMovies.reduce((sum, movie) => sum + (parseFloat(movie.revenue_qc) || 0), 0))}
              </p>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon"></div>
            <div className="stat-content">
              <h3>Changement</h3>
              <p className={`stat-number ${overallStats.totalChange >= 0 ? 'positive' : 'negative'}`}>
                {overallStats.totalChange > 0 ? '+' : ''}{overallStats.totalChange.toFixed(0)}%
              </p>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon"></div>
            <div className="stat-content">
              <h3>Force Québec/USA</h3>
              <p className="stat-number">{overallStats.totalForceQcUsa.toFixed(0)}%</p>
            </div>
          </div>
        </div>
      )}

      {/* Box Office Table */}
      {enhancedMovies.length > 0 && (
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
                {enhancedMovies.map((movie, index) => (
                  <tr key={movie.id}>
                    <td className="movie-cell">
                      <Link to={`/movies/${movie.id}`} className="movie-title-link">
                        <strong>{movie.fr_title || movie.title}</strong>
                      </Link>
                    </td>
                    <td className="gross-cell">{formatCurrency(movie.revenue_qc)}</td>
                    <td className={`change-cell ${movie.change_percent >= 0 ? 'positive' : 'negative'}`}>
                      {movie.change_percent > 0 ? '+' : ''}{movie.change_percent.toFixed(0)}%
                    </td>
                    <td className="ratio-cell">
                      {movie.force_quebec_usa !== null ? `${movie.force_quebec_usa.toFixed(0)}%` : '-'}
                    </td>
                    <td className="week-cell">{movie.week_number}</td>
                    <td className="cumulative-cell">{formatCurrency(movie.cumulatif_qc)}</td>
                    <td className="studio-cell">{movie.studio_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default Dashboard
