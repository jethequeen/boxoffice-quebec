import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

export const handler = async (event) => {
    try {
        const { weekendId } = event.queryStringParameters || {};
        const NEON_DB_URL = process.env.DATABASE_URL;

        const client = new Client({ 
            connectionString: NEON_DB_URL, 
            ssl: { rejectUnauthorized: false } 
        });
        await client.connect();

        let query;
        let values = [];

        if (weekendId) {
            // Get specific weekend data
            query = `
                SELECT 
                    r.weekend_id,
                    COUNT(*) as total_movies,
                    SUM(r.revenue_qc) as total_revenue_qc,
                    SUM(r.revenue_us) as total_revenue_us,
                    AVG(r.revenue_qc) as avg_revenue_qc,
                    MAX(r.revenue_qc) as top_revenue_qc
                FROM revenues r
                WHERE r.weekend_id = $1
                GROUP BY r.weekend_id;
            `;
            values = [weekendId];
        } else {
            // Get all available weekends with summary data
            query = `
                SELECT 
                    r.weekend_id,
                    COUNT(*) as total_movies,
                    SUM(r.revenue_qc) as total_revenue_qc,
                    SUM(r.revenue_us) as total_revenue_us,
                    AVG(r.revenue_qc) as avg_revenue_qc,
                    MAX(r.revenue_qc) as top_revenue_qc,
                    -- Extract year and weekend number for sorting
                    RIGHT(r.weekend_id::text, 4) as year,
                    LEFT(r.weekend_id::text, LENGTH(r.weekend_id::text) - 4) as weekend_num
                FROM revenues r
                GROUP BY r.weekend_id
                ORDER BY 
                    RIGHT(r.weekend_id::text, 4) DESC,
                    CAST(LEFT(r.weekend_id::text, LENGTH(r.weekend_id::text) - 4) AS INTEGER) DESC
                LIMIT 20;
            `;
        }

        const result = await client.query(query, values);
        
        // Format weekend data with readable dates
        const formattedData = result.rows.map(row => {
            const weekendIdStr = row.weekend_id.toString();
            const year = weekendIdStr.slice(-4);
            const weekendNum = weekendIdStr.slice(0, -4);
            
            return {
                ...row,
                year: parseInt(year),
                weekend_number: parseInt(weekendNum),
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
            }),
        };

    } catch (err) {
        console.error('Error fetching weekend info:', err);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ 
                error: 'Erreur lors de la récupération des informations de week-end',
                details: err.message 
            }),
        };
    }
};
