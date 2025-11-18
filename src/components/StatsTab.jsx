import { useState, useEffect } from 'react';
import { getDailyRevenues, getSimilarMovies } from '../utils/api';
import { formatCurrency } from '../utils/formatUtils';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceArea
} from 'recharts';
import { Link, useNavigate } from 'react-router-dom';

function StatsTab({ movieId, movieTitle }) {
  const navigate = useNavigate();
  const [dailyRevenues, setDailyRevenues] = useState(null);
  const [similarMovies, setSimilarMovies] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    if (!movieId || hasLoaded) return;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch both daily revenues and similar movies in parallel
        const [dailyRevenuesData, similarMoviesData] = await Promise.all([
          getDailyRevenues(movieId),
          getSimilarMovies(movieId)
        ]);

        setDailyRevenues(dailyRevenuesData);
        setSimilarMovies(similarMoviesData);
        setHasLoaded(true);
      } catch (err) {
        console.error('Error fetching stats data:', err);
        setError('Erreur lors du chargement des statistiques');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [movieId, hasLoaded]);

  if (loading) {
    return (
      <div style={{ padding: '60px 24px', textAlign: 'center' }}>
        <div className="loading-spinner" />
        <p style={{ color: '#64748b', marginTop: '16px' }}>Chargement des statistiques...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '12px 16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', margin: '20px 0', color: '#991b1b' }}>
        {error}
      </div>
    );
  }

  // Prepare data for daily revenue line chart
  const lineChartData = dailyRevenues?.dailyRevenues?.map(item => ({
    date: item.date,
    daysSinceRelease: parseInt(item.days_since_release),
    revenue: parseFloat(item.revenue),
    showingsCount: parseInt(item.showings_count),
    theatersCount: parseInt(item.theaters_count)
  })) || [];

  // Identify weekend ranges for highlighting (Friday, Saturday, Sunday)
  const getWeekendRanges = (data) => {
    const ranges = [];
    let weekendStart = null;

    data.forEach((item, index) => {
      const date = new Date(item.date);
      const dayOfWeek = date.getDay(); // 0 = Sunday, 5 = Friday, 6 = Saturday

      // Check if it's a weekend day (Friday, Saturday, or Sunday)
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;

      if (isWeekend && !weekendStart) {
        // Start of a weekend
        weekendStart = item.date;
      } else if (!isWeekend && weekendStart) {
        // End of a weekend (now it's a weekday)
        const prevDate = data[index - 1]?.date;
        ranges.push({ start: weekendStart, end: prevDate });
        weekendStart = null;
      }
    });

    // If we ended on a weekend, close the range
    if (weekendStart && data.length > 0) {
      ranges.push({ start: weekendStart, end: data[data.length - 1].date });
    }

    return ranges;
  };

  const weekendRanges = getWeekendRanges(lineChartData);

  // Prepare data for similar movies bar chart
  // Include the current movie + similar movies
  const barChartData = [];

  // Add current movie
  if (similarMovies?.currentMovie) {
    barChartData.push({
      id: similarMovies.currentMovie.id,
      title: similarMovies.currentMovie.fr_title || similarMovies.currentMovie.title,
      revenue: parseFloat(similarMovies.currentMovie.total_revenue_qc) || 0,
      similarityType: 'current',
      isCurrent: true,
      poster_path: similarMovies.currentMovie.poster_path
    });
  }

  // Add similar movies
  if (similarMovies?.similarMovies) {
    similarMovies.similarMovies.forEach(movie => {
      barChartData.push({
        id: movie.id,
        title: movie.fr_title || movie.title,
        revenue: parseFloat(movie.total_revenue_qc) || 0,
        similarityType: movie.similarity_type,
        isCurrent: false,
        poster_path: movie.poster_path
      });
    });
  }

  // Sort by revenue ascending
  barChartData.sort((a, b) => a.revenue - b.revenue);

  // Custom tooltip for line chart
  const CustomLineTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div style={{
          background: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: '8px',
          padding: '12px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
        }}>
          <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#0f172a' }}>
            {new Date(data.date).toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
          <p style={{ margin: '4px 0', color: '#6366f1', fontWeight: '500' }}>
            Jour {data.daysSinceRelease}
          </p>
          <p style={{ margin: '4px 0', color: '#0f172a', fontWeight: '600' }}>
            {formatCurrency(data.revenue)}
          </p>
          <p style={{ margin: '4px 0', fontSize: '13px', color: '#64748b' }}>
            {data.showingsCount} représentation{data.showingsCount !== 1 ? 's' : ''}
          </p>
          <p style={{ margin: '4px 0', fontSize: '13px', color: '#64748b' }}>
            {data.theatersCount} cinéma{data.theatersCount !== 1 ? 's' : ''}
          </p>
        </div>
      );
    }
    return null;
  };

  // Custom tooltip for bar chart
  const CustomBarTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const similarityLabels = {
        director: 'Même réalisateur',
        genre: 'Genres similaires',
        actor: 'Acteurs en commun',
        country: 'Même pays',
        release_date: 'Date de sortie similaire',
        current: 'Film actuel'
      };
      return (
        <div style={{
          background: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: '8px',
          padding: '12px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
          maxWidth: '250px'
        }}>
          <p style={{ margin: '0 0 4px 0', fontWeight: data.isCurrent ? '700' : '600', color: '#0f172a' }}>
            {data.title}
            {data.isCurrent && ' ⭐'}
          </p>
          <p style={{ margin: '4px 0', color: '#0f172a', fontWeight: '600' }}>
            {formatCurrency(data.revenue)}
          </p>
          {data.similarityType && (
            <p style={{ margin: '4px 0', fontSize: '12px', color: data.isCurrent ? '#f59e0b' : '#6366f1', fontWeight: '500' }}>
              {similarityLabels[data.similarityType] || data.similarityType}
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  // Get color by similarity type
  const getBarColor = (similarityType, isCurrent) => {
    if (isCurrent) return '#f59e0b'; // Orange for current movie

    const colors = {
      director: '#6366f1',      // Indigo
      genre: '#3b82f6',         // Blue
      actor: '#9ca3af',         // Gray
      country: '#10b981',       // Green
      release_date: '#bfdbfe'   // Light blue
    };

    return colors[similarityType] || '#6366f1';
  };

  // Custom X-axis tick with poster
  const CustomXAxisTick = ({ x, y, payload }) => {
    const movie = barChartData.find(m => m.title === payload.value);
    if (!movie) return null;

    const posterUrl = movie.poster_path
      ? `https://image.tmdb.org/t/p/w92${movie.poster_path}`
      : null;

    const titleMaxLength = 15;
    const displayTitle = movie.title.length > titleMaxLength
      ? movie.title.substring(0, titleMaxLength) + '...'
      : movie.title;

    return (
      <g transform={`translate(${x},${y})`}>
        {/* Poster image */}
        {posterUrl ? (
          <image
            href={posterUrl}
            x={-23}
            y={0}
            width={46}
            height={69}
            style={{
              borderRadius: '4px',
              border: movie.isCurrent ? '2px solid #f59e0b' : 'none'
            }}
          />
        ) : (
          <rect
            x={-23}
            y={0}
            width={46}
            height={69}
            fill="#e5e7eb"
            rx={4}
          />
        )}

        {/* Movie title */}
        <text
          x={0}
          y={80}
          textAnchor="middle"
          fill="#64748b"
          fontSize={10}
          fontWeight={movie.isCurrent ? 600 : 400}
        >
          {displayTitle}
        </text>

        {/* Star indicator for current movie */}
        {movie.isCurrent && (
          <text
            x={0}
            y={93}
            textAnchor="middle"
            fontSize={12}
          >
            ⭐
          </text>
        )}
      </g>
    );
  };

  // Format currency for Y-axis
  const formatYAxis = (value) => {
    if (value >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M$`;
    } else if (value >= 1000) {
      return `${(value / 1000).toFixed(0)}k$`;
    }
    return `${value}$`;
  };

  // Format date for X-axis
  const formatXAxisDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('fr-CA', { month: 'short', day: 'numeric' });
  };

  return (
    <div style={{ padding: '20px 0' }}>
      {/* Daily Revenue Line Chart */}
      <section style={{
        background: '#fff',
        borderRadius: '12px',
        padding: '24px',
        marginBottom: '24px',
        boxShadow: '0 1px 3px rgba(0,0,0,.08)'
      }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: '600', color: '#0f172a' }}>
          Revenus quotidiens
        </h3>
        {lineChartData.length > 0 ? (
          <>
            <div style={{ marginBottom: '12px', fontSize: '14px', color: '#64748b' }}>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={lineChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                {/* Weekend highlights */}
                {weekendRanges.map((range, index) => (
                  <ReferenceArea
                    key={`weekend-${index}`}
                    x1={range.start}
                    x2={range.end}
                    fill="#fef3c7"
                    fillOpacity={0.3}
                  />
                ))}
                <XAxis
                  dataKey="date"
                  tickFormatter={formatXAxisDate}
                  label={{ value: 'Date', position: 'insideBottom', offset: -5, style: { fontSize: '13px', fill: '#64748b' } }}
                  tick={{ fontSize: 11, fill: '#64748b', angle: -45, textAnchor: 'end' }}
                  height={60}
                />
                <YAxis
                  tickFormatter={formatYAxis}
                  label={{ value: 'Revenus', angle: -90, position: 'insideLeft', style: { fontSize: '13px', fill: '#64748b' } }}
                  tick={{ fontSize: 12, fill: '#64748b' }}
                />
                <Tooltip content={<CustomLineTooltip />} />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="#6366f1"
                  strokeWidth={2}
                  dot={{ fill: '#6366f1', r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </>
        ) : (
          <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
            Aucune donnée de revenus quotidiens disponible
          </div>
        )}
      </section>

      {/* Similar Movies Comparison Bar Chart */}
      <section style={{
        background: '#fff',
        borderRadius: '12px',
        padding: '24px',
        boxShadow: '0 1px 3px rgba(0,0,0,.08)'
      }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: '600', color: '#0f172a' }}>
          Comparaison avec films similaires
        </h3>
        {barChartData.length > 0 ? (
          <>
            <div style={{ marginBottom: '12px', fontSize: '14px', color: '#64748b' }}>
              Revenus totaux QC comparés à des films similaires de même calibre (±40% de revenus)
            </div>
            {similarMovies?.revenueRange && (
              <div style={{ marginBottom: '12px', fontSize: '12px', color: '#94a3b8', fontStyle: 'italic' }}>
                Fourchette de comparaison: {formatCurrency(similarMovies.revenueRange.min)} - {formatCurrency(similarMovies.revenueRange.max)}
              </div>
            )}
            {similarMovies?.breakdown && (
              <div style={{ marginBottom: '16px', display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '13px' }}>
                {similarMovies.breakdown.byDirector > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '12px', height: '12px', borderRadius: '2px', background: '#6366f1' }} />
                    <span style={{ color: '#64748b' }}>
                      {similarMovies.breakdown.byDirector} par réalisateur
                    </span>
                  </div>
                )}
                {similarMovies.breakdown.byGenre > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '12px', height: '12px', borderRadius: '2px', background: '#3b82f6' }} />
                    <span style={{ color: '#64748b' }}>
                      {similarMovies.breakdown.byGenre} par genre
                    </span>
                  </div>
                )}
                {similarMovies.breakdown.byActor > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '12px', height: '12px', borderRadius: '2px', background: '#9ca3af' }} />
                    <span style={{ color: '#64748b' }}>
                      {similarMovies.breakdown.byActor} par acteurs
                    </span>
                  </div>
                )}
                {similarMovies.breakdown.byCountry > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '12px', height: '12px', borderRadius: '2px', background: '#10b981' }} />
                    <span style={{ color: '#64748b' }}>
                      {similarMovies.breakdown.byCountry} par pays
                    </span>
                  </div>
                )}
                {similarMovies.breakdown.byReleaseDate > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '12px', height: '12px', borderRadius: '2px', background: '#bfdbfe' }} />
                    <span style={{ color: '#64748b' }}>
                      {similarMovies.breakdown.byReleaseDate} par date de sortie
                    </span>
                  </div>
                )}
              </div>
            )}
            <ResponsiveContainer width="100%" height={550}>
              <BarChart data={barChartData} margin={{ bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="title"
                  tick={<CustomXAxisTick />}
                  height={110}
                  interval={0}
                />
                <YAxis
                  tickFormatter={formatYAxis}
                  tick={{ fontSize: 12, fill: '#64748b' }}
                  label={{ value: 'Revenus QC', angle: -90, position: 'insideLeft', style: { fontSize: '13px', fill: '#64748b' } }}
                />
                <Tooltip content={<CustomBarTooltip />} />
                <Bar
                  dataKey="revenue"
                  radius={[4, 4, 0, 0]}
                  fill="#6366f1"
                  onClick={(data) => {
                    if (data && data.id) {
                      navigate(`/movies/${data.id}`);
                    }
                  }}
                  shape={(props) => {
                    const { x, y, width, height, payload } = props;
                    const fill = getBarColor(payload.similarityType, payload.isCurrent);
                    return (
                      <rect
                        x={x}
                        y={y}
                        width={width}
                        height={height}
                        fill={fill}
                        rx={4}
                        ry={4}
                        style={{ cursor: 'pointer' }}
                      />
                    );
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </>
        ) : (
          <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
            Aucun film similaire trouvé
          </div>
        )}
      </section>
    </div>
  );
}

export default StatsTab;
