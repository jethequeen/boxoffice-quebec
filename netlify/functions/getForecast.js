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

        // Get current movie info
        const currentMovieQuery = `
            SELECT
                m.id,
                m.title,
                m.fr_title,
                m.release_date,
                m.poster_path,
                m.budget,
                m.principal_studio_id,
                COALESCE(MAX(r.cumulatif_qc_to_date), 0) as total_revenue_qc
            FROM movies m
            LEFT JOIN revenues r ON r.film_id = m.id
            WHERE m.id = $1
            GROUP BY m.id, m.title, m.fr_title, m.release_date, m.poster_path, m.budget, m.principal_studio_id;
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

        // Check if movie needs forecast (release date is in the future)
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Set to midnight for accurate date comparison
        const releaseDate = currentMovie.release_date ? new Date(currentMovie.release_date) : null;
        const needsForecast = releaseDate && releaseDate > today;

        if (!needsForecast) {
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
                    needsForecast: false,
                    currentMovie: {
                        id: currentMovie.id,
                        title: currentMovie.title,
                        fr_title: currentMovie.fr_title,
                        release_date: currentMovie.release_date,
                        poster_path: currentMovie.poster_path,
                        total_revenue_qc: currentRevenue
                    }
                }),
            };
        }

        // Movie needs forecast - calculate based on similar finished movies
        const budget = parseFloat(currentMovie.budget) || 0;
        const minBudget = budget > 0 ? Math.floor(budget * 0.9) : 0;
        const maxBudget = budget > 0 ? Math.ceil(budget * 1.1) : Number.MAX_SAFE_INTEGER;

        // Similar movies should have finished their run (released at least 2 months ago)
        const twoMonthsAgo = new Date();
        twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
        const twoMonthsAgoDate = twoMonthsAgo.toISOString().split('T')[0];

        // Get similar movies by genre
        const byGenreQuery = `
            WITH movie_revenues AS (
                SELECT film_id, COALESCE(MAX(cumulatif_qc_to_date), 0) as total_revenue_qc
                FROM revenues
                GROUP BY film_id
            ),
            current_genres AS (
                SELECT genre_id FROM movie_genres WHERE movie_id = $1
            )
            SELECT
                m.id,
                COALESCE(mr.total_revenue_qc, 0) as total_revenue_qc
            FROM movies m
            JOIN movie_genres mg ON mg.movie_id = m.id
            LEFT JOIN movie_revenues mr ON mr.film_id = m.id
            WHERE mg.genre_id IN (SELECT genre_id FROM current_genres)
              AND m.id != $1
              AND m.release_date <= $2::date
              AND COALESCE(mr.total_revenue_qc, 0) > 0
            GROUP BY m.id, mr.total_revenue_qc;
        `;

        const byCountryQuery = `
            WITH movie_revenues AS (
                SELECT film_id, COALESCE(MAX(cumulatif_qc_to_date), 0) as total_revenue_qc
                FROM revenues
                GROUP BY film_id
            ),
            current_countries AS (
                SELECT country_code FROM movie_countries WHERE movie_id = $1
            )
            SELECT
                m.id,
                COALESCE(mr.total_revenue_qc, 0) as total_revenue_qc
            FROM movies m
            JOIN movie_countries mc ON mc.movie_id = m.id
            LEFT JOIN movie_revenues mr ON mr.film_id = m.id
            WHERE mc.country_code IN (SELECT country_code FROM current_countries)
              AND m.id != $1
              AND m.release_date <= $2::date
              AND COALESCE(mr.total_revenue_qc, 0) > 0
            GROUP BY m.id, mr.total_revenue_qc;
        `;

        const byActorQuery = `
            WITH movie_revenues AS (
                SELECT film_id, COALESCE(MAX(cumulatif_qc_to_date), 0) as total_revenue_qc
                FROM revenues
                GROUP BY film_id
            ),
            current_actors AS (
                SELECT actor_id FROM movie_actors WHERE movie_id = $1 ORDER BY "order" LIMIT 5
            )
            SELECT
                m.id,
                COALESCE(mr.total_revenue_qc, 0) as total_revenue_qc
            FROM movies m
            JOIN movie_actors ma ON ma.movie_id = m.id
            LEFT JOIN movie_revenues mr ON mr.film_id = m.id
            WHERE ma.actor_id IN (SELECT actor_id FROM current_actors)
              AND m.id != $1
              AND m.release_date <= $2::date
              AND COALESCE(mr.total_revenue_qc, 0) > 0
            GROUP BY m.id, mr.total_revenue_qc;
        `;

        const byStudioQuery = `
            WITH movie_revenues AS (
                SELECT film_id, COALESCE(MAX(cumulatif_qc_to_date), 0) as total_revenue_qc
                FROM revenues
                GROUP BY film_id
            )
            SELECT
                m.id,
                COALESCE(mr.total_revenue_qc, 0) as total_revenue_qc
            FROM movies m
            LEFT JOIN movie_revenues mr ON mr.film_id = m.id
            WHERE m.principal_studio_id = $1
              AND m.id != $2
              AND m.release_date <= $3::date
              AND COALESCE(mr.total_revenue_qc, 0) > 0;
        `;

        const byBudgetQuery = `
            WITH movie_revenues AS (
                SELECT film_id, COALESCE(MAX(cumulatif_qc_to_date), 0) as total_revenue_qc
                FROM revenues
                GROUP BY film_id
            )
            SELECT
                m.id,
                COALESCE(mr.total_revenue_qc, 0) as total_revenue_qc
            FROM movies m
            LEFT JOIN movie_revenues mr ON mr.film_id = m.id
            WHERE m.budget BETWEEN $1 AND $2
              AND m.id != $3
              AND m.release_date <= $4::date
              AND COALESCE(mr.total_revenue_qc, 0) > 0;
        `;

        const [byGenreResult, byCountryResult, byActorResult, byStudioResult, byBudgetResult] = await Promise.all([
            client.query(byGenreQuery, [movieId, twoMonthsAgoDate]),
            client.query(byCountryQuery, [movieId, twoMonthsAgoDate]),
            client.query(byActorQuery, [movieId, twoMonthsAgoDate]),
            currentMovie.principal_studio_id ? client.query(byStudioQuery, [currentMovie.principal_studio_id, movieId, twoMonthsAgoDate]) : Promise.resolve({ rows: [] }),
            budget > 0 ? client.query(byBudgetQuery, [minBudget, maxBudget, movieId, twoMonthsAgoDate]) : Promise.resolve({ rows: [] })
        ]);

        // Calculate averages for each bucket
        const calculateAverage = (rows) => {
            if (rows.length === 0) return 0;
            const sum = rows.reduce((acc, row) => acc + parseFloat(row.total_revenue_qc), 0);
            return sum / rows.length;
        };

        const genreAvg = calculateAverage(byGenreResult.rows);
        const countryAvg = calculateAverage(byCountryResult.rows);
        const actorAvg = calculateAverage(byActorResult.rows);
        const studioAvg = calculateAverage(byStudioResult.rows);
        const budgetAvg = calculateAverage(byBudgetResult.rows);

        // Ponderate: genre 20%, country 10%, actor 35%, studio 15%, budget 20%
        const forecast = (genreAvg * 0.20) + (countryAvg * 0.10) + (actorAvg * 0.35) + (studioAvg * 0.15) + (budgetAvg * 0.20);

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
                needsForecast: true,
                currentMovie: {
                    id: currentMovie.id,
                    title: currentMovie.title,
                    fr_title: currentMovie.fr_title,
                    release_date: currentMovie.release_date,
                    poster_path: currentMovie.poster_path,
                    total_revenue_qc: currentRevenue,
                    budget: budget
                },
                forecast: {
                    predictedRevenue: Math.round(forecast),
                    breakdown: {
                        byGenre: { average: Math.round(genreAvg), weight: 0.20, count: byGenreResult.rows.length },
                        byCountry: { average: Math.round(countryAvg), weight: 0.10, count: byCountryResult.rows.length },
                        byActor: { average: Math.round(actorAvg), weight: 0.35, count: byActorResult.rows.length },
                        byStudio: { average: Math.round(studioAvg), weight: 0.15, count: byStudioResult.rows.length },
                        byBudget: { average: Math.round(budgetAvg), weight: 0.20, count: byBudgetResult.rows.length }
                    }
                }
            }),
        };

    } catch (err) {
        console.error('Error fetching forecast:', err);
        console.error('Stack:', err.stack);

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
                error: 'Erreur lors de la récupération des prévisions',
                details: err.message,
                stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
            }),
        };
    }
};
