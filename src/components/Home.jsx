// src/pages/Home.jsx
import { useEffect, useMemo, useState, useRef } from 'react';
import WeekendDetails from './WeekendDetails';
import { getCurrentWeekendId } from '../utils/weekendUtils';
import { getBoxOfficeData, getYearSummary } from '../utils/api';
import {Navigate, useNavigate} from 'react-router-dom';

import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  BarChart, Bar, PieChart, Pie, Legend
} from 'recharts';

// simple fr-CA short money formatter (2,3 m / 850 k / 900)
const fmtMoneyShortFR = (n) => {
  const v = Number(n || 0);
  if (v >= 1_000_000_000) return `${(v/1_000_000_000).toLocaleString('fr-CA',{maximumFractionDigits:1})} G$`;
  if (v >= 1_000_000)     return `${(v/1_000_000).toLocaleString('fr-CA',{maximumFractionDigits:1})} m`;
  if (v >= 100_000)       return `${(v/1_000).toLocaleString('fr-CA',{maximumFractionDigits:0})} k`;
  if (v >= 1_000)         return `${(v/1_000).toLocaleString('fr-CA',{maximumFractionDigits:1})} k`;
  return v.toLocaleString('fr-CA');
};

// a small, nice palette
const COLORS = [
  '#4F46E5', // indigo
  '#06B6D4', // cyan
  '#10B981', // emerald
  '#F59E0B', // amber
  '#EF4444', '#A855F7', '#14B8A6', '#F97316', '#3B82F6', '#22C55E'
];

const tmdbPoster = (path, size='w185') =>
    path ? `https://image.tmdb.org/t/p/${size}${path}` : null;

function niceTicks(max, n = 4) {
  if (!max || max <= 0) return [0, 1];
  const p = 10 ** Math.floor(Math.log10(max));
  const steps = [1, 2, 5, 10].map(s => s * p);
  let step = steps.at(-1);
  for (const s of steps) if (max / s <= n) { step = s; break; }
  const ticks = [];
  for (let v = 0; v <= max + 1e-6; v += step) ticks.push(v);
  return ticks;
}

function PosterBars({ data = [] }) {
  if (!data.length) return null;

  const barsRef = useRef(null);
  const [plotH, setPlotH] = useState(200); // will be updated to the real height

  useEffect(() => {
    if (!barsRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const h = Math.max(10, Math.round(entry.contentRect.height));
      setPlotH(h);
    });
    ro.observe(barsRef.current);
    return () => ro.disconnect();
  }, []);

  const rawMax = Math.max(...data.map(d => d.total || 0), 1);
  const max = rawMax * 1.05; // 5% headroom
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => Math.round(max * t));

  return (
      <div className="poster poster-wrap">
        <div className="poster-axis">
          {ticks.map((t, i) => {
            const y = plotH - (t / max) * plotH;
            return (
                <div key={i} className="tick" style={{ top: `${y}px` }}>
                  {fmtMoneyShortFR(t)}
                </div>
            );
          })}
        </div>

        <div className="poster-bars" ref={barsRef}>
          {data.map((d, i) => {
            const h = Math.max(10, (d.total / max) * plotH);
            const poster = tmdbPoster(d.poster_path, "w185");
            const href = `/movies/${d.film_id}`;
            return (
                <div className="poster-bar" key={d.film_id ?? i} title={d.title}>
                  <div className="poster-bar__value">{fmtMoneyShortFR(d.total)}</div>
                  <div className="poster-bar__col" style={{ height: `${h}px` }} />
                  <a className="poster-bar__cap poster-link" href={href} aria-label={d.title}>
                    {poster && <img src={poster} alt={d.title} />}
                  </a>
                  <div className="poster-bar__label">
                    <a className="poster-link" href={href}>{d.title}</a>
                  </div>
                </div>
            );
          })}
        </div>
      </div>
  );
}





export default function Home() {
  const currentWeekendId = getCurrentWeekendId();
  const [year, setYear] = useState(new Date().getFullYear());
  const [scope, setScope] = useState('all');            // 'all' | 'canadian'
  const [summaries, setSummaries] = useState({ all: null, canadian: null });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const navigate = useNavigate();

  const currentSummary = scope === 'canadian' ? summaries.canadian : summaries.all;

  const fmtWeekendRange = (startStr, endStr) => {
    const start = new Date(startStr);
    const end = endStr ? new Date(endStr) : new Date(start.getTime() + 2 * 86400000);
    const fmtDay = new Intl.DateTimeFormat('fr-CA', { day: 'numeric' });
    const fmtMonthYear = new Intl.DateTimeFormat('fr-CA', { month: 'long', year: 'numeric' });
    return `${fmtDay.format(start)}–${fmtDay.format(end)} ${fmtMonthYear.format(end)}`;
  };

  const WeeklyTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload;
    return (
        <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:8, padding:'8px 10px',
          boxShadow:'0 6px 16px rgba(0,0,0,.12)' }}>
          <div style={{ fontWeight:700, marginBottom:2 }}>{fmtWeekendRange(p.start_date, p.end_date)}</div>
          <div>total : {fmtMoneyShortFR(p.total)}</div>
        </div>
    );
  };

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErr(null);

        // Resolve year from the current weekend
        const { weekend: wk } = await getBoxOfficeData(1, currentWeekendId);
        if (!wk) throw new Error('Weekend introuvable');
        const y = new Date(wk.start_date).getFullYear();
        setYear(y);

        // Fetch BOTH scopes in parallel (adjust API if needed, see note below)
        const [all, canadian] = await Promise.all([
          getYearSummary(y, 'all'),
          getYearSummary(y, 'canadian'),
        ]);

        setSummaries({ all, canadian });
      } catch (e) {
        console.error(e);
        setErr('Erreur lors du chargement des données.');
      } finally {
        setLoading(false);
      }
    })();
  }, [currentWeekendId]);

  // Safely derive chart data from the active summary
  const weeklyTrend = currentSummary?.weeklyTrend ?? [];
  const topFilms    = useMemo(
      () => (currentSummary?.topFilms ?? []).slice(),
      [currentSummary]
  );
  const genreShare   = currentSummary?.genreShare ?? [];
  const studioShare  = currentSummary?.studioShare ?? [];
  const countryShare = currentSummary?.countryShare ?? [];
  const perShowTop   = currentSummary?.perShowTop ?? [];

  if (loading) return <div className="page-loading">Chargement…</div>;
  if (err) return <div className="error">{err}</div>;
  if (!currentSummary) return null;

    return (
        <Navigate
            to={`/weekend/${currentWeekendId}`}
            replace
            state={{ from: 'home-auto' }}
        />
    );

}