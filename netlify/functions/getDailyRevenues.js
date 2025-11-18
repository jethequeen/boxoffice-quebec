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
        const { movieId } = event.queryStringParameters || {};

        if (!movieId) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ error: 'Movie ID is required' }),
            };
        }

        const NEON_DB_URL = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;
        client = new Client({
            connectionString: NEON_DB_URL,
            ssl: { rejectUnauthorized: false }
        });
        await client.connect();

        // Get movie release date to calculate days since release
        const movieQuery = `
            SELECT release_date
            FROM movies
            WHERE id = $1;
        `;
        const movieResult = await client.query(movieQuery, [movieId]);

        if (movieResult.rows.length === 0) {
            await client.end();
            return {
                statusCode: 404,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ error: 'Movie not found' }),
            };
        }

        const releaseDate = movieResult.rows[0].release_date;

        // Calculate daily revenues using time-range-based extrapolation
        // For each time range, calculate average seats_sold from showings with data,
        // then apply that average to ALL showings in that range (including those without data)
        const dailyRevenuesQuery = `
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
              WHERE s.movie_id = $1
            ),
            daily_range_revenue AS (
              SELECT
                date,
                time_range,
                -- Average seats sold for showings WITH sales data in this time range
                AVG(seats_sold) FILTER (WHERE seats_sold IS NOT NULL) as avg_seats_sold,
                -- Total showings in this range (including those without data)
                COUNT(id) as total_showings,
                -- Estimated revenue: avg_seats * total_showings * ticket_price
                COALESCE(AVG(seats_sold) FILTER (WHERE seats_sold IS NOT NULL), 0) * COUNT(id) * $2 as range_revenue
              FROM showings_with_range
              GROUP BY date, time_range
            ),
            daily_totals AS (
              SELECT
                date,
                COUNT(DISTINCT theater_id) as theaters_count
              FROM showings_with_range
              GROUP BY date
            )
            SELECT
              drr.date,
              SUM(drr.range_revenue)::numeric as revenue,
              SUM(drr.total_showings)::integer as showings_count,
              dt.theaters_count::integer as theaters_count,
              (drr.date - $3::date)::integer as days_since_release
            FROM daily_range_revenue drr
            JOIN daily_totals dt ON dt.date = drr.date
            WHERE drr.date < CURRENT_DATE
            GROUP BY drr.date, dt.theaters_count
            ORDER BY drr.date ASC;
        `;

        const dailyRevenuesResult = await client.query(dailyRevenuesQuery, [movieId, TICKET_PRICE, releaseDate]);

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
                releaseDate: releaseDate,
                dailyRevenues: dailyRevenuesResult.rows,
                count: dailyRevenuesResult.rows.length
            }),
        };

    } catch (err) {
        console.error('Error fetching daily revenues:', err);
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
                error: 'Erreur lors de la récupération des revenus quotidiens',
                details: err.message,
                stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
            }),
        };
    }
};
