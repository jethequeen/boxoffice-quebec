import { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getDailyBoxOffice } from '../utils/api';
import { formatCurrency, toNum, pct0 } from '../utils/formatUtils';
import './Dashboard.css';
import './BoxOffice.css';
import MovieTable from '../components/movieTable';
import { createColumnsCatalog } from '../utils/catalog';

/* ---------------- Date utilities ---------------- */

const formatDate = (dateStr) => {
  try {
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const [year, month, day] = parts.map(Number);
    const date = new Date(year, month - 1, day);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('fr-CA', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  } catch (e) {
    return dateStr;
  }
};

const getNextDay = (dateStr) => {
  try {
    const parts = dateStr.split('-');
    if (parts.length !== 3) return null;
    const [year, month, day] = parts.map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + 1);
    return date.toISOString().split('T')[0];
  } catch (e) {
    return null;
  }
};

const getPreviousDay = (dateStr) => {
  try {
    const parts = dateStr.split('-');
    if (parts.length !== 3) return null;
    const [year, month, day] = parts.map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() - 1);
    return date.toISOString().split('T')[0];
  } catch (e) {
    return null;
  }
};

/* ---------------- Component ---------------- */

function DailyDetails() {
  const { date } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dailyData, setDailyData] = useState(null);

  const { pickColumns } = createColumnsCatalog({ Link, formatCurrency, pct0, toNum });

  useEffect(() => {
    fetchDailyData();
  }, [date]);

  const fetchDailyData = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await getDailyBoxOffice(date);

      setDailyData(response);
    } catch (err) {
      console.error('Error fetching daily data:', err);
      setError(err.message || 'Erreur lors du chargement des données quotidiennes');
    } finally {
      setLoading(false);
    }
  };

  const handleDateChange = (newDate) => {
    navigate(`/daily/${newDate}`);
  };

  const navigateToPrevious = () => {
    const prevDay = getPreviousDay(date);
    if (prevDay) handleDateChange(prevDay);
  };

  const navigateToNext = () => {
    const nextDay = getNextDay(date);
    if (nextDay) handleDateChange(nextDay);
  };

  // Normalize movies data - similar to WeekendDetails
  const normalizeMovie = (m) => {
    const revenue_qc = toNum(m.revenue_qc);
    const screen_count = toNum(m.screen_count);
    const rev_per_screen = screen_count > 0 && revenue_qc !== null ? revenue_qc / screen_count : null;

    return {
      ...m,
      id: m.id,
      title: m.title,
      fr_title: m.fr_title,
      poster_path: m.poster_path,
      release_date: m.release_date,
      revenue_qc,
      screen_count,
      rev_per_screen: toNum(m.rev_per_screen) ?? rev_per_screen,
      average_showing_occupancy: toNum(m.average_showing_occupancy),
      showings_proportion: toNum(m.showings_proportion),
      studio_name: m.studio_name || 'Independent',
      week_number: m.week_number || 1,
      days_since_release: m.days_since_release,
      // Add rank based on sort order
      rank: null
    };
  };

  const rawMovies = useMemo(
    () => (dailyData?.movies || []).map(normalizeMovie),
    [dailyData]
  );

  // Add rankings to movies (similar to WeekendDetails)
  const movies = useMemo(() => {
    return rawMovies.map((m, idx) => ({
      ...m,
      rank: idx + 1
    }));
  }, [rawMovies]);

  // Create leadCol similar to WeekendDetails
  const leadCol = {
    key: 'lead',
    label: '',
    required: true,
    sortable: false,
    headerAlign: 'left',
    align: 'left',
    widthPct: 6,
    headerClassName: 'lead-sticky',
    className: 'lead-sticky lead-cell',
  };

  const columns = [
    leadCol,
    ...pickColumns(
      ['title', 'revenue_qc', 'week_number', 'screen_count', 'rev_per_screen', 'occupancy', 'weight'],
      {
        // Custom title render with anchor like WeekendDetails
        title: {
          render: (_value, m) => {
            const hasVO = !!m.title && m.title !== m.fr_title;
            return (
              <div id={`movie-${m.id}`} className={`title-text ${hasVO ? 'has-vo' : 'single'}`}>
                <Link to={`/movies/${m.id}`} className="movie-title-fr" title={m.fr_title || m.title || ''}>
                  {m.fr_title || m.title || ''}
                </Link>
                {hasVO && <span className="movie-title-vo" title={m.title}>{m.title}</span>}
              </div>
            );
          },
        },
      }
    ),
  ];

  if (loading) {
    return (
      <div className="weekend-details">
        <div className="loading">Chargement des données quotidiennes...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="weekend-details">
        <div className="error">{error}</div>
      </div>
    );
  }

  return (
    <div className="weekend-details">
      <div className="header-section" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '24px',
        flexWrap: 'wrap',
        gap: '16px'
      }}>
        <div>
          <h1 className="weekend-title" style={{ margin: '0 0 4px 0' }}>
            {formatDate(date)}
          </h1>
          <p style={{ margin: 0, color: '#64748b', fontSize: '14px' }}>
            Vue quotidienne du box-office
            {dailyData?.totalRevenue && (
              <span style={{ marginLeft: '12px', fontWeight: '600', color: '#6366f1' }}>
                Total: {formatCurrency(dailyData.totalRevenue)}
              </span>
            )}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={navigateToPrevious}
            style={{
              padding: '8px 16px',
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              color: '#0f172a'
            }}
          >
            ← Jour précédent
          </button>
          <button
            onClick={navigateToNext}
            style={{
              padding: '8px 16px',
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              color: '#0f172a'
            }}
          >
            Jour suivant →
          </button>
        </div>
      </div>

      {movies.length > 0 ? (
        <MovieTable
          rows={movies}
          columns={columns}
          initialSort={{ key: 'revenue_qc', dir: 'desc' }}
          initialVisibleKeys={['title', 'revenue_qc', 'week_number', 'screen_count', 'rev_per_screen', 'occupancy']}
          searchAccessors={[r => r.fr_title, r => r.title, r => r.studio_name]}
        />
      ) : (
        <div className="empty-state" style={{
          background: '#fff',
          borderRadius: '12px',
          padding: '60px 24px',
          textAlign: 'center',
          boxShadow: '0 1px 3px rgba(0,0,0,.08)'
        }}>
          <p style={{ color: '#64748b', fontSize: '16px', margin: 0 }}>
            Aucune donnée disponible pour cette date.
          </p>
          <p style={{ color: '#94a3b8', fontSize: '14px', marginTop: '8px' }}>
            Les données quotidiennes sont calculées à partir des données hebdomadaires.
          </p>
        </div>
      )}
    </div>
  );
}

export default DailyDetails;
