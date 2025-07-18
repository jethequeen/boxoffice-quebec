import { Client } from 'pg';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();


export const handler = async () => {
    try {
        const tmdbId = 550;
        const TMDB_API_KEY = process.env.TMDB_API_KEY;
        const NEON_DB_URL = process.env.DATABASE_URL;

        const tmdbUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=fr-FR`;
        const response = await fetch(tmdbUrl);
        const movie = await response.json();

        if (!movie.id) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'Film non trouvé dans TMDB' }),
            };
        }

        const client = new Client({ connectionString: NEON_DB_URL, ssl: { rejectUnauthorized: false } });
        await client.connect();

        const insertQuery = `
      INSERT INTO movies (id, title, fr_title, release_date)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT DO NOTHING RETURNING *;
    `;
        const values = [movie.id, movie.title, movie.title, movie.release_date];
        const result = await client.query(insertQuery, values);

        await client.end();

        return {
            statusCode: 200,
            body: JSON.stringify({ inserted: result.rows[0] || null }),
        };

    } catch (err) {
        console.error(err);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Erreur serveur' }),
        };
    }
};
