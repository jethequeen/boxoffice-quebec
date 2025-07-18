import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

export const handler = async (event) => {
    try {
        const { period = 'weekend', limit = 10 } = event.queryStringParameters || {};
        const NEON_DB_URL = process.env.DATABASE_URL;

        const client = new Client({ 
            connectionString: NEON_DB_URL, 
            ssl: { rejectUnauthorized: false } 
        });
        await client.connect();

        let query;
        let values = [limit];

        switch (period) {
            case 'weekend':
                // Get latest weekend box office data
                query = `
                    SELECT m.id, m.title, m.fr_title, m.release_date, m.cumulatif_qc,
                           r.revenue_qc, r.revenue_us, r.rank, r.weekend_id
                    FROM movies m
                    JOIN revenues r ON m.id = r.film_id
                    WHERE r.weekend_id = (
                        SELECT MAX(weekend_id) FROM revenues
                    )
                    ORDER BY r.rank ASC
                    LIMIT $1;
                `;
                break;
            case 'monthly':
                // Get monthly aggregated data (by year)
                query = `
                    SELECT m.id, m.title, m.fr_title,
                           SUM(r.revenue_qc) as monthly_gross_qc,
                           SUM(r.revenue_us) as monthly_gross_us,
                           RIGHT(r.weekend_id::text, 4) as year
                    FROM movies m
                    JOIN revenues r ON m.id = r.film_id
                    WHERE RIGHT(r.weekend_id::text, 4) = RIGHT((SELECT MAX(weekend_id) FROM revenues)::text, 4)
                    GROUP BY m.id, m.title, m.fr_title, RIGHT(r.weekend_id::text, 4)
                    ORDER BY monthly_gross_qc DESC
                    LIMIT $1;
                `;
                break;
            default:
                // Default to recent releases
                query = `
                    SELECT m.id, m.title, m.fr_title, m.release_date
                    FROM movies m
                    ORDER BY m.release_date DESC
                    LIMIT $1;
                `;
        }

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
                period,
                count: result.rows.length
            }),
        };

    } catch (err) {
        console.error('Error fetching box office data:', err);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ 
                error: 'Erreur lors de la récupération des données box-office',
                details: err.message 
            }),
        };
    }
};
