import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

export const handler = async (event) => {
    try {
        const { limit = 10, weekendId } = event.queryStringParameters || {};
        const NEON_DB_URL = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;


        const client = new Client({
            connectionString: NEON_DB_URL,
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 10000
        });
        await client.connect();

        const query = `
      SELECT m.id, m.title, m.fr_title, m.release_date, m.cumulatif_qc,
             r.revenue_qc, r.revenue_us, r.rank, r.weekend_id
      FROM movies m
      JOIN revenues r ON m.id = r.film_id
      WHERE r.weekend_id = $2
      ORDER BY r.rank 
      LIMIT $1;
    `;

        const values = [limit, weekendId];

        console.log('Query values:', values);

        const result = await client.query(query, values);
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
                weekendId,
                count: result.rows.length
            }),
        };

    } catch (err) {
        console.error('Error fetching box office data:', {
            message: err.message,
            stack: err.stack,
            code: err.code
        });

        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                error: 'Erreur lors de la récupération des données box-office',
                details: err.message,
                timestamp: new Date().toISOString(),
                function: 'getBoxOfficeData'
            }),
        };
    }
};
