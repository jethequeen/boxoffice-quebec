import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { getTopStats, getAutocomplete } from '../utils/api';
import { formatCurrency } from '../utils/formatUtils';
import './Movies.css';

function Movies() {
  // Get default date range: Jan 1st of current year to today
  const getDefaultDateRange = () => {
    const today = new Date();
    const startOfYear = new Date(today.getFullYear(), 0, 1);
    return {
      startDate: startOfYear.toISOString().split('T')[0],
      endDate: today.toISOString().split('T')[0]
    };
  };

  const defaultRange = getDefaultDateRange();

  const [startDate, setStartDate] = useState(defaultRange.startDate);
  const [endDate, setEndDate] = useState(defaultRange.endDate);
  const [topStats, setTopStats] = useState(null);
  const [topStatsCanadian, setTopStatsCanadian] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [filters, setFilters] = useState({
    directors: '',
    actors: '',
    studios: '',
    genres: '',
    countries: ''
  });

  // Autocomplete state
  const [suggestions, setSuggestions] = useState({});
  const [activeSuggestion, setActiveSuggestion] = useState(null);
  const [selectedNames, setSelectedNames] = useState({
    directors: [],
    actors: [],
    studios: [],
    genres: [],
    countries: []
  });
  const suggestionTimeouts = useRef({});

  useEffect(() => {
    fetchTopStats();
  }, [startDate, endDate]);

  const fetchTopStats = async () => {
    try {
      setLoading(true);
      setError(null);

      // Build filter object excluding empty values
      const activeFilters = {};
      Object.entries(filters).forEach(([key, value]) => {
        if (value && value.trim()) {
          activeFilters[key] = value.trim();
        }
      });

      // Fetch both regular and Canadian tops in parallel
      const [result, resultCanadian] = await Promise.all([
        getTopStats(startDate, endDate, activeFilters, false),
        getTopStats(startDate, endDate, activeFilters, true)
      ]);

      setTopStats(result);
      setTopStatsCanadian(resultCanadian);
    } catch (err) {
      console.error('Error fetching top stats:', err);
      setError('Erreur lors du chargement des statistiques');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyFilters = () => {
    fetchTopStats();
  };

  const handleFilterChange = async (type, value) => {
    // Clear previous timeout
    if (suggestionTimeouts.current[type]) {
      clearTimeout(suggestionTimeouts.current[type]);
    }

    // Update filter value
    setFilters(prev => ({ ...prev, [type]: value }));

    // Don't show suggestions if input is too short
    if (value.length < 2) {
      setSuggestions(prev => ({ ...prev, [type]: [] }));
      return;
    }

    // Debounce the API call
    suggestionTimeouts.current[type] = setTimeout(async () => {
      try {
        const data = await getAutocomplete(type, value);
        setSuggestions(prev => ({ ...prev, [type]: data.results || [] }));
        setActiveSuggestion(type);
      } catch (err) {
        console.error('Error fetching suggestions:', err);
      }
    }, 300);
  };

  const handleSuggestionClick = (type, item) => {
    // Add the ID to the filter
    const currentIds = filters[type] ? filters[type].split(',').filter(Boolean) : [];
    if (!currentIds.includes(String(item.id))) {
      currentIds.push(item.id);
      setFilters(prev => ({ ...prev, [type]: currentIds.join(',') }));

      // Add the name to selected names for display
      setSelectedNames(prev => ({
        ...prev,
        [type]: [...prev[type], { id: item.id, name: item.name }]
      }));
    }

    // Clear suggestions and input
    setSuggestions(prev => ({ ...prev, [type]: [] }));
    setActiveSuggestion(null);
  };

  const handleRemoveSelection = (type, itemId) => {
    // Remove from filter IDs
    const currentIds = filters[type].split(',').filter(id => id !== String(itemId));
    setFilters(prev => ({ ...prev, [type]: currentIds.join(',') }));

    // Remove from selected names
    setSelectedNames(prev => ({
      ...prev,
      [type]: prev[type].filter(item => item.id !== itemId)
    }));
  };

  if (loading) {
    return (
      <div className="movies">
        <div className="loading">
          <div className="loading-spinner"></div>
          <p>Chargement des statistiques...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="movies">
        <div className="error">
          <h2>Erreur</h2>
          <p>{error}</p>
          <button onClick={fetchTopStats} className="retry-button">
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="movies" style={{ padding: '20px' }}>
      {/* Header */}
      <div className="movies-header" style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: '700', color: '#0f172a' }}>
          Classements
        </h1>
        <p style={{ margin: 0, color: '#64748b', fontSize: '15px' }}>
          Tops des films, genres, studios, pays et acteurs au box-office québécois
        </p>
      </div>

      {/* Date Range and Filters */}
      <div style={{
        background: 'white',
        borderRadius: '12px',
        padding: '20px',
        marginBottom: '24px',
        boxShadow: '0 1px 3px rgba(0,0,0,.08)'
      }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600', color: '#0f172a' }}>
          Période et filtres
        </h3>

        {/* Date Range */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <div style={{ flex: '1', minWidth: '150px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500', color: '#64748b' }}>
              Date de début
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '14px',
                color: '#0f172a'
              }}
            />
          </div>
          <div style={{ flex: '1', minWidth: '150px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500', color: '#64748b' }}>
              Date de fin
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '14px',
                color: '#0f172a'
              }}
            />
          </div>
        </div>

        {/* Filters - TODO: Add autocomplete lookup components */}
        <details style={{ marginBottom: '12px' }}>
          <summary style={{
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '500',
            color: '#6366f1',
            padding: '8px 0',
            userSelect: 'none'
          }}>
            Filtres avancés (optionnel)
          </summary>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '12px',
            marginTop: '12px'
          }}>
            <div style={{ position: 'relative' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500', color: '#64748b' }}>
                Réalisateurs
              </label>
              {selectedNames.directors.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                  {selectedNames.directors.map(item => (
                    <span key={item.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 8px', background: '#f1f5f9', borderRadius: '4px', fontSize: '12px', color: '#475569' }}>
                      {item.name}
                      <button onClick={() => handleRemoveSelection('directors', item.id)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '0', color: '#64748b', fontSize: '14px' }}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <input
                type="text"
                placeholder="Rechercher un réalisateur..."
                onChange={(e) => handleFilterChange('directors', e.target.value)}
                onFocus={() => setActiveSuggestion('directors')}
                onBlur={() => setTimeout(() => setActiveSuggestion(null), 200)}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '14px' }}
              />
              {activeSuggestion === 'directors' && suggestions.directors?.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)', zIndex: 10, maxHeight: '200px', overflowY: 'auto', marginTop: '4px' }}>
                  {suggestions.directors.map(item => (
                    <div key={item.id} onClick={() => handleSuggestionClick('directors', item)} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '14px', color: '#0f172a', borderBottom: '1px solid #f1f5f9' }} onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={(e) => e.currentTarget.style.background = 'white'}>{item.name}</div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500', color: '#64748b' }}>
                Acteurs (IDs)
              </label>
              <input
                type="text"
                placeholder="ex: 789,012"
                value={filters.actors}
                onChange={(e) => setFilters({ ...filters, actors: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500', color: '#64748b' }}>
                Studios (IDs)
              </label>
              <input
                type="text"
                placeholder="ex: 123,456"
                value={filters.studios}
                onChange={(e) => setFilters({ ...filters, studios: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500', color: '#64748b' }}>
                Genres (IDs)
              </label>
              <input
                type="text"
                placeholder="ex: 28,12"
                value={filters.genres}
                onChange={(e) => setFilters({ ...filters, genres: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500', color: '#64748b' }}>
                Pays (codes)
              </label>
              <input
                type="text"
                placeholder="ex: CA,US"
                value={filters.countries}
                onChange={(e) => setFilters({ ...filters, countries: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
              />
            </div>
          </div>
          <button
            onClick={handleApplyFilters}
            style={{
              marginTop: '12px',
              padding: '8px 16px',
              background: '#6366f1',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#4f46e5'}
            onMouseLeave={(e) => e.currentTarget.style.background = '#6366f1'}
          >
            Appliquer les filtres
          </button>
        </details>
      </div>

      {/* Top Lists */}
      {topStats && (
        <>
          {/* Top 20 Movies - Two columns */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 450px), 1fr))',
            gap: '24px',
            marginBottom: '24px'
          }}>
            {/* Top 20 All Movies */}
            <section style={{
              background: 'white',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: '0 1px 3px rgba(0,0,0,.08)'
            }}>
              <h2 style={{ margin: '0 0 16px 0', fontSize: '20px', fontWeight: '600', color: '#0f172a' }}>
                Top 20 Films
              </h2>
            {topStats.topMovies && topStats.topMovies.length > 0 ? (
              <div style={{ display: 'grid', gap: '12px' }}>
                {topStats.topMovies.map((movie, index) => (
                  <div
                    key={movie.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '16px',
                      padding: '12px',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#f8fafc';
                      e.currentTarget.style.borderColor = '#cbd5e1';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.borderColor = '#e5e7eb';
                    }}
                  >
                    <div style={{
                      minWidth: '32px',
                      height: '32px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: index < 3 ? '#fef3c7' : '#f1f5f9',
                      borderRadius: '6px',
                      fontSize: '16px',
                      fontWeight: '700',
                      color: index < 3 ? '#92400e' : '#64748b'
                    }}>
                      {index + 1}
                    </div>
                    {movie.poster_path && (
                      <img
                        src={`https://image.tmdb.org/t/p/w92${movie.poster_path}`}
                        alt={movie.fr_title || movie.title}
                        style={{
                          width: '40px',
                          height: '60px',
                          objectFit: 'cover',
                          borderRadius: '4px'
                        }}
                      />
                    )}
                    <div style={{ flex: 1 }}>
                      <Link
                        to={`/movies/${movie.id}`}
                        style={{
                          fontSize: '15px',
                          fontWeight: '600',
                          color: '#0f172a',
                          textDecoration: 'none'
                        }}
                      >
                        {movie.fr_title || movie.title}
                      </Link>
                      <div style={{ fontSize: '13px', color: '#64748b', marginTop: '2px' }}>
                        {new Date(movie.release_date).toLocaleDateString('fr-CA')}
                      </div>
                    </div>
                    <div style={{
                      fontSize: '16px',
                      fontWeight: '700',
                      color: '#6366f1',
                      whiteSpace: 'nowrap'
                    }}>
                      {formatCurrency(movie.revenue_in_range)}
                    </div>
                  </div>
                ))}
              </div>
              ) : (
                <p style={{ color: '#94a3b8', fontStyle: 'italic' }}>Aucun film trouvé pour cette période</p>
              )}
            </section>

            {/* Top 20 Canadian Movies */}
            <section style={{
              background: 'white',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: '0 1px 3px rgba(0,0,0,.08)'
            }}>
              <h2 style={{ margin: '0 0 16px 0', fontSize: '20px', fontWeight: '600', color: '#0f172a' }}>
                Top 20 Films Canadiens 🍁
              </h2>
              {topStatsCanadian?.topMovies && topStatsCanadian.topMovies.length > 0 ? (
                <div style={{ display: 'grid', gap: '12px' }}>
                  {topStatsCanadian.topMovies.map((movie, index) => (
                    <div
                      key={movie.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '16px',
                        padding: '12px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#f8fafc';
                        e.currentTarget.style.borderColor = '#cbd5e1';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.borderColor = '#e5e7eb';
                      }}
                    >
                      <div style={{
                        minWidth: '32px',
                        height: '32px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: index < 3 ? '#fef3c7' : '#f1f5f9',
                        borderRadius: '6px',
                        fontSize: '16px',
                        fontWeight: '700',
                        color: index < 3 ? '#92400e' : '#64748b'
                      }}>
                        {index + 1}
                      </div>
                      {movie.poster_path && (
                        <img
                          src={`https://image.tmdb.org/t/p/w92${movie.poster_path}`}
                          alt={movie.fr_title || movie.title}
                          style={{
                            width: '40px',
                            height: '60px',
                            objectFit: 'cover',
                            borderRadius: '4px'
                          }}
                        />
                      )}
                      <div style={{ flex: 1 }}>
                        <Link
                          to={`/movies/${movie.id}`}
                          style={{
                            fontSize: '15px',
                            fontWeight: '600',
                            color: '#0f172a',
                            textDecoration: 'none'
                          }}
                        >
                          {movie.fr_title || movie.title}
                        </Link>
                        <div style={{ fontSize: '13px', color: '#64748b', marginTop: '2px' }}>
                          {new Date(movie.release_date).toLocaleDateString('fr-CA')}
                        </div>
                      </div>
                      <div style={{
                        fontSize: '16px',
                        fontWeight: '700',
                        color: '#dc2626',
                        whiteSpace: 'nowrap'
                      }}>
                        {formatCurrency(movie.revenue_in_range)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: '#94a3b8', fontStyle: 'italic' }}>Aucun film canadien trouvé pour cette période</p>
              )}
            </section>
          </div>

          {/* Grid of Other Tops */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: '24px'
          }}>
            {/* Top 10 Genres */}
            <section style={{
              background: 'white',
              borderRadius: '12px',
              padding: '20px',
              boxShadow: '0 1px 3px rgba(0,0,0,.08)'
            }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: '600', color: '#0f172a' }}>
                Top 10 Genres
              </h3>
              {topStats.topGenres && topStats.topGenres.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {topStats.topGenres.map((genre, index) => (
                    <div key={genre.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>
                          {index + 1}. {genre.name}
                        </span>
                        <span style={{ fontSize: '12px', color: '#94a3b8', marginLeft: '8px' }}>
                          ({genre.movie_count} films)
                        </span>
                      </div>
                      <div style={{ fontSize: '14px', fontWeight: '600', color: '#3b82f6' }}>
                        {formatCurrency(genre.total_revenue)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: '#94a3b8', fontSize: '13px', fontStyle: 'italic' }}>Aucune donnée</p>
              )}
            </section>

            {/* Top 10 Studios */}
            <section style={{
              background: 'white',
              borderRadius: '12px',
              padding: '20px',
              boxShadow: '0 1px 3px rgba(0,0,0,.08)'
            }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: '600', color: '#0f172a' }}>
                Top 10 Studios
              </h3>
              {topStats.topStudios && topStats.topStudios.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {topStats.topStudios.map((studio, index) => (
                    <div key={studio.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>
                          {index + 1}. {studio.name}
                        </span>
                        <span style={{ fontSize: '12px', color: '#94a3b8', marginLeft: '8px' }}>
                          ({studio.movie_count} films)
                        </span>
                      </div>
                      <div style={{ fontSize: '14px', fontWeight: '600', color: '#8b5cf6' }}>
                        {formatCurrency(studio.total_revenue)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: '#94a3b8', fontSize: '13px', fontStyle: 'italic' }}>Aucune donnée</p>
              )}
            </section>

            {/* Top 10 Countries */}
            <section style={{
              background: 'white',
              borderRadius: '12px',
              padding: '20px',
              boxShadow: '0 1px 3px rgba(0,0,0,.08)'
            }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: '600', color: '#0f172a' }}>
                Top 10 Pays
              </h3>
              {topStats.topCountries && topStats.topCountries.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {topStats.topCountries.map((country, index) => (
                    <div key={country.code} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>
                          {index + 1}. {country.name}
                        </span>
                        <span style={{ fontSize: '12px', color: '#94a3b8', marginLeft: '8px' }}>
                          ({country.movie_count} films)
                        </span>
                      </div>
                      <div style={{ fontSize: '14px', fontWeight: '600', color: '#10b981' }}>
                        {formatCurrency(country.total_revenue)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: '#94a3b8', fontSize: '13px', fontStyle: 'italic' }}>Aucune donnée</p>
              )}
            </section>

            {/* Top 10 Actors */}
            <section style={{
              background: 'white',
              borderRadius: '12px',
              padding: '20px',
              boxShadow: '0 1px 3px rgba(0,0,0,.08)'
            }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: '600', color: '#0f172a' }}>
                Top 10 Acteurs
              </h3>
              {topStats.topActors && topStats.topActors.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {topStats.topActors.map((actor, index) => (
                    <div key={actor.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>
                          {index + 1}. {actor.name}
                        </span>
                        <span style={{ fontSize: '12px', color: '#94a3b8', marginLeft: '8px' }}>
                          ({actor.movie_count} films)
                        </span>
                      </div>
                      <div style={{ fontSize: '14px', fontWeight: '600', color: '#f59e0b' }}>
                        {formatCurrency(actor.total_revenue)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: '#94a3b8', fontSize: '13px', fontStyle: 'italic' }}>Aucune donnée</p>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

export default Movies;
