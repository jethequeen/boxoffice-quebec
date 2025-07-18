import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

export const handler = async (event) => {
    try {
        const { directorId, type = 'top_grossing' } = event.queryStringParameters || {};
        const NEON_DB_URL = process.env.DATABASE_URL;

        const client = new Client({ 
            connectionString: NEON_DB_URL, 
            ssl: { rejectUnauthorized: false } 
        });
        await client.connect();

        let query;
        let values = [];

        if (directorId) {
            // Get specific director stats
            query = `
                SELECT d.id, d.name,
                       COUNT(DISTINCT m.id) as total_movies,
                       SUM(r.revenue_qc) as total_gross,
                       AVG(r.revenue_qc) as avg_weekend_gross,
                       MAX(r.revenue_qc) as best_weekend
                FROM directors d
                JOIN movie_directors md ON d.id = md.director_id
                JOIN movies m ON md.movie_id = m.id
                LEFT JOIN revenues r ON m.id = r.film_id
                WHERE d.id = $1
                GROUP BY d.id, d.name;
            `;
            values = [directorId];
        } else {
            switch (type) {
                case 'top_grossing':
                    query = `
                        SELECT d.id, d.name,
                               COUNT(DISTINCT m.id) as total_movies,
                               SUM(r.revenue_qc) as total_gross,
                               AVG(r.revenue_qc) as avg_weekend_gross
                        FROM directors d
                        JOIN movie_directors md ON d.id = md.director_id
                        JOIN movies m ON md.movie_id = m.id
                        JOIN revenues r ON m.id = r.film_id
                        GROUP BY d.id, d.name
                        HAVING SUM(r.revenue_qc) IS NOT NULL
                        ORDER BY total_gross DESC
                        LIMIT 20;
                    `;
                    break;
                case 'most_prolific':
                    query = `
                        SELECT d.id, d.name,
                               COUNT(DISTINCT m.id) as total_movies,
                               SUM(r.revenue_qc) as total_gross,
                               AVG(r.revenue_qc) as avg_weekend_gross
                        FROM directors d
                        JOIN movie_directors md ON d.id = md.director_id
                        JOIN movies m ON md.movie_id = m.id
                        LEFT JOIN revenues r ON m.id = r.film_id
                        GROUP BY d.id, d.name
                        ORDER BY total_movies DESC
                        LIMIT 20;
                    `;
                    break;
                case 'best_average':
                    query = `
                        SELECT d.id, d.name,
                               COUNT(DISTINCT m.id) as total_movies,
                               SUM(r.revenue_qc) as total_gross,
                               AVG(r.revenue_qc) as avg_weekend_gross
                        FROM directors d
                        JOIN movie_directors md ON d.id = md.director_id
                        JOIN movies m ON md.movie_id = m.id
                        JOIN revenues r ON m.id = r.film_id
                        GROUP BY d.id, d.name
                        HAVING COUNT(DISTINCT m.id) >= 2
                        ORDER BY avg_weekend_gross DESC
                        LIMIT 20;
                    `;
                    break;
                default:
                    // Summary stats
                    query = `
                        SELECT
                            COUNT(DISTINCT d.id) as total_directors,
                            COUNT(DISTINCT m.id) as total_movies_with_directors,
                            SUM(r.revenue_qc) as total_gross,
                            AVG(r.revenue_qc) as avg_weekend_gross
                        FROM directors d
                        JOIN movie_directors md ON d.id = md.director_id
                        JOIN movies m ON md.movie_id = m.id
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
                data: directorId ? result.rows[0] : result.rows,
                type,
                directorId
            }),
        };

    } catch (err) {
        console.error('Error fetching director stats:', err);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ 
                error: 'Erreur lors de la récupération des statistiques des réalisateurs',
                details: err.message 
            }),
        };
    }
};
