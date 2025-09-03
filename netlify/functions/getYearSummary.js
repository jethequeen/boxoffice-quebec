// netlify/functions/getYearSummary.js
import { sql } from '../lib/db.js';
import { defaultHeaders, jsonResponse } from '../lib/http.js';


export const handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: defaultHeaders };

    try {
        const qs = event.queryStringParameters || {};
        const year   = Number(qs.year) || new Date().getFullYear();
        const market = (qs.market || 'qc').toLowerCase();     // 'qc' | 'us'
        const col    = market === 'us' ? 'revenue_us' : 'revenue_qc';
        const cumCol = market === 'us' ? 'cumulatif_us_to_date' : 'cumulatif_qc_to_date';
        const scope  = (qs.scope || 'all').toLowerCase();   // 'all' | 'canadian'
        const countryCode = 'CA';                            // adjust if needed

        const id = (x) => sql.unsafe(x); // for identifiers

// 1) Weekly trend
        const weeklyTrend = await sql/*sql*/`
            WITH yr AS (SELECT make_date(${year},1,1) d1, make_date(${year},12,31) d2)
            SELECT w.id AS weekend_id,
                   w.start_date,
                   w.end_date,                              -- << add this
                   COALESCE(SUM(r.${id(col)}),0)::float8 AS total
            FROM weekends w
                     LEFT JOIN revenues r ON r.weekend_id = w.id
                     JOIN yr ON w.start_date BETWEEN yr.d1 AND yr.d2
            GROUP BY w.id
            ORDER BY w.start_date;
        `;


// ---- Top films with optional Canadian-only filter (LIMIT 10) ----
        const topFilms = await sql/*sql*/`
            WITH yr AS (SELECT make_date(${year},1,1) d1, make_date(${year},12,31) d2),
                 w AS (SELECT id FROM weekends, yr WHERE start_date BETWEEN yr.d1 AND yr.d2),
                 canadian_films AS (
                     SELECT DISTINCT mc.movie_id
                     FROM movie_countries mc
                     WHERE mc.country_code = ${countryCode}
                 ),
                 agg AS (
                     SELECT
                         r.film_id,
                         MAX(r.${id(cumCol)})               AS max_cum,
                         SUM(COALESCE(r.${id(col)},0))      AS sum_rev
                     FROM revenues r
                              JOIN w ON r.weekend_id = w.id
                     WHERE COALESCE(r.preview,false) = false
                ${sql.unsafe(scope === 'canadian'
                        ? 'AND r.film_id IN (SELECT movie_id FROM canadian_films)' : '')}
            GROUP BY r.film_id
                )
            SELECT
                m.id AS film_id,
                COALESCE(m.fr_title, m.title, '—') AS title,
                m.poster_path,
                COALESCE(agg.max_cum, agg.sum_rev, 0)::float8 AS total
            FROM agg
                     JOIN movies m ON m.id = agg.film_id
            WHERE COALESCE(agg.max_cum, agg.sum_rev, 0) > 0
            ORDER BY total DESC
                LIMIT 10;
        `;

        // ---- KPIs filtered the same way (total_gross / movie_count / avg_weekend) ----
        const kpis = await sql/*sql*/`
            WITH yr AS (SELECT make_date(${year},1,1) d1, make_date(${year},12,31) d2),
                 weeks AS (
                     SELECT w.id, w.start_date
                     FROM weekends w, yr
                     WHERE w.start_date BETWEEN yr.d1 AND yr.d2
                 ),
                 film_filter AS (
                     SELECT DISTINCT r.film_id
                     FROM revenues r
                              JOIN weeks ON weeks.id = r.weekend_id
                     WHERE COALESCE(r.preview,false) = false
                ${sql.unsafe(scope === 'canadian'
                        ? `AND r.film_id IN (SELECT movie_id FROM movie_countries WHERE country_code = '${countryCode}')`
                        : '')}
                ),
                weekly AS (
            SELECT weeks.id,
                COALESCE(SUM(r.${id(col)}),0)::float8 AS total
            FROM weeks
                LEFT JOIN revenues r ON r.weekend_id = weeks.id
                ${sql.unsafe(scope === 'canadian'
                        ? 'AND r.film_id IN (SELECT film_id FROM film_filter)' : '')}
            GROUP BY weeks.id
                ),
                films AS (
            SELECT COUNT(*)::int AS movie_count
            FROM film_filter
                )
            SELECT
                    (SELECT COALESCE(SUM(total),0)::float8 FROM weekly)                      AS total_gross,
                    (SELECT COALESCE(AVG(NULLIF(total,0)),0)::float8 FROM weekly)            AS avg_weekend,
                    (SELECT movie_count FROM films)                                          AS movie_count;
        `;

        // 3) Genre share (unchanged)
        const genreShare = await sql/*sql*/`
            WITH yr AS (SELECT make_date(${year},1,1) d1, make_date(${year},12,31) d2),
                 w AS (SELECT id FROM weekends, yr WHERE start_date BETWEEN yr.d1 AND yr.d2),
                 film_tot AS (
                     SELECT r.film_id, SUM(r.${id(col)}) AS total
                     FROM w JOIN revenues r ON r.weekend_id = w.id
                     GROUP BY r.film_id
                 )
            SELECT g.name AS genre, SUM(f.total)::float8 AS total
            FROM film_tot f
                     JOIN movie_genres mg ON mg.movie_id = f.film_id
                     JOIN genres g        ON g.id = mg.genre_id
            GROUP BY g.name
            ORDER BY total DESC;
        `;

        // 4) Studio share (unchanged)
        const studioShare = await sql/*sql*/`
            WITH yr AS (SELECT make_date(${year},1,1) d1, make_date(${year},12,31) d2),
                 w AS (SELECT id FROM weekends, yr WHERE start_date BETWEEN yr.d1 AND yr.d2),
                 film_tot AS (
                     SELECT r.film_id, SUM(r.${id(col)}) AS total
                     FROM w JOIN revenues r ON r.weekend_id = w.id
                     GROUP BY r.film_id
                 )
            SELECT COALESCE(s.name,'—') AS studio, SUM(f.total)::float8 AS total
            FROM film_tot f
                     JOIN movies m ON m.id = f.film_id
                     LEFT JOIN studios s ON s.id = m.principal_studio_id
            GROUP BY studio
            ORDER BY total DESC
                LIMIT 12;
        `;

        // 5) Country share (with fr_name)
        const countryShare = await sql/*sql*/`
            WITH yr AS (SELECT make_date(${year},1,1) d1, make_date(${year},12,31) d2),
                 w AS (SELECT id FROM weekends, yr WHERE start_date BETWEEN yr.d1 AND yr.d2),
                 film_tot AS (
                     SELECT r.film_id, SUM(r.${id(col)}) AS total
                     FROM w JOIN revenues r ON r.weekend_id = w.id
                     GROUP BY r.film_id
                 )
            SELECT COALESCE(c.fr_name, c.name, c.code) AS country,
                   SUM(f.total)::float8 AS total
            FROM film_tot f
                     JOIN movie_countries mc ON mc.movie_id = f.film_id
                     JOIN countries c        ON c.code = mc.country_code
            GROUP BY country
            ORDER BY total DESC
                LIMIT 12;
        `;

        // 6) Dollars per showing (unchanged)
        const perShowTop = await sql/*sql*/`
            WITH yr AS (SELECT make_date(${year},1,1) d1, make_date(${year},12,31) d2),
                 w AS (SELECT id, start_date, end_date FROM weekends, yr WHERE start_date BETWEEN yr.d1 AND yr.d2),
                 film_win AS (
                     SELECT r.film_id, r.weekend_id, SUM(r.${id(col)}) AS wk_total
                     FROM revenues r JOIN w ON r.weekend_id = w.id
                     GROUP BY r.film_id, r.weekend_id
                 ),
                 show_cnt AS (
                     SELECT s.movie_id AS film_id, COUNT(*)::int AS cnt
                     FROM showings s
                              JOIN w ON s.date BETWEEN w.start_date AND w.end_date
                     GROUP BY s.movie_id
                 ),
                 agg AS (
                     SELECT f.film_id, SUM(f.wk_total) AS total_rev, COALESCE(SUM(sc.cnt),0) AS total_shows
                     FROM film_win f
                              LEFT JOIN show_cnt sc ON sc.film_id = f.film_id
                     GROUP BY f.film_id
                 )
            SELECT a.film_id,
                   COALESCE(m.fr_title, m.title) AS title,
                   (a.total_rev / NULLIF(a.total_shows,0))::float8 AS dollars_per_showing
            FROM agg a JOIN movies m ON m.id = a.film_id
            WHERE a.total_shows > 0
            ORDER BY dollars_per_showing DESC
                LIMIT 10;
        `;

        // 7) New releases per month (unchanged)
        const newReleases = await sql/*sql*/`
            WITH yr AS (SELECT make_date(${year},1,1) d1, make_date(${year},12,31) d2),
                 w AS (SELECT id, start_date FROM weekends, yr WHERE start_date BETWEEN yr.d1 AND yr.d2),
                 firsts AS (
                     SELECT r.film_id, MIN(w.start_date) AS first_weekend
                     FROM w JOIN revenues r ON r.weekend_id = w.id
                     GROUP BY r.film_id
                 )
            SELECT EXTRACT(MONTH FROM first_weekend)::int  AS month,
             COUNT(*)::int AS count
            FROM firsts
            GROUP BY month
            ORDER BY month;
        `;

        return jsonResponse(200, {
            weeklyTrend,
            topFilms,
            genreShare,
            studioShare,
            countryShare,
            perShowTop,
            newReleases,
            year,
            market,
            kpis: kpis?.[0] ?? { total_gross: 0, avg_weekend: 0, movie_count: 0 }
        });
    } catch (err) {
        console.error('getYearSummary error:', err);
        return jsonResponse(500, { error: 'Year summary failed', details: err.message });
    }
};
