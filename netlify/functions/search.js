import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const json = (body, statusCode = 200) => ({
    statusCode,
    headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
});

// Normalize: lowercase, strip common French accents via TRANSLATE, strip punctuation
// (works without the unaccent extension)
const NORM = (col) => `
  regexp_replace(
    translate(
      lower(${col}),
      'àáâäãåæçèéêëìíîïñòóôöõœùúûüýÿ’ʼ''‘\`´-',
      'aaaaaaacceeeeiiiinooooouuuuyy      '
    ),
    '[^a-z0-9 ]', '', 'g'
  )
`;
const NORM_PARAM = (p) => `
  regexp_replace(
    translate(
      lower(${p}),
      'àáâäãåæçèéêëìíîïñòóôöõœùúûüýÿ’ʼ''‘\`´-',
      'aaaaaaacceeeeiiiinooooouuuuyy      '
    ),
    '[^a-z0-9 ]', '', 'g'
  )
`;

export const handler = async (event) => {
    const q = (event.queryStringParameters?.q || '').trim();
    if (q.length < 2) return json({ movies: [], people: [] });

    const NEON_DB_URL = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;
    const client = new Client({ connectionString: NEON_DB_URL, ssl: { rejectUnauthorized: false } });

    try {
        await client.connect();
        const pattern = q;

        const moviesQ = client.query(
            `
  WITH qn AS (SELECT ${NORM_PARAM('$1')} AS nq)
  SELECT
    m.id,
    COALESCE(m.fr_title, m.title) AS label,
    (
      SELECT c.name
      FROM movie_crew md
      JOIN crew c ON c.id = md.crew_id
      WHERE md.movie_id = m.id                     
      ORDER BY  c.popularity DESC NULLS LAST
      LIMIT 1
    ) AS director,
    GREATEST(
      similarity(${NORM('m.title')},             (SELECT nq FROM qn)),
      similarity(${NORM("COALESCE(m.fr_title,'')")}, (SELECT nq FROM qn))
    ) AS score
  FROM movies m, qn
  WHERE
      ${NORM('m.title')}                 LIKE '%' || (SELECT nq FROM qn) || '%'
   OR ${NORM("COALESCE(m.fr_title,'')")} LIKE '%' || (SELECT nq FROM qn) || '%'
   OR similarity(${NORM('m.title')},             (SELECT nq FROM qn)) >= 0.25
   OR similarity(${NORM("COALESCE(m.fr_title,'')")}, (SELECT nq FROM qn)) >= 0.25
  ORDER BY score DESC,
           COALESCE(m.popularity, 0) DESC,
           m.release_date DESC NULLS LAST
  LIMIT 8;
  `,
            [pattern]
        );


        // Actors (max 5)
        const actorsQ = client.query(
            `
                SELECT a.id, a.name AS label, 'actor'::text AS role
                FROM actors a
                WHERE ${NORM('a.name')} LIKE '%' || ${NORM_PARAM('$1')} || '%'
                ORDER BY COALESCE(a.popularity, 0) DESC, a.id
                LIMIT 5;
            `,
            [pattern]
        );

        // Directors (max 5)
        const directorsQ = client.query(
            `
      SELECT c.id, c.name AS label, 'director'::text AS role
      FROM crew c
      WHERE ${NORM('c.name')} LIKE '%' || ${NORM_PARAM('$1')} || '%'
      ORDER BY COALESCE(c.popularity, 0) DESC, c.id
      LIMIT 5;
      `,
            [pattern]
        );

        const [moviesRes, actorsRes, directorsRes] = await Promise.all([moviesQ, actorsQ, directorsQ]);

        // Merge people (prefer "director" if same id appears twice)
        const byId = new Map();
        for (const r of actorsRes.rows) byId.set(r.id, { id: r.id, label: r.label, role: 'actor' });
        for (const r of directorsRes.rows) {
            const ex = byId.get(r.id);
            if (!ex || ex.role !== 'director') byId.set(r.id, { id: r.id, label: r.label, role: 'director' });
        }

        return json({
            movies: moviesRes.rows.map(r => ({ id: r.id, label: r.label, extra: r.director || null })),
            people: Array.from(byId.values()),
        });
    } catch (err) {
        console.error('search error:', err);
        // Keep 500 for observability; frontend now handles it gracefully
        return json({ error: 'search_failed', details: err.message }, 500);
    } finally {
        try { await client.end(); } catch {}
    }
};
