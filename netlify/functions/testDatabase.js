import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

export const handler = async () => {
    try {
        const NEON_DB_URL = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;

        const client = new Client({
            connectionString: NEON_DB_URL,
            ssl: { rejectUnauthorized: false }
        });
        await client.connect();

        // Simple test queries
        const tests = {};

        // Test 1: Get table names
        try {
            const tablesQuery = `
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                ORDER BY table_name;
            `;
            const tablesResult = await client.query(tablesQuery);
            tests.tables = tablesResult.rows.map(t => t.table_name);
        } catch (err) {
            tests.tables = { error: err.message };
        }

        // Test 2: Count movies
        try {
            const moviesCountQuery = `SELECT COUNT(*) as count FROM movies;`;
            const moviesCountResult = await client.query(moviesCountQuery);
            tests.moviesCount = moviesCountResult.rows[0].count;
        } catch (err) {
            tests.moviesCount = { error: err.message };
        }

        // Test 3: Count revenues data
        try {
            const revenuesCountQuery = `SELECT COUNT(*) as count FROM revenues;`;
            const revenuesCountResult = await client.query(revenuesCountQuery);
            tests.revenuesCount = revenuesCountResult.rows[0].count;
        } catch (err) {
            tests.revenuesCount = { error: err.message };
        }

        // Test 4: Sample movies
        try {
            const sampleMoviesQuery = `SELECT id, title, fr_title, release_date FROM movies LIMIT 3;`;
            const sampleMoviesResult = await client.query(sampleMoviesQuery);
            tests.sampleMovies = sampleMoviesResult.rows;
        } catch (err) {
            tests.sampleMovies = { error: err.message };
        }

        // Test 5: Sample revenues data
        try {
            const sampleRevenuesQuery = `SELECT film_id, revenue_qc, revenue_us, rank, weekend_id FROM revenues LIMIT 3;`;
            const sampleRevenuesResult = await client.query(sampleRevenuesQuery);
            tests.sampleRevenues = sampleRevenuesResult.rows;
        } catch (err) {
            tests.sampleRevenues = { error: err.message };
        }

        // Test 6: Latest weekend
        try {
            const latestWeekendQuery = `SELECT MAX(weekend_id) as latest_weekend FROM revenues;`;
            const latestWeekendResult = await client.query(latestWeekendQuery);
            tests.latestWeekend = latestWeekendResult.rows[0].latest_weekend;
        } catch (err) {
            tests.latestWeekend = { error: err.message };
        }

        await client.end();

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                success: true,
                tests
            }),
        };

    } catch (err) {
        console.error('Database test error:', err);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                success: false,
                error: 'Database connection failed',
                details: err.message
            }),
        };
    }
};
