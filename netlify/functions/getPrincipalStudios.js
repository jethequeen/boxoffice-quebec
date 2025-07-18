import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

// noinspection JSUnusedGlobalSymbols
export const handler = async (event) => {
    try {
        console.log('➡️ getPrincipalStudios called with event:', event);

        const movieIdsParam = event.queryStringParameters?.movieIds;
        if (!movieIdsParam) {
            console.error('⛔ Missing movieIds parameter');
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing movieIds parameter' }),
            };
        }

        const movieIds = movieIdsParam.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
        console.log('🎬 Parsed movie IDs:', movieIds);

        const NEON_DB_URL = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;
        const client = new Client({ connectionString: NEON_DB_URL, ssl: { rejectUnauthorized: false } });

        await client.connect();
        console.log('✅ Connected to database');

        const query = `
            SELECT DISTINCT ON (ms.movie_id)
                ms.movie_id,
                s.name
            FROM movie_studio ms
                     JOIN studios s ON s.id = ms.studio_id
                     JOIN (
                SELECT studio_id, COUNT(*) AS total
                FROM movie_studio
                GROUP BY studio_id
            ) studio_counts ON studio_counts.studio_id = ms.studio_id
            WHERE ms.movie_id = ANY($1)
            ORDER BY ms.movie_id, studio_counts.total DESC, s.id;

    `;

        const result = await client.query(query, [movieIds]);
        console.log('📦 Query result:', result.rows);

        const studioMap = {};
        result.rows.forEach(row => {
            studioMap[row.movie_id] = row.name;
        });

        await client.end();
        console.log('✅ Connection closed');

        return {
            statusCode: 200,
            body: JSON.stringify(studioMap),
        };
    } catch (err) {
        console.error('🔥 ERROR in getPrincipalStudios:', err);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal server error', details: err.message }),
        };
    }
};
