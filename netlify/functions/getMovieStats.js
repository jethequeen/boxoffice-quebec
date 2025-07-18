import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

export const handler = async (event) => {
    try {
        const { movieId, type = 'summary' } = event.queryStringParameters || {};
        const NEON_DB_URL = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;

        const client = new Client({ 
            connectionString: NEON_DB_URL, 
            ssl: { rejectUnauthorized: false } 
        });
        await client.connect();

        let query;
        let values = [];

        if (movieId) {
            // Get specific movie stats
            query = `
                SELECT m.id, m.title, m.fr_title, m.release_date,
                       COUNT(r.weekend_id) as weeks_in_theaters,
                       SUM(r.revenue_qc) as total_gross_qc,
                       SUM(r.revenue_us) as total_gross_us,
                       AVG(r.revenue_qc) as avg_weekend_gross_qc,
                       MAX(r.revenue_qc) as best_weekend_qc,
                       MIN(r.rank) as best_rank
                FROM movies m
                LEFT JOIN revenues r ON m.id = r.film_id
                WHERE m.id = $1
                GROUP BY m.id, m.title, m.fr_title, m.release_date;
            `;
            values = [movieId];
        } else {
            switch (type) {
                case 'top_grossing':
                    query = `
                        SELECT m.id, m.title, m.fr_title, m.release_date,
                               SUM(r.revenue_qc) as total_gross,
                               SUM(r.revenue_us) as total_gross_us,
                               COUNT(r.weekend_id) as weeks_in_theaters
                        FROM movies m
                        JOIN revenues r ON m.id = r.film_id
                        GROUP BY m.id, m.title, m.fr_title, m.release_date
                        ORDER BY total_gross DESC
                        LIMIT 20;
                    `;
                    break;
                case 'longest_running':
                    query = `
                        SELECT m.id, m.title, m.fr_title, m.release_date,
                               COUNT(r.weekend_id) as weeks_in_theaters,
                               SUM(r.revenue_qc) as total_gross,
                               SUM(r.revenue_us) as total_gross_us
                        FROM movies m
                        JOIN revenues r ON m.id = r.film_id
                        GROUP BY m.id, m.title, m.fr_title, m.release_date
                        ORDER BY weeks_in_theaters DESC
                        LIMIT 20;
                    `;
                    break;
                default:
                    // Summary stats
                    query = `
                        SELECT
                            COUNT(DISTINCT m.id) as total_movies,
                            COUNT(r.weekend_id) as total_weekend_entries,
                            SUM(r.revenue_qc) as total_gross,
                            AVG(r.revenue_qc) as avg_weekend_gross,
                            MAX(r.revenue_qc) as highest_weekend_gross
                        FROM movies m
                        LEFT JOIN revenues r ON m.id = r.film_id;
                    `;
            }
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
                data: movieId ? result.rows[0] : result.rows,
                type,
                movieId
            }),
        };

    } catch (err) {
        console.error('Error fetching movie stats:', err);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ 
                error: 'Erreur lors de la récupération des statistiques',
                details: err.message 
            }),
        };
    }
};
