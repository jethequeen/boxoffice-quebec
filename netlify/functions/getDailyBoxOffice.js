import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const TICKET_PRICE = 13;

export const handler = async (event) => {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET, OPTIONS'
            },
            body: ''
        };
    }

    let client;
    try {
        const { date } = event.queryStringParameters || {};

        if (!date) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ error: 'Date is required (format: YYYY-MM-DD)' }),
            };
        }

        // Validate date format
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(date)) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ error: 'Invalid date format. Use YYYY-MM-DD' }),
            };
        }

        const NEON_DB_URL = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;
        client = new Client({
            connectionString: NEON_DB_URL,
            ssl: { rejectUnauthorized: false }
        });
        await client.connect();

        // Get all movies with showings on this date and calculate their daily revenues
        // Using the same time-range extrapolation logic as getDailyRevenues
        const dailyBoxOfficeQuery = `
            WITH range_bounds(time_range, start_hour, end_hour) AS (
              VALUES
                ('10-12', 10, 12),
                ('12-14', 12, 14),
                ('14-16', 14, 16),
                ('16-18', 16, 18),
                ('18-20', 18, 20),
                ('20-23', 20, 23)
            ),
            showings_with_range AS (
              SELECT
                s.*,
                range_bounds.time_range
              FROM showings s
              JOIN range_bounds ON EXTRACT(HOUR FROM s.start_at) >= range_bounds.start_hour
                                AND EXTRACT(HOUR FROM s.start_at) < range_bounds.end_hour
              WHERE s.date = $1::date
            ),
            movie_range_revenue AS (
              SELECT
                movie_id,
                time_range,
                -- Average seats sold for showings WITH sales data in this time range
                AVG(seats_sold) FILTER (WHERE seats_sold IS NOT NULL) as avg_seats_sold,
                -- Total showings in this range (including those without data)
                COUNT(id) as total_showings,
                -- Estimated revenue: avg_seats * total_showings * ticket_price
                COALESCE(AVG(seats_sold) FILTER (WHERE seats_sold IS NOT NULL), 0) * COUNT(id) * $2 as range_revenue
              FROM showings_with_range
              GROUP BY movie_id, time_range
            ),
            movie_daily_revenue AS (
              SELECT
                movie_id,
                SUM(range_revenue)::numeric as revenue_qc,
                SUM(total_showings)::integer as showings_count
              FROM movie_range_revenue
              GROUP BY movie_id
            ),
            movie_theater_counts AS (
              SELECT
                movie_id,
                COUNT(DISTINCT theater_id)::integer as screen_count
              FROM showings_with_range
              GROUP BY movie_id
            ),
            movie_occupancy AS (
              SELECT
                s.movie_id,
                AVG(
                  CASE
                    WHEN s.seats_sold IS NOT NULL AND sc.seat_count IS NOT NULL AND sc.seat_count > 0
                    THEN (s.seats_sold::float / sc.seat_count::float)
                    ELSE NULL
                  END
                ) FILTER (WHERE s.seats_sold IS NOT NULL AND sc.seat_count IS NOT NULL AND sc.seat_count > 0) as average_showing_occupancy
              FROM showings_with_range s
              LEFT JOIN screens sc ON sc.id = s.screen_id
              GROUP BY s.movie_id
            ),
            total_showings_on_date AS (
              SELECT COUNT(*)::integer as total_showings
              FROM showings_with_range
            ),
            movie_showings_proportion AS (
              SELECT
                movie_id,
                COUNT(*)::float8 / NULLIF((SELECT total_showings FROM total_showings_on_date), 0) as showings_proportion
              FROM showings_with_range
              GROUP BY movie_id
            )
            SELECT
              m.id,
              m.title,
              m.fr_title,
              m.release_date,
              m.poster_path,
              m.principal_studio_id,
              s.name as studio_name,
              mdr.revenue_qc,
              mtc.screen_count,
              CASE
                WHEN mtc.screen_count > 0 AND mdr.revenue_qc > 0
                THEN mdr.revenue_qc / mtc.screen_count
                ELSE NULL
              END::numeric as rev_per_screen,
              mdr.showings_count,
              mo.average_showing_occupancy,
              msp.showings_proportion,
              ($1::date - m.release_date)::integer as days_since_release,
              -- Calculate week number (days since release / 7, rounded up)
              GREATEST(1, CEIL(($1::date - m.release_date + 1)::numeric / 7))::integer as week_number
            FROM movie_daily_revenue mdr
            JOIN movies m ON m.id = mdr.movie_id
            LEFT JOIN studios s ON s.id = m.principal_studio_id
            LEFT JOIN movie_theater_counts mtc ON mtc.movie_id = mdr.movie_id
            LEFT JOIN movie_occupancy mo ON mo.movie_id = mdr.movie_id
            LEFT JOIN movie_showings_proportion msp ON msp.movie_id = mdr.movie_id
            WHERE mdr.revenue_qc > 0
            ORDER BY mdr.revenue_qc DESC;
        `;

        const result = await client.query(dailyBoxOfficeQuery, [date, TICKET_PRICE]);

        // Calculate total revenue for the day
        const totalRevenue = result.rows.reduce((sum, movie) => sum + (parseFloat(movie.revenue_qc) || 0), 0);

        await client.end();

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET, OPTIONS'
            },
            body: JSON.stringify({
                date: date,
                totalRevenue: totalRevenue,
                movies: result.rows,
                count: result.rows.length
            }),
        };

    } catch (err) {
        console.error('Error fetching daily box office:', err);
        console.error('Stack:', err.stack);

        // Ensure we always close the client connection
        try {
            if (client) await client.end();
        } catch (e) {
            console.error('Error closing client:', e);
        }

        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                error: 'Erreur lors de la récupération des données quotidiennes',
                details: err.message,
                stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
            }),
        };
    }
};
