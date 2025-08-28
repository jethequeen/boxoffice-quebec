import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

export const handler = async (event) => {
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
        const client = new Client({ 
            connectionString: NEON_DB_URL, 
            ssl: { rejectUnauthorized: false } 
        });
        await client.connect();

        // Get basic movie info including cumulative revenues
        const movieQuery = `
            SELECT m.id, m.title, m.fr_title, m.release_date, m.runtime,
                   m.budget, m.overview, m.poster_path, m.backdrop_path,
                   m.cumulatif_qc, m.cumulatif_us
            FROM movies m
            WHERE m.id = $1;
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

        const movie = movieResult.rows[0];

        // Get revenue data
        const revenueQuery = `
            SELECT
                r.weekend_id,
                r.revenue_qc::float8  AS revenue_qc,
                r.revenue_us::float8  AS revenue_us,
                r.rank,
                r.theater_count,
                r.week_count,
                r.force_qc_usa,
                r.change_qc,
                r.cumulatif_qc_to_date,
                r.cumulatif_us_to_date,
                r.change_us,
                sc.screen_count
            FROM revenues r
                     JOIN weekends w ON w.id = r.weekend_id
                     LEFT JOIN LATERAL (
                SELECT COALESCE(COUNT(*),0)::int AS screen_count
                FROM showings s
                WHERE s.movie_id = $1
                  AND s.date BETWEEN
                    (CASE WHEN r.week_count = 1
                              THEN (w.start_date - INTERVAL '1 day')::date
              ELSE w.start_date
         END)
                    AND w.end_date
                    ) sc ON TRUE
            WHERE r.film_id = $1
            ORDER BY r.weekend_id;
        `;

        const revenueResult = await client.query(revenueQuery, [movieId]);

        // Get directors
        const directorsQuery = `
            SELECT d.id, d.name
            FROM crew d
            JOIN movie_crew md ON d.id = md.crew_id
            WHERE md.movie_id = $1;
        `;
        const directorsResult = await client.query(directorsQuery, [movieId]);

        // Get genres
        const genresQuery = `
            SELECT g.id, g.name
            FROM genres g
            JOIN movie_genres mg ON g.id = mg.genre_id
            WHERE mg.movie_id = $1;
        `;
        const genresResult = await client.query(genresQuery, [movieId]);

        // Get cast (if you have cast tables)
        let castResult = { rows: [] };
        try {
            const castQuery = `
                SELECT c.id, c.name, mc.order, c.profile_path
                FROM actors c
                JOIN movie_actors mc ON c.id = mc.actor_id
                WHERE mc.movie_id = $1
                ORDER BY mc.order
                LIMIT 10;
            `;
            castResult = await client.query(castQuery, [movieId]);
        } catch (err) {
            // Cast table might not exist, continue without it
            console.log('Cast table not found, skipping cast data');
        }

        // Calculate performance statistics
        const weekendRevenueQC = revenueResult.rows.reduce((sum, row) => sum + (parseFloat(row.revenue_qc) || 0), 0);
        const weekendRevenueUS = revenueResult.rows.reduce((sum, row) => sum + (parseFloat(row.revenue_us) || 0), 0);
        const weeksInTheaters = revenueResult.rows.length;
        const bestWeekendQC = Math.max(...revenueResult.rows.map(row => parseFloat(row.revenue_qc) || 0));
        const bestRank = Math.min(...revenueResult.rows.map(row => parseInt(row.rank) || 999));


        await client.end();

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
            },
            body: JSON.stringify({
                movie,
                revenues: revenueResult.rows,
                directors: directorsResult.rows,
                genres: genresResult.rows,
                cast: castResult.rows,
                statistics: {
                    weekend_revenue_qc: weekendRevenueQC,
                    weekend_revenue_us: weekendRevenueUS,
                    weeks_in_theaters: weeksInTheaters,
                    best_weekend_qc: bestWeekendQC,
                    best_rank: bestRank
                }
            }),
        };

    } catch (err) {
        console.error('Error fetching movie details:', err);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ 
                error: 'Erreur lors de la récupération des détails du film',
                details: err.message 
            }),
        };
    }
};
