import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

export const handler = async (event) => {
    try {
        const { weekendId } = event.queryStringParameters || {};
        const NEON_DB_URL = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;

        const client = new Client({
            connectionString: NEON_DB_URL,
            ssl: { rejectUnauthorized: false }
        });
        await client.connect();

        let query;
        let values = [];

        if (weekendId) {
            query = `
                SELECT
                    r.weekend_id,
                    COUNT(*) AS total_movies,
                    SUM(r.revenue_qc) AS total_revenue_qc,
                    SUM(r.revenue_us) AS total_revenue_us,
                    AVG(r.revenue_qc) AS avg_revenue_qc,
                    MAX(r.revenue_qc) AS top_revenue_qc
                FROM revenues r
                WHERE r.weekend_id = $1
                GROUP BY r.weekend_id
            `;
            values = [weekendId];
        } else {
            query = `
                SELECT
                    r.weekend_id,
                    COUNT(*) AS total_movies,
                    SUM(r.revenue_qc) AS total_revenue_qc,
                    SUM(r.revenue_us) AS total_revenue_us,
                    AVG(r.revenue_qc) AS avg_revenue_qc,
                    MAX(r.revenue_qc) AS top_revenue_qc
                FROM revenues r
                GROUP BY r.weekend_id
                ORDER BY r.weekend_id DESC
                LIMIT 20
            `;
        }

        const result = await client.query(query, values);

        const formattedData = result.rows.map(row => {
            const s = String(row.weekend_id);
            const year = Number(s.slice(0, 4));
            const weekendNum = Number(s.slice(4)); // last 2 chars
            return {
                ...row,
                year,
                weekend_number: weekendNum,
                formatted_weekend: `Semaine ${weekendNum} de ${year}`
            };
        });

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
                data: weekendId ? formattedData[0] : formattedData,
                weekendId
            })
        };
    } catch (err) {
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                error: 'Erreur lors de la récupération des informations de week-end',
                details: err.message
            })
        };
    }
};
