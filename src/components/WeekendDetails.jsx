import {useEffect, useState} from 'react'
import {Link, useNavigate, useParams} from 'react-router-dom'
import {getBoxOfficeData, getPreviousWeekend, getPrincipalStudios, getWeekCounts} from '../utils/api'
import {
  formatWeekendId,
  getCurrentWeekendId,
  getFridayFromWeekendId,
  getNextWeekendId,
  getPreviousWeekendId,
  parseWeekendId
} from '../utils/weekendUtils'
import './Dashboard.css'
import './BoxOffice.css'

function WeekendDetails({ weekendId: propWeekendId, showNavigation = false }) {
  const { weekendId: paramWeekendId } = useParams()
  const navigate = useNavigate()
  const weekendId = propWeekendId || paramWeekendId || getCurrentWeekendId()

  const [weekendData, setWeekendData] = useState([])
  const [previousWeekendData, setPreviousWeekendData] = useState([])
  const [weekCounts, setWeekCounts] = useState({})
  const [weekendInfo] = useState(null)
  const [availableWeekends, setAvailableWeekends] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [studioNames, setStudios] = useState({})

  const realWeekendId = weekendId || getCurrentWeekendId()

  useEffect(() => {
    fetchWeekendData()
    if (showNavigation) {
      generateAvailableWeekends()
    }
  }, [realWeekendId, showNavigation])

  const generateAvailableWeekends = () => {
    const current = getCurrentWeekendId()
    const weekends = []
    const { week, year } = parseWeekendId(current)

    for (let i = 0; i < 5; i++) {
      let targetWeek = week - i
      let targetYear = year

      if (targetWeek <= 0) {
        targetYear -= 1
        targetWeek = 52 + targetWeek
      }

      const weekendId = `${targetWeek.toString().padStart(2, '0')}${targetYear}`
      const fridayDate = getFridayFromWeekendId(weekendId)

      weekends.push({
        weekend_id: weekendId,
        formatted_weekend: formatWeekendId(weekendId),
        display_date: fridayDate ? fridayDate.toLocaleDateString('fr-CA', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        }) : 'Date inconnue'
      })
    }

    setAvailableWeekends(weekends)
  }

  const handleWeekendChange = (newWeekendId) => {
    if (showNavigation) {
      navigate(`/box-office/${newWeekendId}`)
    }
  }

  const navigateToPrevious = () => {
    const prevWeekendId = getPreviousWeekendId(realWeekendId)
    handleWeekendChange(prevWeekendId)
  }

  const navigateToNext = () => {
    const currentWeekend = getCurrentWeekendId()
    if (realWeekendId >= currentWeekend) return

    const nextWeekendId = getNextWeekendId(realWeekendId)
    handleWeekendChange(nextWeekendId)
  }

  const fetchWeekendData = async () => {
    try {
      setLoading(true)

      console.log('Fetching weekend data for', realWeekendId)
      const weekendResult = await getBoxOfficeData(10, realWeekendId)

      console.log('Weekend info result:', weekendResult)

      if (weekendResult.data) {
        setWeekendData(weekendResult.data)
        
        // Get the weekend ID from the data or use the provided one
        const currentWeekendId = weekendResult.data.length > 0 ? weekendResult.data[0].weekend_id : realWeekendId
        
        // Fetch previous weekend data
        try {
          const previousResult = await getPreviousWeekend(currentWeekendId)
          if (previousResult.data) {
            setPreviousWeekendData(previousResult.data)
          }
        } catch (err) {
          console.log('Previous weekend data not available:', err)
          setPreviousWeekendData([])
        }

        const studiosResult = await fetchStudios(weekendResult.data)
        setStudios(studiosResult)

        // Fetch week counts
        try {
          const weekCountsResult = await getWeekCounts(currentWeekendId)
          if (weekCountsResult.data) {
            setWeekCounts(weekCountsResult.data)
          }
        } catch (err) {
          console.log('Week counts not available:', err)
          setWeekCounts({})
        }
      }



    } catch (err) {
      console.error('Error fetching weekend data:', err)
      setError('Erreur lors du chargement des données du weekend')
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
      
      // Calculate Force Québec/USA using 2.29% population ratio
      let forceQuebecUSA = null
      if (currentRevUS > 0) {
        const actualRatio = (currentRevQC / currentRevUS) * 100
        const expectedRatio = 2.29
        forceQuebecUSA = (actualRatio / expectedRatio) * 100
      }
      // Get week number from database
      const weekNumber = weekCounts[movie.id] || 1
      // Get studio name from database
      const studioName = studioNames[movie.id] || 'Independent'

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

  const fetchStudios = async (movies) => {
    const ids = movies.map(m => m.id)
    try {
      return await getPrincipalStudios(ids)
    } catch (err) {
      console.error('Erreur lors de la récupération des studios:', err)
      return {}
    }
  }



  const enhancedMovies = getEnhancedMovieData()

  const calculateOverallStats = () => {
    if (!enhancedMovies.length || !previousWeekendData.length) {
      return { totalChange: 0, totalForceQcUsa: 0 }
    }

    // 🔁 1. Somme totale QC ce week-end
    const currentTotalQC = enhancedMovies.reduce((sum, movie) => sum + (parseFloat(movie.revenue_qc) || 0), 0)

    // 🔁 2. Somme totale QC week-end précédent
    const previousTotalQC = previousWeekendData.reduce((sum, movie) => sum + (parseFloat(movie.revenue_qc) || 0), 0)

    // 📈 3. Changement global en %
    const totalChange = previousTotalQC > 0
        ? ((currentTotalQC - previousTotalQC) / previousTotalQC) * 100
        : 0

    // 📊 4. Force Québec / USA
    const totalRevQC = enhancedMovies.reduce((sum, movie) => sum + (parseFloat(movie.revenue_qc) || 0), 0)
    const totalRevUS = enhancedMovies.reduce((sum, movie) => sum + (parseFloat(movie.revenue_us) || 0), 0)

    const overallForceQcUsa = totalRevUS > 0
        ? ((totalRevQC / totalRevUS) * 100) / 2.29 * 100
        : 0

    return {
      totalChange,
      totalForceQcUsa: overallForceQcUsa
    }
  }


  const overallStats = calculateOverallStats()
  const isCurrentWeekend = !realWeekendId || realWeekendId === getCurrentWeekendId()

  if (loading) {
    return (
      <div className="dashboard">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Chargement des données du weekend...</p>
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
          <button onClick={fetchWeekendData} className="retry-button">
            Réessayer
          </button>
        </div>
      </div>
    )
  }

  const canGoNext = realWeekendId < getCurrentWeekendId()

  return (
    <div className="dashboard">
      {/* Weekend Navigation - only show when showNavigation is true */}
      {showNavigation && (
        <div className="box-office-header">
          <div className="weekend-navigation">
            <button
              className="nav-arrow prev"
              onClick={navigateToPrevious}
              title="Weekend précédent"
            >
              ←
            </button>

            <div className="weekend-selector">
              <select
                value={realWeekendId}
                onChange={(e) => handleWeekendChange(e.target.value)}
                className="weekend-dropdown"
              >
                {availableWeekends.map(weekend => (
                  <option key={weekend.weekend_id} value={weekend.weekend_id}>
                    {weekend.display_date}
                  </option>
                ))}
              </select>
            </div>

            <button
              className={`nav-arrow next ${!canGoNext ? 'disabled' : ''}`}
              onClick={navigateToNext}
              disabled={!canGoNext}
              title="Weekend suivant"
            >
              →
            </button>
          </div>

          {isCurrentWeekend && (
            <div className="current-badge">
              <span className="badge">Weekend actuel</span>
            </div>
          )}
        </div>
      )}

      <div className="dashboard-header">
        <h1>{realWeekendId ? formatWeekendId(realWeekendId) : 'Box-office québécois'}</h1>
        <p>{realWeekendId ? 'Détails du weekend' : 'Weekend actuel'}</p>
        
        {/* Show weekend info for current weekend */}
        {weekendInfo && isCurrentWeekend && (
          <div className="current-weekend">
            <span className="weekend-badge">
              📅 {weekendInfo.formatted_weekend} - {weekendInfo.total_movies} films
            </span>
          </div>
        )}
        
        {/* Show basic info for historical weekends */}
        {realWeekendId && !isCurrentWeekend && (
          <div className="current-weekend">
            <span className="weekend-badge historical">
              📅 {formatWeekendId(realWeekendId)} - {enhancedMovies.length} films
            </span>
          </div>
        )}
      </div>

      {/* Box Office Statistics Cards */}
      {enhancedMovies.length > 0 && (
        <div className="stats-grid">
          
          <div className="stat-card">
            <div className="stat-icon">💰</div>
            <div className="stat-content">
              <h3>Recettes totales</h3>
              <p className="stat-number">
                {formatCurrency(enhancedMovies.reduce((sum, movie) => sum + (parseFloat(movie.revenue_qc) || 0), 0))}
              </p>
            </div>
          </div>
          
          <div className="stat-card">
            <div className="stat-icon">📈</div>
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
                {enhancedMovies.map((movie) => (
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

export default WeekendDetails
