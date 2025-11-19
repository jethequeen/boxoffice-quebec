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
  const [inputValues, setInputValues] = useState({
    directors: '',
    actors: '',
    studios: '',
    genres: '',
    countries: ''
  });
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
      console.error('Error details:', err.details);
      setError(`Erreur lors du chargement des statistiques: ${err.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyFilters = () => {
    fetchTopStats();
  };

  const handleApplyFiltersAllTime = () => {
    // Set date range to all time before fetching
    const today = new Date();
    setStartDate('2000-01-01');
    setEndDate(today.toISOString().split('T')[0]);
    // fetchTopStats will be called automatically via useEffect when dates change
  };

  const handleFilterChange = async (type, value) => {
    // Clear previous timeout
    if (suggestionTimeouts.current[type]) {
      clearTimeout(suggestionTimeouts.current[type]);
    }

    // Update input value (for display only, not the filter)
    setInputValues(prev => ({ ...prev, [type]: value }));

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
    setInputValues(prev => ({ ...prev, [type]: '' }));
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

        {/* Filters */}
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
                value={inputValues.directors}
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
            <div style={{ position: 'relative' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500', color: '#64748b' }}>
                Acteurs
              </label>
              {selectedNames.actors.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                  {selectedNames.actors.map(item => (
                    <span key={item.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 8px', background: '#f1f5f9', borderRadius: '4px', fontSize: '12px', color: '#475569' }}>
                      {item.name}
                      <button onClick={() => handleRemoveSelection('actors', item.id)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '0', color: '#64748b', fontSize: '14px' }}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <input
                type="text"
                placeholder="Rechercher un acteur..."
                value={inputValues.actors}
                onChange={(e) => handleFilterChange('actors', e.target.value)}
                onFocus={() => setActiveSuggestion('actors')}
                onBlur={() => setTimeout(() => setActiveSuggestion(null), 200)}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '14px' }}
              />
              {activeSuggestion === 'actors' && suggestions.actors?.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)', zIndex: 10, maxHeight: '200px', overflowY: 'auto', marginTop: '4px' }}>
                  {suggestions.actors.map(item => (
                    <div key={item.id} onClick={() => handleSuggestionClick('actors', item)} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '14px', color: '#0f172a', borderBottom: '1px solid #f1f5f9' }} onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={(e) => e.currentTarget.style.background = 'white'}>{item.name}</div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ position: 'relative' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500', color: '#64748b' }}>
                Studios
              </label>
              {selectedNames.studios.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                  {selectedNames.studios.map(item => (
                    <span key={item.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 8px', background: '#f1f5f9', borderRadius: '4px', fontSize: '12px', color: '#475569' }}>
                      {item.name}
                      <button onClick={() => handleRemoveSelection('studios', item.id)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '0', color: '#64748b', fontSize: '14px' }}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <input
                type="text"
                placeholder="Rechercher un studio..."
                value={inputValues.studios}
                onChange={(e) => handleFilterChange('studios', e.target.value)}
                onFocus={() => setActiveSuggestion('studios')}
                onBlur={() => setTimeout(() => setActiveSuggestion(null), 200)}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '14px' }}
              />
              {activeSuggestion === 'studios' && suggestions.studios?.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)', zIndex: 10, maxHeight: '200px', overflowY: 'auto', marginTop: '4px' }}>
                  {suggestions.studios.map(item => (
                    <div key={item.id} onClick={() => handleSuggestionClick('studios', item)} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '14px', color: '#0f172a', borderBottom: '1px solid #f1f5f9' }} onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={(e) => e.currentTarget.style.background = 'white'}>{item.name}</div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ position: 'relative' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500', color: '#64748b' }}>
                Genres
              </label>
              {selectedNames.genres.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                  {selectedNames.genres.map(item => (
                    <span key={item.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 8px', background: '#f1f5f9', borderRadius: '4px', fontSize: '12px', color: '#475569' }}>
                      {item.name}
                      <button onClick={() => handleRemoveSelection('genres', item.id)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '0', color: '#64748b', fontSize: '14px' }}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <input
                type="text"
                placeholder="Rechercher un genre..."
                value={inputValues.genres}
                onChange={(e) => handleFilterChange('genres', e.target.value)}
                onFocus={() => setActiveSuggestion('genres')}
                onBlur={() => setTimeout(() => setActiveSuggestion(null), 200)}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '14px' }}
              />
              {activeSuggestion === 'genres' && suggestions.genres?.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)', zIndex: 10, maxHeight: '200px', overflowY: 'auto', marginTop: '4px' }}>
                  {suggestions.genres.map(item => (
                    <div key={item.id} onClick={() => handleSuggestionClick('genres', item)} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '14px', color: '#0f172a', borderBottom: '1px solid #f1f5f9' }} onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={(e) => e.currentTarget.style.background = 'white'}>{item.name}</div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ position: 'relative' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500', color: '#64748b' }}>
                Pays
              </label>
              {selectedNames.countries.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                  {selectedNames.countries.map(item => (
                    <span key={item.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 8px', background: '#f1f5f9', borderRadius: '4px', fontSize: '12px', color: '#475569' }}>
                      {item.name}
                      <button onClick={() => handleRemoveSelection('countries', item.id)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '0', color: '#64748b', fontSize: '14px' }}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <input
                type="text"
                placeholder="Rechercher un pays..."
                value={inputValues.countries}
                onChange={(e) => handleFilterChange('countries', e.target.value)}
                onFocus={() => setActiveSuggestion('countries')}
                onBlur={() => setTimeout(() => setActiveSuggestion(null), 200)}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '14px' }}
              />
              {activeSuggestion === 'countries' && suggestions.countries?.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)', zIndex: 10, maxHeight: '200px', overflowY: 'auto', marginTop: '4px' }}>
                  {suggestions.countries.map(item => (
                    <div key={item.id} onClick={() => handleSuggestionClick('countries', item)} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '14px', color: '#0f172a', borderBottom: '1px solid #f1f5f9' }} onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={(e) => e.currentTarget.style.background = 'white'}>{item.name}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '12px', marginTop: '12px', flexWrap: 'wrap' }}>
            <button
              onClick={handleApplyFilters}
              style={{
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
            <button
              onClick={handleApplyFiltersAllTime}
              style={{
                padding: '8px 16px',
                background: '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#059669'}
              onMouseLeave={(e) => e.currentTarget.style.background = '#10b981'}
            >
              Appliquer les filtres pour tout les temps
            </button>
          </div>
        </details>
      </div>

      {/* Top Lists */}
      {topStats && (
        <>
          {/* Top 20 Movies - Two columns */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
            gap: '16px',
            marginBottom: '16px'
          }}>
            {/* Top 20 All Movies */}
            <details open style={{
              background: 'white',
              borderRadius: '12px',
              padding: '16px',
              boxShadow: '0 1px 3px rgba(0,0,0,.08)'
            }}>
              <summary style={{
                cursor: 'pointer',
                fontSize: '18px',
                fontWeight: '600',
                color: '#0f172a',
                listStyle: 'none',
                marginBottom: '12px',
                userSelect: 'none'
              }}>
                Top 20 Films
              </summary>
            {topStats.topMovies && topStats.topMovies.length > 0 ? (
              <div style={{ overflowX: 'auto', margin: '0 -16px', padding: '0 16px' }}>
                <div style={{ display: 'grid', gap: '8px', minWidth: 'fit-content' }}>
                  {topStats.topMovies.map((movie, index) => (
                    <div
                      key={movie.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '8px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '6px',
                        transition: 'all 0.2s',
                        minWidth: '400px'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#fef2f2';
                        e.currentTarget.style.borderColor = '#fca5a5';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.borderColor = '#e5e7eb';
                      }}
                    >
                      <div style={{
                        minWidth: '24px',
                        height: '24px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: index < 3 ? '#fef3c7' : '#f1f5f9',
                        borderRadius: '4px',
                        fontSize: '13px',
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
                      <div style={{ flex: 1, minWidth: '120px', maxWidth: '200px' }}>
                        <Link
                          to={`/movies/${movie.id}`}
                          style={{
                            fontSize: '13px',
                            fontWeight: '600',
                            color: '#0f172a',
                            textDecoration: 'none',
                            display: 'block',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {movie.fr_title || movie.title}
                        </Link>
                        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                          {new Date(movie.release_date).toLocaleDateString('fr-CA')}
                        </div>
                      </div>
                      <div style={{
                        fontSize: '13px',
                        fontWeight: '700',
                        color: '#dc2626',
                        whiteSpace: 'nowrap'
                      }}>
                        {formatCurrency(movie.revenue_in_range)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              ) : (
                <p style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '13px' }}>Aucun film trouvé pour cette période</p>
              )}
            </details>

            {/* Top 20 Quebec Movies */}
            <details open style={{
              background: 'white',
              borderRadius: '12px',
              padding: '16px',
              boxShadow: '0 1px 3px rgba(0,0,0,.08)'
            }}>
              <summary style={{
                cursor: 'pointer',
                fontSize: '18px',
                fontWeight: '600',
                color: '#0f172a',
                listStyle: 'none',
                marginBottom: '12px',
                userSelect: 'none'
              }}>
                Top 20 Films Québécois
              </summary>
              {topStatsCanadian?.topMovies && topStatsCanadian.topMovies.length > 0 ? (
                <div style={{ overflowX: 'auto', margin: '0 -16px', padding: '0 16px' }}>
                  <div style={{ display: 'grid', gap: '8px', minWidth: 'fit-content' }}>
                    {topStatsCanadian.topMovies.map((movie, index) => (
                      <div
                        key={movie.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '8px',
                          border: '1px solid #e5e7eb',
                          borderRadius: '6px',
                          transition: 'all 0.2s',
                          minWidth: '400px'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = '#eff6ff';
                          e.currentTarget.style.borderColor = '#93c5fd';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                          e.currentTarget.style.borderColor = '#e5e7eb';
                        }}
                      >
                        <div style={{
                          minWidth: '24px',
                          height: '24px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: index < 3 ? '#fef3c7' : '#f1f5f9',
                          borderRadius: '4px',
                          fontSize: '13px',
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
                        <div style={{ flex: 1, minWidth: '120px', maxWidth: '200px' }}>
                          <Link
                            to={`/movies/${movie.id}`}
                            style={{
                              fontSize: '13px',
                              fontWeight: '600',
                              color: '#0f172a',
                              textDecoration: 'none',
                              display: 'block',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            {movie.fr_title || movie.title}
                          </Link>
                          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                            {new Date(movie.release_date).toLocaleDateString('fr-CA')}
                          </div>
                        </div>
                        <div style={{
                          fontSize: '13px',
                          fontWeight: '700',
                          color: '#6366f1',
                          whiteSpace: 'nowrap'
                        }}>
                          {formatCurrency(movie.revenue_in_range)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '13px' }}>Aucun film québécois trouvé pour cette période</p>
              )}
            </details>
          </div>

          {/* Grid of Other Tops */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))',
            gap: '16px'
          }}>
            {/* Top 10 Genres */}
            <details open style={{
              background: 'white',
              borderRadius: '12px',
              padding: '16px',
              boxShadow: '0 1px 3px rgba(0,0,0,.08)'
            }}>
              <summary style={{
                cursor: 'pointer',
                fontSize: '16px',
                fontWeight: '600',
                color: '#0f172a',
                listStyle: 'none',
                marginBottom: '12px',
                userSelect: 'none'
              }}>
                Top 10 Genres
              </summary>
              {topStats.topGenres && topStats.topGenres.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {topStats.topGenres.map((genre, index) => (
                    <div key={genre.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: '13px', fontWeight: '600', color: '#0f172a' }}>
                          {index + 1}. {genre.name}
                        </span>
                        <span style={{ fontSize: '11px', color: '#94a3b8', marginLeft: '6px', whiteSpace: 'nowrap' }}>
                          ({genre.movie_count})
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', fontWeight: '600', color: '#3b82f6', whiteSpace: 'nowrap' }}>
                        {formatCurrency(genre.total_revenue)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: '#94a3b8', fontSize: '13px', fontStyle: 'italic' }}>Aucune donnée</p>
              )}
            </details>

            {/* Top 10 Studios */}
            <details open style={{
              background: 'white',
              borderRadius: '12px',
              padding: '16px',
              boxShadow: '0 1px 3px rgba(0,0,0,.08)'
            }}>
              <summary style={{
                cursor: 'pointer',
                fontSize: '16px',
                fontWeight: '600',
                color: '#0f172a',
                listStyle: 'none',
                marginBottom: '12px',
                userSelect: 'none'
              }}>
                Top 10 Studios
              </summary>
              {topStats.topStudios && topStats.topStudios.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {topStats.topStudios.map((studio, index) => (
                    <div key={studio.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: '13px', fontWeight: '600', color: '#0f172a', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {index + 1}. {studio.name}
                        </span>
                        <span style={{ fontSize: '11px', color: '#94a3b8', whiteSpace: 'nowrap' }}>
                          ({studio.movie_count})
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', fontWeight: '600', color: '#8b5cf6', whiteSpace: 'nowrap' }}>
                        {formatCurrency(studio.total_revenue)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: '#94a3b8', fontSize: '13px', fontStyle: 'italic' }}>Aucune donnée</p>
              )}
            </details>

            {/* Top 10 Countries */}
            <details open style={{
              background: 'white',
              borderRadius: '12px',
              padding: '16px',
              boxShadow: '0 1px 3px rgba(0,0,0,.08)'
            }}>
              <summary style={{
                cursor: 'pointer',
                fontSize: '16px',
                fontWeight: '600',
                color: '#0f172a',
                listStyle: 'none',
                marginBottom: '12px',
                userSelect: 'none'
              }}>
                Top 10 Pays
              </summary>
              {topStats.topCountries && topStats.topCountries.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {topStats.topCountries.map((country, index) => (
                    <div key={country.code} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: '13px', fontWeight: '600', color: '#0f172a' }}>
                          {index + 1}. {country.name}
                        </span>
                        <span style={{ fontSize: '11px', color: '#94a3b8', marginLeft: '6px', whiteSpace: 'nowrap' }}>
                          ({country.movie_count})
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', fontWeight: '600', color: '#10b981', whiteSpace: 'nowrap' }}>
                        {formatCurrency(country.total_revenue)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: '#94a3b8', fontSize: '13px', fontStyle: 'italic' }}>Aucune donnée</p>
              )}
            </details>

            {/* Top 10 Actors */}
            <details open style={{
              background: 'white',
              borderRadius: '12px',
              padding: '16px',
              boxShadow: '0 1px 3px rgba(0,0,0,.08)'
            }}>
              <summary style={{
                cursor: 'pointer',
                fontSize: '16px',
                fontWeight: '600',
                color: '#0f172a',
                listStyle: 'none',
                marginBottom: '12px',
                userSelect: 'none'
              }}>
                Top 10 Acteurs
              </summary>
              {topStats.topActors && topStats.topActors.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {topStats.topActors.map((actor, index) => (
                    <div key={actor.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: '13px', fontWeight: '600', color: '#0f172a', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {index + 1}. {actor.name}
                        </span>
                        <span style={{ fontSize: '11px', color: '#94a3b8', whiteSpace: 'nowrap' }}>
                          ({actor.movie_count})
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', fontWeight: '600', color: '#f59e0b', whiteSpace: 'nowrap' }}>
                        {formatCurrency(actor.total_revenue)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: '#94a3b8', fontSize: '13px', fontStyle: 'italic' }}>Aucune donnée</p>
              )}
            </details>
          </div>
        </>
      )}
    </div>
  );
}

export default Movies;
