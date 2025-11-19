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
        const { type, query } = event.queryStringParameters || {};

        if (!type || !query) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ error: 'type and query are required' }),
            };
        }

        const NEON_DB_URL = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;
        client = new Client({
            connectionString: NEON_DB_URL,
            ssl: { rejectUnauthorized: false }
        });
        await client.connect();

        let results = [];
        const searchTerm = `%${query}%`;

        switch(type) {
            case 'directors':
                const directorsQuery = `
                    SELECT DISTINCT c.id, c.name, COUNT(mc.movie_id) as movie_count
                    FROM crew c
                    JOIN movie_crew mc ON mc.crew_id = c.id
                    WHERE LOWER(c.name) LIKE LOWER($1)
                    GROUP BY c.id, c.name
                    ORDER BY movie_count DESC, c.name
                    LIMIT 10;
                `;
                const directorsResult = await client.query(directorsQuery, [searchTerm]);
                results = directorsResult.rows.map(r => ({ id: r.id, name: r.name }));
                break;

            case 'actors':
                const actorsQuery = `
                    SELECT DISTINCT a.id, a.name, COUNT(ma.movie_id) as movie_count
                    FROM actors a
                    JOIN movie_actors ma ON ma.actor_id = a.id
                    WHERE LOWER(a.name) LIKE LOWER($1)
                    GROUP BY a.id, a.name
                    ORDER BY movie_count DESC, a.name
                    LIMIT 10;
                `;
                const actorsResult = await client.query(actorsQuery, [searchTerm]);
                results = actorsResult.rows.map(r => ({ id: r.id, name: r.name }));
                break;

            case 'studios':
                const studiosQuery = `
                    SELECT DISTINCT s.id, s.name, COUNT(ms.movie_id) as movie_count
                    FROM studios s
                    JOIN movie_studio ms ON ms.studio_id = s.id
                    WHERE LOWER(s.name) LIKE LOWER($1)
                    GROUP BY s.id, s.name
                    ORDER BY movie_count DESC, s.name
                    LIMIT 10;
                `;
                const studiosResult = await client.query(studiosQuery, [searchTerm]);
                results = studiosResult.rows.map(r => ({ id: r.id, name: r.name }));
                break;

            case 'genres':
                const genresQuery = `
                    SELECT DISTINCT g.id, g.name, COUNT(mg.movie_id) as movie_count
                    FROM genres g
                    LEFT JOIN movie_genres mg ON mg.genre_id = g.id
                    WHERE LOWER(g.name) LIKE LOWER($1)
                    GROUP BY g.id, g.name
                    ORDER BY movie_count DESC, g.name
                    LIMIT 10;
                `;
                const genresResult = await client.query(genresQuery, [searchTerm]);
                results = genresResult.rows.map(r => ({ id: r.id, name: r.name }));
                break;

            case 'countries':
                const countriesQuery = `
                    SELECT DISTINCT c.code as id, c.name, COUNT(mc.movie_id) as movie_count
                    FROM countries c
                    LEFT JOIN movie_countries mc ON mc.country_code = c.code
                    WHERE LOWER(c.name) LIKE LOWER($1) OR LOWER(c.code) LIKE LOWER($1)
                    GROUP BY c.code, c.name
                    ORDER BY movie_count DESC, c.name
                    LIMIT 10;
                `;
                const countriesResult = await client.query(countriesQuery, [searchTerm]);
                results = countriesResult.rows.map(r => ({ id: r.id, name: r.name }));
                break;

            default:
                await client.end();
                return {
                    statusCode: 400,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    },
                    body: JSON.stringify({ error: 'Invalid type' }),
                };
        }

        await client.end();

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET, OPTIONS'
            },
            body: JSON.stringify({ results }),
        };

    } catch (err) {
        console.error('Error fetching autocomplete:', err);
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
                error: 'Erreur lors de la récupération des suggestions',
                details: err.message
            }),
        };
    }
};
