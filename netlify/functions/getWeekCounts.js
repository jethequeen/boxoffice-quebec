import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

export const handler = async (event) => {
    try {
        const { weekendId } = event.queryStringParameters || {};
        
        if (!weekendId) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ error: 'Weekend ID is required' }),
            };
        }

        const NEON_DB_URL = process.env.DATABASE_URL;

        if (!NEON_DB_URL) {
            throw new Error('DATABASE_URL environment variable is not set');
        }

        const client = new Client({
            connectionString: NEON_DB_URL,
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 10000
        });
        await client.connect();

        // Get week counts for each movie (number of revenue records)
        const query = `
            SELECT r.film_id, COUNT(*) as week_count
            FROM revenues r
            WHERE r.film_id IN (
                SELECT DISTINCT film_id FROM revenues WHERE weekend_id = $1
            )
            GROUP BY r.film_id;
        `;

        const result = await client.query(query, [weekendId]);
        await client.end();

        // Convert to object for easier lookup
        const weekCounts = {};
        result.rows.forEach(row => {
            weekCounts[row.film_id] = parseInt(row.week_count) || 1;
        });

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
            },
            body: JSON.stringify({
                data: weekCounts,
                weekend_id: weekendId,
                count: result.rows.length
            }),
        };

    } catch (err) {
        console.error('Error fetching week counts:', err);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ 
                error: 'Erreur lors de la récupération des compteurs de semaines',
                details: err.message 
            }),
        };
    }
};
