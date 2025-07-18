import { Client } from 'pg'
import dotenv from 'dotenv'
dotenv.config()

export const handler = async (event) => {
    try {
        const { weekendId } = event.queryStringParameters || {}

        if (!weekendId) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ error: 'Weekend ID is required' }),
            }
        }

        const NEON_DB_URL = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL

        const client = new Client({
            connectionString: NEON_DB_URL,
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 10000
        })
        await client.connect()

        // 1. Get end_date of the requested weekend
        const weekendDateQuery = `SELECT end_date FROM weekends WHERE id = $1`
        const dateResult = await client.query(weekendDateQuery, [weekendId])

        const endDate = dateResult.rows[0].end_date
        console.log(`📅 Weekend end date: ${endDate}`)

        // 2. Get all movie IDs for this weekend
        const movieIdsQuery = `SELECT DISTINCT film_id FROM revenues WHERE weekend_id = $1`
        const movieIdResult = await client.query(movieIdsQuery, [weekendId])
        const movieIds = movieIdResult.rows.map(r => r.film_id)
        console.log(`🎬 Movie IDs for weekend ${weekendId}:`, movieIds)

        if (movieIds.length === 0) {
            return {
                statusCode: 200,
                body: JSON.stringify({ data: {}, weekend_id: weekendId, count: 0 }),
            }
        }

        // 3. Count the number of revenue entries for each film_id up to this end date
        const query = `
            SELECT film_id, COUNT(*) AS week_count
            FROM revenues r
            JOIN weekends w ON r.weekend_id = w.id
            WHERE film_id = ANY($1) AND w.end_date <= $2
            GROUP BY film_id;
        `

        const result = await client.query(query, [movieIds, endDate])
        await client.end()

        const weekCounts = {}
        result.rows.forEach(row => {
            weekCounts[row.film_id] = parseInt(row.week_count) || 1
        })

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
        }

    } catch (err) {
        console.error('Error fetching week counts:', err)
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
        }
    }
}
