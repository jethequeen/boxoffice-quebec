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
        const {
            startDate,
            endDate,
            directors,
            actors,
            studios,
            genres,
            countries,
            canadianOnly
        } = event.queryStringParameters || {};

        console.log('[INFO] getTopStats called with:', { startDate, endDate, canadianOnly, hasFilters: !!(directors || actors || studios || genres || countries) });

        if (!startDate || !endDate) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ error: 'startDate and endDate are required' }),
            };
        }

        const NEON_DB_URL = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;
        if (!NEON_DB_URL) {
            console.error('[ERROR] No database URL found in environment variables');
            return {
                statusCode: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ error: 'Database configuration missing' }),
            };
        }

        client = new Client({
            connectionString: NEON_DB_URL,
            ssl: { rejectUnauthorized: false }
        });
        await client.connect();

        // Build filter conditions for movies
        const movieFilterConditions = [];
        const movieFilterParams = [];
        let paramIndex = 3; // Start at 3 because $1 and $2 are startDate and endDate

        if (directors) {
            const directorIds = directors.split(',').map(id => parseInt(id));
            movieFilterConditions.push(`m.id IN (SELECT movie_id FROM movie_crew WHERE crew_id = ANY($${paramIndex}))`);
            movieFilterParams.push(directorIds);
            paramIndex++;
        }

        if (actors) {
            const actorIds = actors.split(',').map(id => parseInt(id));
            movieFilterConditions.push(`m.id IN (SELECT movie_id FROM movie_actors WHERE actor_id = ANY($${paramIndex}))`);
            movieFilterParams.push(actorIds);
            paramIndex++;
        }

        if (studios) {
            const studioIds = studios.split(',').map(id => parseInt(id));
            movieFilterConditions.push(`m.id IN (SELECT movie_id FROM movie_studio WHERE studio_id = ANY($${paramIndex}))`);
            movieFilterParams.push(studioIds);
            paramIndex++;
        }

        if (genres) {
            const genreIds = genres.split(',').map(id => parseInt(id));
            movieFilterConditions.push(`m.id IN (SELECT movie_id FROM movie_genres WHERE genre_id = ANY($${paramIndex}))`);
            movieFilterParams.push(genreIds);
            paramIndex++;
        }

        if (countries) {
            const countryCodes = countries.split(',');
            movieFilterConditions.push(`m.id IN (SELECT movie_id FROM movie_countries WHERE country_code = ANY($${paramIndex}))`);
            movieFilterParams.push(countryCodes);
            paramIndex++;
        }

        // Canadian films only: must have CA, and optionally FR, but no other countries
        if (canadianOnly === 'true') {
            movieFilterConditions.push(`
                m.id IN (
                    SELECT mc.movie_id
                    FROM movie_countries mc
                    WHERE mc.movie_id IN (SELECT movie_id FROM movie_countries WHERE country_code = 'CA')
                    GROUP BY mc.movie_id
                    HAVING
                        (COUNT(*) = 1 AND MAX(mc.country_code) = 'CA')
                        OR
                        (COUNT(*) = 2 AND
                         COUNT(CASE WHEN mc.country_code = 'CA' THEN 1 END) = 1 AND
                         COUNT(CASE WHEN mc.country_code = 'FR' THEN 1 END) = 1)
                )
            `);
        }

        const movieFilterWhereClause = movieFilterConditions.length > 0
            ? `AND ${movieFilterConditions.join(' AND ')}`
            : '';

        // Calculate revenue for movies in the date range
        // Strategy: Get cumulative revenue at end of range minus cumulative revenue before start of range
        // Guard: If movie's entire run is within the range (revenue_before_start = 0),
        //        only include if release date is also within the range
        const movieRevenuesQuery = `
            WITH movie_weekend_revenues AS (
                SELECT
                    r.film_id,
                    w.start_date,
                    r.cumulatif_qc_to_date
                FROM revenues r
                JOIN weekends w ON w.id = r.weekend_id
                WHERE w.start_date <= $2::date
            ),
            movie_range_revenues AS (
                SELECT
                    film_id,
                    MAX(CASE WHEN start_date <= $2::date THEN cumulatif_qc_to_date ELSE 0 END) as revenue_at_end,
                    MAX(CASE WHEN start_date < $1::date THEN cumulatif_qc_to_date ELSE 0 END) as revenue_before_start
                FROM movie_weekend_revenues
                GROUP BY film_id
            )
            SELECT
                m.id as film_id,
                GREATEST(COALESCE(mrr.revenue_at_end, 0) - COALESCE(mrr.revenue_before_start, 0), 0) as revenue_in_range
            FROM movies m
            LEFT JOIN movie_range_revenues mrr ON mrr.film_id = m.id
            WHERE GREATEST(COALESCE(mrr.revenue_at_end, 0) - COALESCE(mrr.revenue_before_start, 0), 0) > 0
              AND (
                -- Either the movie had revenue before the range start (partial run in range)
                COALESCE(mrr.revenue_before_start, 0) > 0
                -- OR the movie's entire run is in range AND it was released within the range
                OR (COALESCE(mrr.revenue_before_start, 0) = 0 AND m.release_date >= $1::date)
              )
            ${movieFilterWhereClause};
        `;

        const movieRevenuesResult = await client.query(movieRevenuesQuery, [startDate, endDate, ...movieFilterParams]);

        if (movieRevenuesResult.rows.length === 0) {
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
                    topMovies: [],
                    topGenres: [],
                    topStudios: [],
                    topCountries: [],
                    topActors: [],
                    dateRange: { startDate, endDate }
                }),
            };
        }

        const revenueMap = new Map(movieRevenuesResult.rows.map(r => [r.film_id, parseFloat(r.revenue_in_range)]));
        const movieIds = Array.from(revenueMap.keys());

        // TOP 20 MOVIES
        const topMoviesQuery = `
            SELECT
                m.id,
                m.title,
                m.fr_title,
                m.release_date,
                m.poster_path
            FROM movies m
            WHERE m.id = ANY($1)
            ORDER BY m.id;
        `;

        const topMoviesResult = await client.query(topMoviesQuery, [movieIds]);

        const topMovies = topMoviesResult.rows
            .map(movie => ({
                ...movie,
                revenue_in_range: revenueMap.get(movie.id) || 0
            }))
            .sort((a, b) => b.revenue_in_range - a.revenue_in_range)
            .slice(0, 20);

        // Batch query all relationships at once
        const [genresResult, studiosResult, countriesResult, actorsResult] = await Promise.all([
            client.query(
                'SELECT mg.movie_id, g.id as genre_id, g.name FROM movie_genres mg JOIN genres g ON g.id = mg.genre_id WHERE mg.movie_id = ANY($1)',
                [movieIds]
            ),
            client.query(
                'SELECT ms.movie_id, s.id as studio_id, s.name FROM movie_studio ms JOIN studios s ON s.id = ms.studio_id WHERE ms.movie_id = ANY($1)',
                [movieIds]
            ),
            client.query(
                'SELECT mc.movie_id, c.code as country_code, c.name FROM movie_countries mc JOIN countries c ON c.code = mc.country_code WHERE mc.movie_id = ANY($1)',
                [movieIds]
            ),
            client.query(
                'SELECT ma.movie_id, a.id as actor_id, a.name FROM movie_actors ma JOIN actors a ON a.id = ma.actor_id WHERE ma.movie_id = ANY($1)',
                [movieIds]
            )
        ]);

        // Process genres
        const genreRevenueMap = new Map();
        const genreMovieCount = new Map();
        for (const row of genresResult.rows) {
            const revenue = revenueMap.get(row.movie_id) || 0;
            const genreKey = `${row.genre_id}|${row.name}`;
            genreRevenueMap.set(genreKey, (genreRevenueMap.get(genreKey) || 0) + revenue);
            const movieSet = genreMovieCount.get(genreKey) || new Set();
            movieSet.add(row.movie_id);
            genreMovieCount.set(genreKey, movieSet);
        }
        const topGenres = Array.from(genreRevenueMap.entries())
            .map(([key, revenue]) => {
                const [id, name] = key.split('|');
                return {
                    id: parseInt(id),
                    name,
                    total_revenue: revenue,
                    movie_count: genreMovieCount.get(key).size
                };
            })
            .filter(g => g.movie_count >= 2)
            .sort((a, b) => b.total_revenue - a.total_revenue)
            .slice(0, 10);

        // Process studios
        const studioRevenueMap = new Map();
        const studioMovieCount = new Map();
        for (const row of studiosResult.rows) {
            const revenue = revenueMap.get(row.movie_id) || 0;
            const studioKey = `${row.studio_id}|${row.name}`;
            studioRevenueMap.set(studioKey, (studioRevenueMap.get(studioKey) || 0) + revenue);
            const movieSet = studioMovieCount.get(studioKey) || new Set();
            movieSet.add(row.movie_id);
            studioMovieCount.set(studioKey, movieSet);
        }
        const topStudios = Array.from(studioRevenueMap.entries())
            .map(([key, revenue]) => {
                const [id, name] = key.split('|');
                return {
                    id: parseInt(id),
                    name,
                    total_revenue: revenue,
                    movie_count: studioMovieCount.get(key).size
                };
            })
            .filter(s => s.movie_count >= 2)
            .sort((a, b) => b.total_revenue - a.total_revenue)
            .slice(0, 10);

        // Process countries
        const countryRevenueMap = new Map();
        const countryMovieCount = new Map();
        for (const row of countriesResult.rows) {
            const revenue = revenueMap.get(row.movie_id) || 0;
            const countryKey = `${row.country_code}|${row.name}`;
            countryRevenueMap.set(countryKey, (countryRevenueMap.get(countryKey) || 0) + revenue);
            const movieSet = countryMovieCount.get(countryKey) || new Set();
            movieSet.add(row.movie_id);
            countryMovieCount.set(countryKey, movieSet);
        }
        const topCountries = Array.from(countryRevenueMap.entries())
            .map(([key, revenue]) => {
                const [code, name] = key.split('|');
                return {
                    code,
                    name,
                    total_revenue: revenue,
                    movie_count: countryMovieCount.get(key).size
                };
            })
            .filter(c => c.movie_count >= 2)
            .sort((a, b) => b.total_revenue - a.total_revenue)
            .slice(0, 10);

        // Process actors
        const actorRevenueMap = new Map();
        const actorMovieCount = new Map();
        for (const row of actorsResult.rows) {
            const revenue = revenueMap.get(row.movie_id) || 0;
            const actorKey = `${row.actor_id}|${row.name}`;
            actorRevenueMap.set(actorKey, (actorRevenueMap.get(actorKey) || 0) + revenue);
            const movieSet = actorMovieCount.get(actorKey) || new Set();
            movieSet.add(row.movie_id);
            actorMovieCount.set(actorKey, movieSet);
        }
        const topActors = Array.from(actorRevenueMap.entries())
            .map(([key, revenue]) => {
                const [id, name] = key.split('|');
                return {
                    id: parseInt(id),
                    name,
                    total_revenue: revenue,
                    movie_count: actorMovieCount.get(key).size
                };
            })
            .filter(a => a.movie_count >= 2)
            .sort((a, b) => b.total_revenue - a.total_revenue)
            .slice(0, 10);

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
                topMovies: topMovies,
                topGenres: topGenres,
                topStudios: topStudios,
                topCountries: topCountries,
                topActors: topActors,
                dateRange: {
                    startDate,
                    endDate
                }
            }),
        };

    } catch (err) {
        console.error('[ERROR] Top Stats Error:', err.message);
        console.error('[ERROR] Stack:', err.stack);
        console.error('[ERROR] Query params:', event.queryStringParameters);

        try {
            if (client) await client.end();
        } catch (e) {
            console.error('[ERROR] Error closing client:', e);
        }

        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                error: 'Erreur lors de la récupération des tops',
                details: err.message,
                errorName: err.name,
                stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
            }),
        };
    }
};
