import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

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

        // First, get the current movie's revenue (calculated from revenues table)
        const currentMovieQuery = `
            SELECT
                m.id,
                m.title,
                m.fr_title,
                m.release_date,
                m.poster_path,
                COALESCE(MAX(r.cumulatif_qc_to_date), 0) as total_revenue_qc
            FROM movies m
            LEFT JOIN revenues r ON r.film_id = m.id
            WHERE m.id = $1
            GROUP BY m.id, m.title, m.fr_title, m.release_date, m.poster_path;
        `;
        const currentMovieResult = await client.query(currentMovieQuery, [movieId]);

        if (currentMovieResult.rows.length === 0) {
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

        const currentMovie = currentMovieResult.rows[0];
        const currentRevenue = parseFloat(currentMovie.total_revenue_qc) || 0;
        const minRevenue = Math.floor(currentRevenue * 0.6); // -30%
        const maxRevenue = Math.ceil(currentRevenue * 1.4); // +30%

        // Get similar movies by director/genre/actors/country WITHIN revenue range
        // Fetch each category separately to respect limits
        const movie_revenues_cte = `
            WITH movie_revenues AS (
                SELECT film_id, COALESCE(MAX(cumulatif_qc_to_date), 0) as total_revenue_qc
                FROM revenues
                GROUP BY film_id
            )
        `;

        // 3 by director
        const byDirectorQuery = `
            ${movie_revenues_cte}
            SELECT DISTINCT m.id, m.title, m.fr_title, m.release_date, m.poster_path,
                   COALESCE(mr.total_revenue_qc, 0) as total_revenue_qc,
                   'director' as similarity_type
            FROM movies m
            JOIN movie_crew mc ON mc.movie_id = m.id
            LEFT JOIN movie_revenues mr ON mr.film_id = m.id
            WHERE mc.crew_id IN (SELECT crew_id FROM movie_crew WHERE movie_id = $1)
              AND m.id != $1
              AND COALESCE(mr.total_revenue_qc, 0) BETWEEN $2 AND $3
            ORDER BY COALESCE(mr.total_revenue_qc, 0) DESC
            LIMIT 3;
        `;

        // 4 by genre
        const byGenreQuery = `
            ${movie_revenues_cte}
            SELECT DISTINCT m.id, m.title, m.fr_title, m.release_date, m.poster_path,
                   COALESCE(mr.total_revenue_qc, 0) as total_revenue_qc,
                   'genre' as similarity_type
            FROM movies m
            JOIN movie_genres mg ON mg.movie_id = m.id
            LEFT JOIN movie_revenues mr ON mr.film_id = m.id
            WHERE mg.genre_id IN (SELECT genre_id FROM movie_genres WHERE movie_id = $1)
              AND m.id != $1
              AND COALESCE(mr.total_revenue_qc, 0) BETWEEN $2 AND $3
            ORDER BY COALESCE(mr.total_revenue_qc, 0) DESC
            LIMIT 4;
        `;

        // 3 by actor
        const byActorQuery = `
            ${movie_revenues_cte}
            SELECT DISTINCT m.id, m.title, m.fr_title, m.release_date, m.poster_path,
                   COALESCE(mr.total_revenue_qc, 0) as total_revenue_qc,
                   'actor' as similarity_type
            FROM movies m
            JOIN movie_actors ma ON ma.movie_id = m.id
            LEFT JOIN movie_revenues mr ON mr.film_id = m.id
            WHERE ma.actor_id IN (SELECT actor_id FROM movie_actors WHERE movie_id = $1 ORDER BY "order" LIMIT 5)
              AND m.id != $1
              AND COALESCE(mr.total_revenue_qc, 0) BETWEEN $2 AND $3
            ORDER BY COALESCE(mr.total_revenue_qc, 0) DESC
            LIMIT 3;
        `;

        // 2 by country
        const byCountryQuery = `
            ${movie_revenues_cte}
            SELECT DISTINCT m.id, m.title, m.fr_title, m.release_date, m.poster_path,
                   COALESCE(mr.total_revenue_qc, 0) as total_revenue_qc,
                   'country' as similarity_type
            FROM movies m
            JOIN movie_countries mc ON mc.movie_id = m.id
            LEFT JOIN movie_revenues mr ON mr.film_id = m.id
            WHERE mc.country_code IN (SELECT country_code FROM movie_countries WHERE movie_id = $1)
              AND m.id != $1
              AND COALESCE(mr.total_revenue_qc, 0) BETWEEN $2 AND $3
            ORDER BY COALESCE(mr.total_revenue_qc, 0) DESC
            LIMIT 2;
        `;

        const [byDirectorResult, byGenreResult, byActorResult, byCountryResult] = await Promise.all([
            client.query(byDirectorQuery, [movieId, minRevenue, maxRevenue]),
            client.query(byGenreQuery, [movieId, minRevenue, maxRevenue]),
            client.query(byActorQuery, [movieId, minRevenue, maxRevenue]),
            client.query(byCountryQuery, [movieId, minRevenue, maxRevenue])
        ]);

        // Combine and deduplicate
        const similarMovies = [];
        const seenIds = new Set();

        [...byDirectorResult.rows, ...byGenreResult.rows, ...byActorResult.rows, ...byCountryResult.rows].forEach(movie => {
            if (!seenIds.has(movie.id)) {
                seenIds.add(movie.id);
                similarMovies.push(movie);
            }
        });

        // If we need more movies, fill with movies by similar release date
        const needed = 8 - similarMovies.length;
        if (needed > 0) {
            const excludeIds = similarMovies.map(m => m.id);
            const byDateQuery = `
                WITH movie_revenues AS (
                    SELECT film_id, COALESCE(MAX(cumulatif_qc_to_date), 0) as total_revenue_qc
                    FROM revenues
                    GROUP BY film_id
                )
                SELECT m.id, m.title, m.fr_title, m.release_date, m.poster_path,
                       COALESCE(mr.total_revenue_qc, 0) as total_revenue_qc,
                       'release_date' as similarity_type
                FROM movies m
                LEFT JOIN movie_revenues mr ON mr.film_id = m.id
                WHERE m.id != $1
                  AND ${excludeIds.length > 0 ? `m.id != ALL($6)` : 'TRUE'}
                  AND COALESCE(mr.total_revenue_qc, 0) BETWEEN $2 AND $3
                  AND m.release_date IS NOT NULL
                  AND m.release_date BETWEEN ($4::date - INTERVAL '2 months') AND ($4::date + INTERVAL '2 months')
                ORDER BY ABS(m.release_date - $4::date)
                LIMIT $5;
            `;

            const params = [
                movieId,
                minRevenue,
                maxRevenue,
                currentMovie.release_date,
                needed
            ];

            if (excludeIds.length > 0) {
                params.push(excludeIds);
            }

            const byDateResult = await client.query(byDateQuery, params);

            similarMovies.push(...byDateResult.rows);
        }

        const finalSimilar = similarMovies.slice(0, 8);

        await client.end();

        // Calculate breakdown
        const breakdown = {
            byDirector: finalSimilar.filter(m => m.similarity_type === 'director').length,
            byGenre: finalSimilar.filter(m => m.similarity_type === 'genre').length,
            byActor: finalSimilar.filter(m => m.similarity_type === 'actor').length,
            byCountry: finalSimilar.filter(m => m.similarity_type === 'country').length,
            byReleaseDate: finalSimilar.filter(m => m.similarity_type === 'release_date').length
        };

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET, OPTIONS'
            },
            body: JSON.stringify({
                currentMovie: {
                    id: currentMovie.id,
                    title: currentMovie.title,
                    fr_title: currentMovie.fr_title,
                    release_date: currentMovie.release_date,
                    poster_path: currentMovie.poster_path,
                    total_revenue_qc: parseFloat(currentMovie.total_revenue_qc)
                },
                similarMovies: finalSimilar,
                count: finalSimilar.length,
                revenueRange: {
                    min: minRevenue,
                    max: maxRevenue,
                    current: currentRevenue
                },
                breakdown
            }),
        };

    } catch (err) {
        console.error('Error fetching similar movies:', err);
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
                error: 'Erreur lors de la récupération des films similaires',
                details: err.message,
                stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
            }),
        };
    }
};
