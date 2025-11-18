import { useState, useEffect } from 'react';
import { getDailyRevenues, getSimilarMovies, getForecast } from '../utils/api';
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
  const [forecast, setForecast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Check if mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (!movieId || hasLoaded) return;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch forecast and daily revenues first
        const [dailyRevenuesData, forecastData] = await Promise.all([
          getDailyRevenues(movieId),
          getForecast(movieId)
        ]);

        // If forecast is needed, fetch similar movies using the forecast revenue
        // Otherwise fetch normally
        const forecastRevenue = forecastData?.needsForecast
          ? forecastData.forecast.predictedRevenue
          : null;

        const similarMoviesData = await getSimilarMovies(movieId, forecastRevenue);

        setDailyRevenues(dailyRevenuesData);
        setSimilarMovies(similarMoviesData);
        setForecast(forecastData);
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
    // Use forecast revenue if available and needed, otherwise use actual revenue
    const displayRevenue = forecast?.needsForecast
      ? forecast.forecast.predictedRevenue
      : parseFloat(similarMovies.currentMovie.total_revenue_qc) || 0;

    barChartData.push({
      id: similarMovies.currentMovie.id,
      title: similarMovies.currentMovie.fr_title || similarMovies.currentMovie.title,
      revenue: displayRevenue,
      similarityType: 'current',
      isCurrent: true,
      isForecast: forecast?.needsForecast || false,
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

    const titleMaxLength = isMobile ? 8 : 15;
    const displayTitle = movie.title.length > titleMaxLength
      ? movie.title.substring(0, titleMaxLength) + '...'
      : movie.title;

    const posterWidth = isMobile ? 35 : 46;
    const posterHeight = isMobile ? 52 : 69;

    return (
      <g transform={`translate(${x},${y})`}>
        {/* Poster image */}
        {posterUrl ? (
          <image
            href={posterUrl}
            x={-posterWidth / 2}
            y={0}
            width={posterWidth}
            height={posterHeight}
            style={{
              borderRadius: '4px',
              border: movie.isCurrent ? '2px solid #f59e0b' : 'none'
            }}
          />
        ) : (
          <rect
            x={-posterWidth / 2}
            y={0}
            width={posterWidth}
            height={posterHeight}
            fill="#e5e7eb"
            rx={4}
          />
        )}

        {/* Movie title */}
        <text
          x={0}
          y={posterHeight + 12}
          textAnchor="middle"
          fill="#64748b"
          fontSize={isMobile ? 8 : 10}
          fontWeight={movie.isCurrent ? 600 : 400}
        >
          {displayTitle}
        </text>
      </g>
    );
  };

  // Custom label for bar chart - shows revenue on top
  const CustomBarLabel = (props) => {
    const { x, y, width, value, payload } = props;

    // Format revenue in short form
    let formattedValue;
    if (value >= 1000000) {
      formattedValue = `${(value / 1000000).toFixed(1)}M$`;
    } else if (value >= 1000) {
      formattedValue = `${Math.round(value / 1000)}k$`;
    } else {
      formattedValue = `${value}$`;
    }

    // Add forecast indicator if this is the current movie with forecast
    const displayText = payload?.isForecast ? `${formattedValue} 🔮` : formattedValue;

    return (
      <text
        x={x + width / 2}
        y={y - 5}
        fill="#0f172a"
        textAnchor="middle"
        fontSize={11}
        fontWeight={500}
      >
        {displayText}
      </text>
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
            <div style={{ overflowX: isMobile ? 'auto' : 'visible', overflowY: 'visible' }}>
              <ResponsiveContainer width={isMobile ? Math.max(lineChartData.length * 40, 600) : '100%'} height={300}>
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
                    label={{position: 'insideBottom', offset: -5, style: { fontSize: '13px', fill: '#64748b' } }}
                    tick={{ fontSize: 11, fill: '#64748b', angle: -45, textAnchor: 'end' }}
                    height={40}
                  />
                  <YAxis
                    tickFormatter={formatYAxis}
                    label={{ angle: -90, position: 'insideLeft', style: { fontSize: '13px', fill: '#64748b' } }}
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
            </div>
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
          Comparatifs
        </h3>

        {/* Forecast Section - Show when movie has 0$ revenue and released 2+ months ago */}
        {forecast?.needsForecast && (
          <div style={{
            background: '#fef3c7',
            border: '1px solid #fbbf24',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '20px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{ fontSize: '20px' }}>🔮</span>
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: '600', color: '#92400e' }}>
                Prévision de revenus
              </h4>
            </div>
            <div style={{ fontSize: '14px', color: '#78350f', marginBottom: '12px' }}>
            </div>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#92400e', marginBottom: '16px' }}>
              {formatCurrency(forecast.forecast.predictedRevenue)}
            </div>
            <div style={{ fontSize: '13px', color: '#78350f' }}>
              <div style={{ fontWeight: '600', marginBottom: '8px' }}>
              </div>
            </div>
          </div>
        )}

        {barChartData.length > 0 ? (
          <>
            <div style={{ marginBottom: '12px', fontSize: '14px', color: '#64748b' }}>
            </div>
            {similarMovies?.revenueRange && (
              <div style={{ marginBottom: '12px', fontSize: '12px', color: '#94a3b8', fontStyle: 'italic' }}>
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
                       Même genre
                    </span>
                  </div>
                )}
                {similarMovies.breakdown.byActor > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '12px', height: '12px', borderRadius: '2px', background: '#9ca3af' }} />
                    <span style={{ color: '#64748b' }}>
                      Partageant des acteurs
                    </span>
                  </div>
                )}
                {similarMovies.breakdown.byCountry > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '12px', height: '12px', borderRadius: '2px', background: '#10b981' }} />
                    <span style={{ color: '#64748b' }}>
                      Même pays
                    </span>
                  </div>
                )}
                {similarMovies.breakdown.byReleaseDate > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '12px', height: '12px', borderRadius: '2px', background: '#bfdbfe' }} />
                    <span style={{ color: '#64748b' }}>
                      Même date de sortie
                    </span>
                  </div>
                )}
              </div>
            )}
            <div style={{ overflowX: isMobile ? 'auto' : 'visible', overflowY: 'visible' }}>
              <ResponsiveContainer width={isMobile ? barChartData.length * 80 : '100%'} height={isMobile ? 300 : 420}>
                <BarChart data={barChartData} margin={{ top: 30, bottom: 20 }} barCategoryGap={isMobile ? '25%' : '25%'}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="title"
                    tick={<CustomXAxisTick />}
                    height={isMobile ? 80 : 110}
                    interval={0}
                  />
                  <YAxis
                    tickFormatter={formatYAxis}
                    tick={{ fontSize: 12, fill: '#64748b' }}
                    label={{angle: -90, position: 'insideLeft', style: { fontSize: '13px', fill: '#64748b' } }}
                    domain={[(dataMin) => Math.floor(dataMin * 0.9), 'auto']}
                  />
                  <Bar
                    dataKey="revenue"
                    radius={[4, 4, 0, 0]}
                    fill="#6366f1"
                    onClick={(data) => {
                      if (data && data.id) {
                        navigate(`/movies/${data.id}`);
                      }
                    }}
                    label={<CustomBarLabel />}
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
            </div>
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
