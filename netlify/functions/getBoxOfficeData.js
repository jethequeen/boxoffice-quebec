// netlify/functions/getBoxOfficeData.js
import { sql } from '../lib/db.js';
import { defaultHeaders, jsonResponse } from '../lib/http.js';

export const handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: defaultHeaders };

    try {
        const { limit: rawLimit = 10, weekendId } = event.queryStringParameters || {};
        if (!weekendId) return jsonResponse(400, { error: 'weekendId is required' });

        const limitNum = Math.max(1, Math.min(1000, Number(rawLimit) || 10));

        // 1) Weekend meta (totals + % change)
        const [weekend] = await sql/*sql*/`
      SELECT
        w.id,
        w.start_date,
        w.end_date,
        w.total_revenues_qc::float8   AS total_revenues_qc,
        w.total_revenues_us::float8   AS total_revenues_us,
        w.change_qc::float8           AS change_qc,
        w.change_us::float8           AS change_us
      FROM weekends w
      WHERE w.id = ${weekendId}
      LIMIT 1
    `;

        // 2) Enriched per-movie rows, with server-side percent change
        const movies = await sql/*sql*/`
      WITH ranked AS (
        SELECT
          r.film_id,
          r.weekend_id,
          r.rank,
          r.revenue_qc::float8            AS revenue_qc,
          r.revenue_us::float8            AS revenue_us,
          r.theater_count,
          r.cumulatif_qc_to_date::float8  AS cumulatif_qc_to_date,
          r.cumulatif_us_to_date::float8  AS cumulatif_us_to_date,
          r.force_qc_usa::float8          AS force_qc_usa,
          LAG(r.revenue_qc::float8)
            OVER (PARTITION BY r.film_id ORDER BY r.weekend_id) AS prev_qc
        FROM revenues r
        WHERE r.weekend_id <= ${weekendId}
      )
      SELECT
        m.id,
        m.title,
        m.fr_title,
        m.release_date,
        m.principal_studio_id,
        s.name AS studio_name,
        x.weekend_id,
        x.rank,
        x.revenue_qc,
        x.revenue_us,
        x.theater_count,
        x.cumulatif_qc_to_date AS cumulatif_qc,
        x.cumulatif_us_to_date,
        x.force_qc_usa,
        CASE
          WHEN x.prev_qc IS NULL OR x.prev_qc = 0 THEN NULL
          ELSE ((x.revenue_qc - x.prev_qc) / x.prev_qc) * 100
        END AS change_percent
      FROM ranked x
      JOIN movies m ON m.id = x.film_id
      LEFT JOIN studios s ON s.id = m.principal_studio_id
      WHERE x.weekend_id = ${weekendId}
      ORDER BY x.rank
      LIMIT ${limitNum}
    `;

        return jsonResponse(200, {
            weekend: weekend || null,
            movies,
            count: movies.length,
        });
    } catch (err) {
        console.error('Error fetching box office data:', err);
        return jsonResponse(500, {
            error: 'Erreur lors de la récupération des données box-office',
            details: err.message,
            timestamp: new Date().toISOString(),
            function: 'getBoxOfficeData',
        });
    }
};
