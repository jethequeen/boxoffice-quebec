import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

export const handler = async (event) => {
    try {
        const { currentWeekendId } = event.queryStringParameters || {};
        
        if (!currentWeekendId) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ error: 'Current weekend ID is required' }),
            };
        }

        const NEON_DB_URL = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;

        const client = new Client({
            connectionString: NEON_DB_URL,
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 10000
        });
        await client.connect();

        // Calculate previous weekend ID
        const currentStr = currentWeekendId.toString();
        const year = currentStr.slice(-4);
        const weekNum = parseInt(currentStr.slice(0, -4));
        const prevWeekNum = weekNum - 1;
        const previousWeekendId = prevWeekNum > 0 ? `${prevWeekNum.toString().padStart(2, '0')}${year}` : null;

        if (!previousWeekendId) {
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
                    data: [],
                    previous_weekend_id: null,
                    message: 'No previous weekend available'
                }),
            };
        }

        // Get previous weekend data
        const query = `
            SELECT m.id,
                   m.title,
                   m.fr_title,
                   m.release_date,
                   r.revenue_qc,
                   r.revenue_us,
                   r.rank,
                   r.weekend_id
            FROM movies m
                     JOIN revenues r ON m.id = r.film_id
            WHERE r.weekend_id = $1
            ORDER BY r.rank;
        `;

        const result = await client.query(query, [previousWeekendId]);
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
                data: result.rows,
                previous_weekend_id: previousWeekendId,
                current_weekend_id: currentWeekendId,
                count: result.rows.length
            }),
        };

    } catch (err) {
        console.error('Error fetching previous weekend data:', err);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ 
                error: 'Erreur lors de la récupération des données du weekend précédent',
                details: err.message 
            }),
        };
    }
};
