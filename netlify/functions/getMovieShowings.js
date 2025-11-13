import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

export const handler = async (event) => {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET, OPTIONS'
            },
            body: ''
        };
    }

    let client;
    try {
        const { movieId, dateFrom, dateTo, theatreId, timeRange, company, lat, lon, limit } = event.queryStringParameters || {};

        if (!movieId) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ error: 'Movie ID is required' }),
            };
        }

        const NEON_DB_URL = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;
        client = new Client({
            connectionString: NEON_DB_URL,
            ssl: { rejectUnauthorized: false }
        });
        await client.connect();

        // Build the query dynamically based on filters
        let queryParams = [movieId];
        let dateFilter = '';
        let theatreFilter = '';
        let timeRangeFilter = '';
        let companyFilter = '';
        let nearbyFilter = '';

        if (dateFrom && dateTo) {
            queryParams.push(dateFrom, dateTo);
            dateFilter = `AND s.date BETWEEN $${queryParams.length - 1} AND $${queryParams.length}`;
        } else if (dateFrom) {
            queryParams.push(dateFrom);
            dateFilter = `AND s.date >= $${queryParams.length}`;
        } else if (dateTo) {
            queryParams.push(dateTo);
            dateFilter = `AND s.date <= $${queryParams.length}`;
        }

        if (theatreId) {
            queryParams.push(theatreId);
            theatreFilter = `AND s.theater_id = $${queryParams.length}`;
        }

        if (timeRange) {
            const [startHour, endHour] = timeRange.split('-').map(h => parseInt(h));
            timeRangeFilter = `AND EXTRACT(HOUR FROM s.start_at) >= ${startHour} AND EXTRACT(HOUR FROM s.start_at) < ${endHour}`;
        }

        if (company) {
            queryParams.push(`%${company}%`);
            companyFilter = `AND t.company ILIKE $${queryParams.length}`;
        }

        // If geolocation provided, filter to nearby theaters
        if (lat && lon) {
            const maxDistance = limit || 50; // km
            nearbyFilter = `AND ST_DWithin(
                t.location::geography,
                ST_SetSRID(ST_MakePoint($${queryParams.length + 1}, $${queryParams.length + 2}), 4326)::geography,
                ${maxDistance * 1000}
            )`;
            queryParams.push(parseFloat(lon), parseFloat(lat));
        }

        // Query to get showings with theater info
        const showingsQuery = `
            SELECT
                s.id,
                s.movie_id,
                s.theater_id,
                s.date,
                s.start_at,
                s.screen_id,
                s.language,
                sc.seat_count as total_seats,
                s.seats_sold,
                t.name as theatre_name,
                t.company as theatre_company,
                t.showings_url as theatre_website,
                sc.name as auditorium
                ${lat && lon ? `, ST_Distance(
                    t.location::geography,
                    ST_SetSRID(ST_MakePoint($${queryParams.length - 1}, $${queryParams.length}), 4326)::geography
                ) / 1000 as distance_km` : ''}
            FROM showings s
            JOIN theaters t ON t.id = s.theater_id
            LEFT JOIN screens sc ON sc.id = s.screen_id
            WHERE s.movie_id = $1
            ${dateFilter}
            ${theatreFilter}
            ${timeRangeFilter}
            ${companyFilter}
            ${nearbyFilter}
            ORDER BY ${lat && lon ? 'distance_km ASC,' : ''} s.date DESC, t.name, sc.name, s.start_at;
        `;

        const showingsResult = await client.query(showingsQuery, queryParams);

        // Get unique theaters for filter dropdown
        const theatersQuery = `
            SELECT DISTINCT t.id, t.name, t.company
            FROM theaters t
            JOIN showings s ON s.theater_id = t.id
            WHERE s.movie_id = $1
            ORDER BY t.name;
        `;
        const theatersResult = await client.query(theatersQuery, [movieId]);

        // Get unique companies for filter dropdown
        const companiesQuery = `
            SELECT DISTINCT t.company
            FROM theaters t
            JOIN showings s ON s.theater_id = t.id
            WHERE s.movie_id = $1 AND t.company IS NOT NULL
            ORDER BY t.company;
        `;
        const companiesResult = await client.query(companiesQuery, [movieId]);

        await client.end();

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET, OPTIONS'
            },
            body: JSON.stringify({
                showings: showingsResult.rows,
                theaters: theatersResult.rows,
                companies: companiesResult.rows.map(r => r.company),
                count: showingsResult.rows.length
            }),
        };

    } catch (err) {
        console.error('Error fetching movie showings:', err);
        console.error('Stack:', err.stack);

        // Ensure we always close the client connection
        try {
            if (client) await client.end();
        } catch (e) {
            console.error('Error closing client:', e);
        }

        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                error: 'Erreur lors de la récupération des représentations',
                details: err.message,
                stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
            }),
        };
    }
};