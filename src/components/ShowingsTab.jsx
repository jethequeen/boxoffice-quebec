import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { getMovieShowings } from '../utils/api';
import { formatCurrency } from "../utils/formatUtils.js";

const TIME_RANGES = [
  { value: '', label: 'Toutes les heures' },
  { value: '10-12', label: '10h - 12h' },
  { value: '12-14', label: '12h - 14h' },
  { value: '14-16', label: '14h - 16h' },
  { value: '16-18', label: '16h - 18h' },
  { value: '18-20', label: '18h - 20h' },
  { value: '20-23', label: '20h - 23h' },
];

function ShowingsTab({ movieId }) {
  const TICKET_PRICE = 13; // $13 per ticket

  // Get today's date in YYYY-MM-DD format
  const getTodayDate = () => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  };

  const [selectedDate, setSelectedDate] = useState(getTodayDate());
  const [selectedTheatre, setSelectedTheatre] = useState('');
  const [selectedTimeRange, setSelectedTimeRange] = useState('');
  const [selectedCompany, setSelectedCompany] = useState('');
  const [showingsData, setShowingsData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [collapsedTheaters, setCollapsedTheaters] = useState(new Set());
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    fetchShowings();
  }, [movieId, selectedDate, selectedTheatre, selectedTimeRange, selectedCompany]);

  useEffect(() => {
    if (userLocation) {
      fetchShowings();
    }
  }, [userLocation]);

  async function fetchShowings() {
    try {
      setLoading(true);
      setError(null);
      const result = await getMovieShowings(
        movieId,
        selectedDate || undefined,
        selectedTheatre || undefined,
        selectedTimeRange || undefined,
        selectedCompany || undefined,
        userLocation?.lat,
        userLocation?.lon,
        userLocation ? 50 : undefined
      );
      setShowingsData(result);
    } catch (err) {
      console.error('Error fetching showings:', err);
      setError('Erreur lors du chargement des représentations');
    } finally {
      setLoading(false);
    }
  }

  function handleNearbyClick() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lon: position.coords.longitude
          });
        },
        (err) => {
          console.error('Error getting location:', err);
          setError('Impossible d\'obtenir votre localisation');
        }
      );
    } else {
      setError('La géolocalisation n\'est pas supportée par votre navigateur');
    }
  }

  function clearNearby() {
    setUserLocation(null);
  }

  function toggleTheater(theaterId) {
    setCollapsedTheaters(prev => {
      const next = new Set(prev);
      if (next.has(theaterId)) {
        next.delete(theaterId);
      } else {
        next.add(theaterId);
      }
      return next;
    });
  }

  // Group showings by theater only
  const groupedShowings = useMemo(() => {
    if (!showingsData?.showings) return {};

    const groups = {};
    showingsData.showings.forEach((showing) => {
      const theatreKey = showing.theater_id;
      if (!groups[theatreKey]) {
        groups[theatreKey] = {
          theatre_id: showing.theater_id,
          theatre_name: showing.theatre_name,
          theatre_company: showing.theatre_company,
          theatre_website: showing.theatre_website,
          distance_km: showing.distance_km,
          showings: []
        };
      }

      groups[theatreKey].showings.push(showing);
    });

    return groups;
  }, [showingsData]);

  const formatTime = (timeStr) => {
    if (!timeStr) return '—';
    const date = new Date(timeStr);
    return date.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const calculateOccupancy = (seatsSold, totalSeats) => {
    if (!totalSeats || totalSeats === 0 || !seatsSold) return null;
    return (seatsSold / totalSeats) * 100;
  };

  const calculateRevenue = (seatsSold) => {
    if (!seatsSold) return null;
    return seatsSold * TICKET_PRICE;
  };

  const getShowingUrl = (showing) => {
    if (!showing.theatre_website) return null;

    // Format date for URL (YYYY-MM-DD)
    const dateStr = showing.date;

    // For Cineplex, we can build a specific URL
    if (showing.theatre_company?.toLowerCase().includes('cineplex')) {
      // This is a placeholder - actual Cineplex URL structure may vary
      return `${showing.theatre_website}/showtimes?date=${dateStr}`;
    }

    // For other theaters, just link to their website
    return showing.theatre_website;
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
            onChange={(e) => setSelectedDate(e.target.value)}
            style={{
              padding: '8px 12px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '14px'
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '150px' }}>
          <label htmlFor="time-filter" style={{ fontSize: '14px', fontWeight: '500' }}>
            Heure
          </label>
          <select
            id="time-filter"
            value={selectedTimeRange}
            onChange={(e) => setSelectedTimeRange(e.target.value)}
            style={{
              padding: '8px 12px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '14px'
            }}
          >
            {TIME_RANGES.map(range => (
              <option key={range.value} value={range.value}>{range.label}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '150px' }}>
          <label htmlFor="company-filter" style={{ fontSize: '14px', fontWeight: '500' }}>
            Bannière
          </label>
          <select
            id="company-filter"
            value={selectedCompany}
            onChange={(e) => setSelectedCompany(e.target.value)}
            style={{
              padding: '8px 12px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '14px'
            }}
          >
            <option value="">Toutes</option>
            {showingsData?.companies?.map((company) => (
              <option key={company} value={company}>
                {company}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '200px' }}>
          <label htmlFor="theatre-filter" style={{ fontSize: '14px', fontWeight: '500' }}>
            Cinéma
          </label>
          <select
            id="theatre-filter"
            value={selectedTheatre}
            onChange={(e) => setSelectedTheatre(e.target.value)}
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

        {/* Geolocation temporarily disabled - requires PostGIS on production */}
        {false && (userLocation ? (
          <button
            onClick={clearNearby}
            style={{
              padding: '8px 16px',
              background: '#666',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500'
            }}
          >
            Annuler proximité
          </button>
        ) : (
          <button
            onClick={handleNearbyClick}
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
            Cinémas proches de moi
          </button>
        ))}

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
          {userLocation && ' (triées par distance)'}
        </div>
      )}

      {/* Showings grouped by theater */}
      {Object.keys(groupedShowings).length > 0 ? (
        <div className="showings-list" style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
          gap: '24px'
        }}>
          {Object.entries(groupedShowings).map(([theatreKey, theatreData]) => {
            const isCollapsed = collapsedTheaters.has(theatreData.theatre_id);

            return (
              <div key={theatreKey} className="theatre-group" style={{
                border: '1px solid #e0e0e0',
                borderRadius: '8px',
                overflow: 'hidden'
              }}>
                {/* Theater header */}
                <div
                  style={{
                    background: '#f5f5f5',
                    padding: '12px 16px',
                    borderBottom: isCollapsed ? 'none' : '1px solid #e0e0e0',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                  onClick={() => toggleTheater(theatreData.theatre_id)}
                >
                  <div style={{ flex: 1 }}>
                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>
                      <Link
                        to={`/theaters/${theatreData.theatre_id}`}
                        onClick={(e) => e.stopPropagation()}
                        style={{ color: 'inherit', textDecoration: 'none' }}
                        onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                        onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                      >
                        {theatreData.theatre_name}
                      </Link>
                      {theatreData.theatre_company && (
                        <span style={{ fontWeight: '400', color: '#666', marginLeft: '8px', fontSize: '14px' }}>
                          ({theatreData.theatre_company})
                        </span>
                      )}
                    </h3>
                    {theatreData.distance_km != null && (
                      <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                        {theatreData.distance_km.toFixed(1)} km
                      </div>
                    )}
                  </div>
                  <div style={{
                    fontSize: '20px',
                    transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                    transition: 'transform 0.2s'
                  }}>
                    ▼
                  </div>
                </div>

                {/* Showings table */}
                {!isCollapsed && (
                  <div style={{ padding: '16px' }}>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        fontSize: '14px'
                      }}>
                        <thead>
                          <tr style={{ background: '#fafafa', borderBottom: '2px solid #e0e0e0' }}>
                            <th style={{ padding: '8px', textAlign: 'left', fontWeight: '600' }}>Salle</th>
                            <th style={{ padding: '8px', textAlign: 'left', fontWeight: '600' }}>Heure</th>
                            <th style={{ padding: '8px', textAlign: 'right', fontWeight: '600' }}>Sièges</th>
                            <th style={{ padding: '8px', textAlign: 'right', fontWeight: '600' }}>Vendus</th>
                            <th style={{ padding: '8px', textAlign: 'right', fontWeight: '600' }}>Occ.</th>
                            <th style={{ padding: '8px', textAlign: 'right', fontWeight: '600' }}>Recettes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {theatreData.showings.map((showing) => {
                            const occupancy = calculateOccupancy(showing.seats_sold, showing.total_seats);
                            const revenue = calculateRevenue(showing.seats_sold);
                            const showingUrl = getShowingUrl(showing);

                            return (
                              <tr key={showing.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                                <td style={{ padding: '8px' }}>{showing.auditorium || '—'}</td>
                                <td style={{ padding: '8px' }}>
                                  {showingUrl ? (
                                    <a
                                      href={showingUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{ color: '#6a67f5', textDecoration: 'none' }}
                                      onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                                      onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                                    >
                                      {formatTime(showing.start_at)}
                                    </a>
                                  ) : (
                                    formatTime(showing.start_at)
                                  )}
                                </td>
                                <td style={{ padding: '8px', textAlign: 'right' }}>
                                  {showing.total_seats?.toLocaleString('fr-CA') || '—'}
                                </td>
                                <td style={{ padding: '8px', textAlign: 'right' }}>
                                  {showing.seats_sold != null ? showing.seats_sold.toLocaleString('fr-CA') : '—'}
                                </td>
                                <td style={{ padding: '8px', textAlign: 'right' }}>
                                  {occupancy != null ? (
                                    <span style={{
                                      color: occupancy < 3 ? '#f00' : occupancy < 10 ? '#666' : '#0a0'
                                    }}>
                                      {occupancy.toFixed(1)}%
                                    </span>
                                  ) : '—'}
                                </td>
                                <td style={{ padding: '8px', textAlign: 'right', fontWeight: '500' }}>
                                  {revenue != null ? formatCurrency(revenue) : '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
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

export default ShowingsTab;
