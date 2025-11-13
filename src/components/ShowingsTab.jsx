import { useState, useEffect, useMemo, useRef } from 'react';
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

// Date Range Picker Component
function DateRangePicker({ dateFrom, dateTo, onApply, onCancel }) {
  const [tempFrom, setTempFrom] = useState(dateFrom);
  const [tempTo, setTempTo] = useState(dateTo);
  const [selectingFrom, setSelectingFrom] = useState(true);

  const handleDateClick = (date) => {
    if (selectingFrom) {
      setTempFrom(date);
      setTempTo(date);
      setSelectingFrom(false);
    } else {
      if (date < tempFrom) {
        setTempFrom(date);
        setTempTo(date);
      } else {
        setTempTo(date);
      }
    }
  };

  const handleApply = () => {
    onApply(tempFrom, tempTo);
  };

  const getDaysInMonth = (year, month) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const renderCalendar = (monthOffset = 0) => {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + monthOffset;
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = new Date(year, month, 1).getDay();

    const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
    const dayNames = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

    const days = [];
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} style={{ padding: '8px' }} />);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isFrom = date === tempFrom;
      const isTo = date === tempTo;
      const isInRange = date >= tempFrom && date <= tempTo;
      const isToday = date === new Date().toISOString().split('T')[0];

      days.push(
        <div
          key={day}
          onClick={() => handleDateClick(date)}
          style={{
            padding: '8px',
            textAlign: 'center',
            cursor: 'pointer',
            borderRadius: '4px',
            fontSize: '13px',
            fontWeight: isFrom || isTo ? '600' : '400',
            background: isFrom || isTo ? '#6366f1' : isInRange ? '#e0e7ff' : 'transparent',
            color: isFrom || isTo ? 'white' : isToday ? '#6366f1' : '#0f172a',
            border: isToday && !isFrom && !isTo ? '1px solid #6366f1' : '1px solid transparent',
          }}
          onMouseEnter={(e) => {
            if (!isFrom && !isTo) e.currentTarget.style.background = '#f1f5f9';
          }}
          onMouseLeave={(e) => {
            if (!isFrom && !isTo && !isInRange) e.currentTarget.style.background = 'transparent';
          }}
        >
          {day}
        </div>
      );
    }

    return (
      <div style={{ padding: '12px' }}>
        <div style={{ fontWeight: '600', marginBottom: '8px', fontSize: '14px', color: '#0f172a' }}>
          {monthNames[month]} {year}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
          {dayNames.map(d => (
            <div key={d} style={{ padding: '4px', textAlign: 'center', fontSize: '11px', fontWeight: '600', color: '#64748b' }}>
              {d}
            </div>
          ))}
          {days}
        </div>
      </div>
    );
  };

  const isMobileView = window.innerWidth < 640;

  return (
    <div style={{
      position: isMobileView ? 'fixed' : 'absolute',
      top: isMobileView ? '50%' : '100%',
      left: isMobileView ? '50%' : 0,
      transform: isMobileView ? 'translate(-50%, -50%)' : 'none',
      marginTop: isMobileView ? 0 : '4px',
      background: 'white',
      border: '1px solid #e5e7eb',
      borderRadius: '12px',
      boxShadow: '0 4px 12px rgba(0,0,0,.15)',
      zIndex: 1000,
      width: isMobileView ? '90vw' : 'auto',
      minWidth: isMobileView ? 'auto' : '600px',
      maxWidth: isMobileView ? '400px' : 'none',
      maxHeight: isMobileView ? '80vh' : 'none',
      overflow: isMobileView ? 'auto' : 'visible'
    }}>
      <div style={{ padding: '16px', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ fontSize: '14px', color: '#64748b', marginBottom: '4px' }}>
          {selectingFrom ? 'Sélectionnez la date de début' : 'Sélectionnez la date de fin'}
        </div>
        <div style={{ fontSize: '15px', fontWeight: '600', color: '#0f172a' }}>
          {tempFrom} → {tempTo}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: isMobileView ? 'column' : 'row' }}>
        {renderCalendar(0)}
        {renderCalendar(1)}
      </div>
      <div style={{ padding: '12px 16px', borderTop: '1px solid #e5e7eb', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          style={{
            padding: '8px 16px',
            background: '#f1f5f9',
            color: '#475569',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '500'
          }}
        >
          Annuler
        </button>
        <button
          onClick={handleApply}
          style={{
            padding: '8px 16px',
            background: 'linear-gradient(180deg, #818cf8, #6366f1)',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '500'
          }}
        >
          Appliquer
        </button>
      </div>
    </div>
  );
}

function ShowingsTab({ movieId }) {
  const TICKET_PRICE = 13; // $13 per ticket

  // Get today's date in YYYY-MM-DD format
  const getTodayDate = () => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  };

  const todayDate = getTodayDate();
  const [dateFrom, setDateFrom] = useState(todayDate);
  const [dateTo, setDateTo] = useState(todayDate);
  const [selectedTheatre, setSelectedTheatre] = useState('');
  const [theatreSearchTerm, setTheatreSearchTerm] = useState('');
  const [selectedTimeRange, setSelectedTimeRange] = useState('');
  const [selectedCompany, setSelectedCompany] = useState('');
  const [companySearchTerm, setCompanySearchTerm] = useState('');
  const [showingsData, setShowingsData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [collapsedTheaters, setCollapsedTheaters] = useState(new Set());
  const [isMobile, setIsMobile] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [proximityEnabled, setProximityEnabled] = useState(true);
  const [proximityDistance, setProximityDistance] = useState(30);
  const [locationRequested, setLocationRequested] = useState(false);
  const [locationReady, setLocationReady] = useState(false);
  const [viewMode, setViewMode] = useState('sales'); // 'horaire' or 'sales'
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  const datePickerRef = useRef(null);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Request geolocation on mount
  useEffect(() => {
    if (proximityEnabled && !userLocation && !locationRequested) {
      setLocationRequested(true);
      requestLocation();
    }
  }, []); // Only run on mount

  // Close date picker on click outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (datePickerRef.current && !datePickerRef.current.contains(event.target)) {
        setShowDatePicker(false);
      }
    };

    if (showDatePicker) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDatePicker]);

  useEffect(() => {
    // Only fetch if proximity is disabled OR location is ready
    if (!proximityEnabled || locationReady) {
      fetchShowings();
    }
  }, [movieId, dateFrom, dateTo, selectedTheatre, selectedTimeRange, selectedCompany, userLocation, proximityDistance, proximityEnabled, locationReady]);

  // Update collapsed state based on filters - collapse all by default unless filters are applied
  useEffect(() => {
    if (!showingsData?.showings) return;

    const hasFilters = selectedTheatre || selectedCompany;

    if (hasFilters) {
      // If filters are applied, expand all theaters
      setCollapsedTheaters(new Set());
    } else {
      // If no filters, collapse all theaters
      const allTheaterIds = [...new Set(showingsData.showings.map(s => s.theater_id))];
      setCollapsedTheaters(new Set(allTheaterIds));
    }
  }, [showingsData, selectedTheatre, selectedCompany]);

  async function fetchShowings() {
    try {
      setLoading(true);
      setError(null);
      const result = await getMovieShowings(
        movieId,
        dateFrom || undefined,
        dateTo || undefined,
        selectedTheatre || undefined,
        selectedTimeRange || undefined,
        selectedCompany || undefined,
        proximityEnabled && userLocation?.lat ? userLocation.lat : undefined,
        proximityEnabled && userLocation?.lon ? userLocation.lon : undefined,
        proximityEnabled && userLocation ? proximityDistance : undefined
      );
      setShowingsData(result);
    } catch (err) {
      console.error('Error fetching showings:', err);
      setError('Erreur lors du chargement des représentations');
    } finally {
      setLoading(false);
    }
  }

  function requestLocation() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lon: position.coords.longitude
          });
          setLocationReady(true);
          setError(null);
        },
        (err) => {
          console.error('Error getting location:', err);
          setError('Impossible d\'obtenir votre localisation. Veuillez autoriser l\'accès à votre position.');
          setProximityEnabled(false);
          setLocationReady(true); // Still ready, just without location
        }
      );
    } else {
      setError('La géolocalisation n\'est pas supportée par votre navigateur');
      setProximityEnabled(false);
      setLocationReady(true); // Still ready, just without location
    }
  }

  function handleProximityToggle(enabled) {
    setProximityEnabled(enabled);
    if (enabled) {
      if (userLocation) {
        // Already have location, ready to fetch
        setLocationReady(true);
      } else if (!locationRequested) {
        // Need to request location
        setLocationRequested(true);
        setLocationReady(false);
        requestLocation();
      }
      // else: location request is in progress, wait for it
    } else {
      // Proximity disabled, ready to fetch without location
      setLocationReady(true);
    }
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

  // Determine which columns have data for a theater
  const getAvailableColumns = (showings) => {
    return {
      hasSeats: showings.some(s => s.total_seats != null),
      hasSeatsSold: showings.some(s => s.seats_sold != null),
      hasLanguage: showings.some(s => s.language != null && s.language !== ''),
      hasAuditorium: showings.some(s => s.auditorium != null && s.auditorium !== ''),
    };
  };

  // Group showings by theater and determine if they have full data
  const groupedShowings = useMemo(() => {
    if (!showingsData?.showings) return { withData: {}, withoutData: {} };

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

    // Sort showings within each theater by date ASC, then time ASC
    Object.values(groups).forEach(theater => {
      theater.showings.sort((a, b) => {
        // First sort by date
        const dateCompare = (a.date || '').localeCompare(b.date || '');
        if (dateCompare !== 0) return dateCompare;
        // Then sort by time
        return (a.start_at || '').localeCompare(b.start_at || '');
      });
    });

    // Separate theaters with full data from those with only basic data
    const withData = {};
    const withoutData = {};

    Object.entries(groups).forEach(([key, theater]) => {
      const cols = getAvailableColumns(theater.showings);
      // Theater has "full data" if it has seats info
      if (cols.hasSeats || cols.hasSeatsSold) {
        withData[key] = { ...theater, availableColumns: cols };
      } else {
        withoutData[key] = { ...theater, availableColumns: cols };
      }
    });

    return { withData, withoutData };
  }, [showingsData]);

  const formatTime = (timeStr) => {
    if (!timeStr) return '—';
    const date = new Date(timeStr);
    return date.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    // dateStr is already in YYYY-MM-DD format from database
    const [year, month, day] = dateStr.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    return date.toLocaleDateString('fr-CA', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const calculateOccupancy = (seatsSold, totalSeats) => {
    if (!totalSeats || totalSeats === 0 || seatsSold == null) return null;
    return (seatsSold / totalSeats) * 100;
  };

  const calculateRevenue = (seatsSold) => {
    if (seatsSold == null) return null;
    return seatsSold * TICKET_PRICE;
  };

  const getShowingUrl = (showing) => {
    if (!showing.theatre_website) return null;
    const dateStr = showing.date;
    if (showing.theatre_company?.toLowerCase().includes('cineplex')) {
      return `${showing.theatre_website}/showtimes?date=${dateStr}`;
    }
    return showing.theatre_website;
  };

  // Filter theaters and companies based on search
  const filteredTheaters = useMemo(() => {
    if (!showingsData?.theaters || !theatreSearchTerm) return showingsData?.theaters || [];
    return showingsData.theaters.filter(t =>
      t.name.toLowerCase().includes(theatreSearchTerm.toLowerCase())
    );
  }, [showingsData?.theaters, theatreSearchTerm]);

  const filteredCompanies = useMemo(() => {
    if (!showingsData?.companies || !companySearchTerm) return showingsData?.companies || [];
    return showingsData.companies.filter(c =>
      c.toLowerCase().includes(companySearchTerm.toLowerCase())
    );
  }, [showingsData?.companies, companySearchTerm]);

  const renderTheaterGroup = (theatreKey, theatreData, isCompact = false) => {
    const isCollapsed = collapsedTheaters.has(theatreData.theatre_id);
    const cols = theatreData.availableColumns;

    // Filter showings based on view mode
    // In sales view, only show showings with seats_sold data
    const showingsToRender = viewMode === 'sales'
      ? theatreData.showings.filter(s => s.seats_sold != null)
      : theatreData.showings;

    // If no showings after filtering, don't render this theater
    if (showingsToRender.length === 0) return null;

    return (
      <div
        key={theatreKey}
        className="theatre-group"
        style={{
          border: '1px solid #e5e7eb',
          borderRadius: '12px',
          overflow: 'hidden',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,.05)',
          gridColumn: isCompact ? 'span 1' : 'span 1', // Each theater takes 1 column
          height: 'fit-content' // Fix collapsing issue
        }}
      >
        {/* Theater header */}
        <div
          style={{
            background: isCompact ? '#f9fafb' : 'linear-gradient(180deg, #fafbfc, #f3f4f6)',
            padding: isCompact ? '10px 14px' : '14px 18px',
            borderBottom: isCollapsed ? 'none' : '1px solid #e5e7eb',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            transition: 'background 0.15s'
          }}
          onClick={() => toggleTheater(theatreData.theatre_id)}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = isCompact ? '#f3f4f6' : 'linear-gradient(180deg, #f3f4f6, #e5e7eb)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = isCompact ? '#f9fafb' : 'linear-gradient(180deg, #fafbfc, #f3f4f6)';
          }}
        >
          <div style={{ flex: 1 }}>
            <h3 style={{
              margin: 0,
              fontSize: isCompact ? '15px' : '16px',
              fontWeight: '600',
              color: '#0f172a'
            }}>
              <Link
                to={`/theaters/${theatreData.theatre_id}`}
                onClick={(e) => e.stopPropagation()}
                style={{ color: '#6366f1', textDecoration: 'none' }}
                onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
              >
                {theatreData.theatre_name}
              </Link>
              {theatreData.theatre_company && (
                <span style={{ fontWeight: '400', color: '#64748b', marginLeft: '8px', fontSize: '13px' }}>
                  ({theatreData.theatre_company})
                </span>
              )}
            </h3>
            {theatreData.distance_km != null && (
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                {theatreData.distance_km.toFixed(1)} km
              </div>
            )}
          </div>
          <div style={{
            fontSize: '18px',
            color: '#94a3b8',
            transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s'
          }}>
            ▼
          </div>
        </div>

        {/* Showings table */}
        {!isCollapsed && (
          <div style={{ padding: isMobile ? '8px' : (isCompact ? '12px' : '16px') }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: isMobile && isCompact ? '12px' : (isCompact ? '13px' : '14px'),
                minWidth: isMobile ? (isCompact ? '300px' : '500px') : 'auto',
                fontVariantNumeric: 'tabular-nums'
              }}>
                <thead>
                  <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                    <th style={{ padding: isCompact ? '6px 4px' : '10px 8px', textAlign: 'left', fontWeight: '600', color: '#475569', minWidth: isMobile ? '70px' : 'auto', fontSize: isMobile && isCompact ? '11px' : 'inherit' }}>Date</th>
                    <th style={{ padding: isCompact ? '6px 4px' : '10px 8px', textAlign: 'left', fontWeight: '600', color: '#475569', minWidth: isMobile ? '50px' : 'auto', fontSize: isMobile && isCompact ? '11px' : 'inherit' }}>Heure</th>
                    {viewMode === 'sales' && (cols.hasAuditorium || !isCompact) && (
                      <th style={{ padding: isCompact ? '6px 4px' : '10px 8px', textAlign: 'left', fontWeight: '600', color: '#475569', minWidth: isMobile ? '50px' : 'auto', fontSize: isMobile && isCompact ? '11px' : 'inherit' }}>Salle</th>
                    )}
                    {viewMode === 'sales' && cols.hasLanguage && (
                      <th style={{ padding: isCompact ? '6px 4px' : '10px 8px', textAlign: 'left', fontWeight: '600', color: '#475569', minWidth: isMobile ? '50px' : 'auto', fontSize: isMobile && isCompact ? '11px' : 'inherit' }}>Langue</th>
                    )}
                    {viewMode === 'sales' && cols.hasSeats && (
                      <th style={{ padding: isCompact ? '6px 4px' : '10px 8px', textAlign: 'right', fontWeight: '600', color: '#475569', minWidth: isMobile ? '55px' : 'auto', fontSize: isMobile && isCompact ? '11px' : 'inherit' }}>Sièges</th>
                    )}
                    {viewMode === 'sales' && cols.hasSeatsSold && (
                      <th style={{ padding: isCompact ? '6px 4px' : '10px 8px', textAlign: 'right', fontWeight: '600', color: '#475569', minWidth: isMobile ? '55px' : 'auto', fontSize: isMobile && isCompact ? '11px' : 'inherit' }}>Vendus</th>
                    )}
                    {viewMode === 'sales' && cols.hasSeatsSold && cols.hasSeats && (
                      <th style={{ padding: isCompact ? '6px 4px' : '10px 8px', textAlign: 'right', fontWeight: '600', color: '#475569', minWidth: isMobile ? '45px' : 'auto', fontSize: isMobile && isCompact ? '11px' : 'inherit' }}>Occ.</th>
                    )}
                    {viewMode === 'sales' && cols.hasSeatsSold && (
                      <th style={{ padding: isCompact ? '6px 4px' : '10px 8px', textAlign: 'right', fontWeight: '600', color: '#475569', minWidth: isMobile ? '60px' : 'auto', fontSize: isMobile && isCompact ? '11px' : 'inherit' }}>Recettes</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {showingsToRender.map((showing) => {
                    const occupancy = calculateOccupancy(showing.seats_sold, showing.total_seats);
                    const revenue = calculateRevenue(showing.seats_sold);
                    const showingUrl = getShowingUrl(showing);

                    const cellPadding = isCompact ? '6px 4px' : '10px 8px';

                    return (
                      <tr key={showing.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: cellPadding, color: '#64748b', fontSize: isMobile && isCompact ? '12px' : 'inherit' }}>{formatDate(showing.date)}</td>
                        <td style={{ padding: cellPadding, fontSize: isMobile && isCompact ? '12px' : 'inherit' }}>
                          {showingUrl ? (
                            <a
                              href={showingUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: '#6366f1', textDecoration: 'none', fontWeight: '500' }}
                              onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                              onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                            >
                              {formatTime(showing.start_at)}
                            </a>
                          ) : (
                            <span style={{ color: '#0f172a', fontWeight: '500' }}>{formatTime(showing.start_at)}</span>
                          )}
                        </td>
                        {viewMode === 'sales' && (cols.hasAuditorium || !isCompact) && (
                          <td style={{ padding: cellPadding, color: '#64748b', fontSize: isMobile && isCompact ? '12px' : 'inherit' }}>{showing.auditorium || '—'}</td>
                        )}
                        {viewMode === 'sales' && cols.hasLanguage && (
                          <td style={{ padding: cellPadding, color: '#64748b', fontSize: isMobile && isCompact ? '12px' : 'inherit' }}>
                            {showing.language || '—'}
                          </td>
                        )}
                        {viewMode === 'sales' && cols.hasSeats && (
                          <td style={{ padding: cellPadding, textAlign: 'right', color: '#64748b', fontSize: isMobile && isCompact ? '12px' : 'inherit' }}>
                            {showing.total_seats?.toLocaleString('fr-CA') || '—'}
                          </td>
                        )}
                        {viewMode === 'sales' && cols.hasSeatsSold && (
                          <td style={{ padding: cellPadding, textAlign: 'right', color: '#0f172a', fontWeight: '500', fontSize: isMobile && isCompact ? '12px' : 'inherit' }}>
                            {showing.seats_sold != null ? showing.seats_sold.toLocaleString('fr-CA') : '—'}
                          </td>
                        )}
                        {viewMode === 'sales' && cols.hasSeatsSold && cols.hasSeats && (
                          <td style={{ padding: cellPadding, textAlign: 'right', fontSize: isMobile && isCompact ? '12px' : 'inherit' }}>
                            {occupancy != null ? (
                              <span style={{
                                color: occupancy < 3 ? '#dc2626' : occupancy < 10 ? '#64748b' : '#16a34a',
                                fontWeight: '600'
                              }}>
                                {occupancy.toFixed(1)}%
                              </span>
                            ) : '—'}
                          </td>
                        )}
                        {viewMode === 'sales' && cols.hasSeatsSold && (
                          <td style={{ padding: cellPadding, textAlign: 'right', fontWeight: '600', color: '#0f172a', fontSize: isMobile && isCompact ? '12px' : 'inherit' }}>
                            {showing.seats_sold != null ? formatCurrency(revenue) : '—'}
                          </td>
                        )}
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
  };

  if (loading && !showingsData) {
    return (
      <div style={{ padding: '60px 24px', textAlign: 'center' }}>
        <div className="loading-spinner" />
        <p style={{ color: '#64748b', marginTop: '16px' }}>Chargement des représentations...</p>
      </div>
    );
  }

  return (
    <div className="showings-tab" style={{ padding: '0' }}>
      {/* Quick Settings */}
      <div style={{
        background: '#fff',
        borderRadius: '12px',
        boxShadow: '0 1px 3px rgba(0,0,0,.08)',
        padding: '16px 20px',
        marginBottom: '16px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          {/* Proximity Toggle */}
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '500',
            color: proximityEnabled ? '#10b981' : '#64748b',
            minWidth: isMobile ? '100%' : 'auto',
            order: isMobile ? 2 : 1
          }}>
            <input
              type="checkbox"
              checked={proximityEnabled}
              onChange={(e) => handleProximityToggle(e.target.checked)}
              style={{
                width: '18px',
                height: '18px',
                cursor: 'pointer',
                accentColor: '#10b981'
              }}
            />
            <span>📍 Cinémas proches</span>
            {proximityEnabled && !userLocation && (
              <span style={{ fontSize: '12px', color: '#f59e0b', fontWeight: '400' }}>
                (localisation...)
              </span>
            )}
          </label>

          {/* View Mode Toggle */}
          <div style={{
            display: 'inline-flex',
            background: '#f1f5f9',
            borderRadius: '10px',
            padding: '4px',
            gap: '4px',
            order: isMobile ? 1 : 2
          }}>
            <button
              onClick={() => setViewMode('horaire')}
              style={{
                padding: '8px 20px',
                border: 'none',
                borderRadius: '8px',
                background: viewMode === 'horaire' ? 'linear-gradient(180deg, #818cf8, #6366f1)' : 'transparent',
                color: viewMode === 'horaire' ? '#fff' : '#64748b',
                fontWeight: '600',
                fontSize: '14px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: viewMode === 'horaire' ? '0 1px 2px rgba(0,0,0,.1)' : 'none'
              }}
            >
              📅 Horaire
            </button>
            <button
              onClick={() => setViewMode('sales')}
              style={{
                padding: '8px 20px',
                border: 'none',
                borderRadius: '8px',
                background: viewMode === 'sales' ? 'linear-gradient(180deg, #818cf8, #6366f1)' : 'transparent',
                color: viewMode === 'sales' ? '#fff' : '#64748b',
                fontWeight: '600',
                fontSize: '14px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: viewMode === 'sales' ? '0 1px 2px rgba(0,0,0,.1)' : 'none'
              }}
            >
              💰 Ventes
            </button>
          </div>
        </div>
      </div>

      {/* Advanced Search */}
      <div style={{
        background: '#fff',
        borderRadius: '12px',
        boxShadow: '0 1px 3px rgba(0,0,0,.08)',
        padding: '16px 20px',
        marginBottom: '20px'
      }}>
        <div
          onClick={() => setShowAdvancedSearch(!showAdvancedSearch)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            marginBottom: showAdvancedSearch ? '16px' : '0'
          }}
        >
          <div style={{ fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>Recherche avancée</div>
          <div style={{
            fontSize: '18px',
            color: '#94a3b8',
            transform: showAdvancedSearch ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s'
          }}>
            ▼
          </div>
        </div>

        {showAdvancedSearch && (
          <>
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '12px',
              marginBottom: '12px'
            }}>
          <div style={{ position: 'relative' }} ref={datePickerRef}>
            <label style={{ fontSize: '13px', fontWeight: '500', color: '#475569', display: 'block', marginBottom: '6px' }}>
              Période
            </label>
            <button
              onClick={() => setShowDatePicker(!showDatePicker)}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                fontSize: '14px',
                background: '#fff',
                textAlign: 'left',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <span>{dateFrom === dateTo ? dateFrom : `${dateFrom} → ${dateTo}`}</span>
              <span>📅</span>
            </button>
            {showDatePicker && (
              <DateRangePicker
                dateFrom={dateFrom}
                dateTo={dateTo}
                onApply={(from, to) => {
                  setDateFrom(from);
                  setDateTo(to);
                  setShowDatePicker(false);
                }}
                onCancel={() => setShowDatePicker(false)}
              />
            )}
          </div>

          <div>
            <label htmlFor="time-filter" style={{ fontSize: '13px', fontWeight: '500', color: '#475569', display: 'block', marginBottom: '6px' }}>
              Heure
            </label>
            <select
              id="time-filter"
              value={selectedTimeRange}
              onChange={(e) => setSelectedTimeRange(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                fontSize: '14px',
                background: '#fff'
              }}
            >
              {TIME_RANGES.map(range => (
                <option key={range.value} value={range.value}>{range.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="company-filter" style={{ fontSize: '13px', fontWeight: '500', color: '#475569', display: 'block', marginBottom: '6px' }}>
              Bannière
            </label>
            <input
              id="company-filter"
              type="text"
              list="companies-list"
              value={companySearchTerm}
              onChange={(e) => {
                setCompanySearchTerm(e.target.value);
                setSelectedCompany(e.target.value);
              }}
              placeholder="Rechercher..."
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                fontSize: '14px',
                background: '#fff'
              }}
            />
            <datalist id="companies-list">
              {filteredCompanies.map((company) => (
                <option key={company} value={company} />
              ))}
            </datalist>
          </div>

          <div>
            <label htmlFor="theatre-filter" style={{ fontSize: '13px', fontWeight: '500', color: '#475569', display: 'block', marginBottom: '6px' }}>
              Cinéma
            </label>
            <input
              id="theatre-filter"
              type="text"
              list="theaters-list"
              value={theatreSearchTerm}
              onChange={(e) => {
                setTheatreSearchTerm(e.target.value);
                const match = showingsData?.theaters?.find(t =>
                  t.name.toLowerCase() === e.target.value.toLowerCase()
                );
                setSelectedTheatre(match?.id || '');
              }}
              placeholder="Rechercher..."
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                fontSize: '14px',
                background: '#fff'
              }}
            />
            <datalist id="theaters-list">
              {filteredTheaters.map((theatre) => (
                <option key={theatre.id} value={theatre.name}>
                  {theatre.name} {theatre.company ? `(${theatre.company})` : ''}
                </option>
              ))}
            </datalist>
          </div>

          <div>
            <label style={{ fontSize: '13px', fontWeight: '500', color: '#475569', display: 'block', marginBottom: '6px' }}>
              Distance (km)
            </label>
            <input
              type="number"
              min="1"
              max="200"
              value={proximityDistance}
              onChange={(e) => setProximityDistance(parseInt(e.target.value) || 30)}
              disabled={!proximityEnabled}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                fontSize: '14px',
                background: proximityEnabled ? '#fff' : '#f9fafb',
                color: proximityEnabled ? '#0f172a' : '#94a3b8'
              }}
            />
          </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button
                onClick={() => {
                  const today = getTodayDate();
                  setDateFrom(today);
                  setDateTo(today);
                  setSelectedTheatre('');
                  setTheatreSearchTerm('');
                  setSelectedCompany('');
                  setCompanySearchTerm('');
                  setSelectedTimeRange('');
                  setProximityEnabled(true);
                  setProximityDistance(30);
                  setViewMode('sales');
                  if (!userLocation) requestLocation();
                }}
                style={{
                  padding: '8px 16px',
                  background: '#f1f5f9',
                  color: '#475569',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500'
                }}
              >
                Réinitialiser
              </button>
              <button
                onClick={fetchShowings}
                style={{
                  padding: '8px 16px',
                  background: 'linear-gradient(180deg, #818cf8, #6366f1)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                  boxShadow: '0 1px 2px rgba(0,0,0,.1)'
                }}
              >
                Actualiser
              </button>
            </div>
          </>
        )}
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', marginBottom: '16px', color: '#991b1b' }}>
          {error}
        </div>
      )}

      {/* Results count */}
      {showingsData && (
        <div style={{ marginBottom: '16px', fontSize: '14px', color: '#64748b' }}>
          {showingsData.count} représentation{showingsData.count !== 1 ? 's' : ''} trouvée{showingsData.count !== 1 ? 's' : ''}
          {viewMode === 'sales' && Object.keys(groupedShowings.withData).length > 0 && (
            <span style={{ fontWeight: '500', color: '#6366f1' }}>
              {' '}(affichage ventes)
            </span>
          )}
          {viewMode === 'horaire' && (
            <span style={{ fontWeight: '500', color: '#6366f1' }}>
              {' '}(affichage horaires)
            </span>
          )}
          {proximityEnabled && userLocation && <span style={{ fontWeight: '500', color: '#10b981' }}> </span>}
        </div>
      )}

      {/* Showings grouped by theater - with data first */}
      {(Object.keys(groupedShowings.withData).length > 0 || (viewMode !== 'sales' && Object.keys(groupedShowings.withoutData).length > 0)) ? (
        <>
          {viewMode === 'horaire' ? (
            // Horaire mode: All theaters in compact grid
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: '12px'
            }}>
              {[...Object.entries(groupedShowings.withData), ...Object.entries(groupedShowings.withoutData)].map(([key, data]) =>
                renderTheaterGroup(key, data, true)
              )}
            </div>
          ) : (
            // Sales mode: Two-column layout for theaters with data
            <>
              {Object.keys(groupedShowings.withData).length > 0 && (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
                  gap: '16px',
                  marginBottom: '24px'
                }}>
                  {Object.entries(groupedShowings.withData).map(([key, data]) =>
                    renderTheaterGroup(key, data, false)
                  )}
                </div>
              )}

              {viewMode !== 'sales' && Object.keys(groupedShowings.withoutData).length > 0 && (
                <>
                  <h3 style={{ fontSize: '15px', fontWeight: '600', color: '#64748b', marginBottom: '12px', marginTop: '24px' }}>
                    Horaires seulement
                  </h3>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))',
                    gap: '12px'
                  }}>
                    {Object.entries(groupedShowings.withoutData).map(([key, data]) =>
                      renderTheaterGroup(key, data, true)
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </>
      ) : (
        <div style={{
          padding: '60px 40px',
          textAlign: 'center',
          color: '#94a3b8',
          border: '2px dashed #e5e7eb',
          borderRadius: '12px',
          background: '#fafbfc'
        }}>
          {loading ? 'Chargement...' : viewMode === 'sales' ? 'Aucune représentation avec données de vente pour cette période' : 'Aucune représentation trouvée pour cette période'}
        </div>
      )}
    </div>
  );
}

export default ShowingsTab;
