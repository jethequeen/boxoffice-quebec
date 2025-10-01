// netlify/functions/report.js
import OpenAI from 'openai';
import { sql } from '../lib/db.js';

const oa = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const IS_PROD = process.env.NODE_ENV === 'production';

/* Light schema hint for the model (no tight policing) */
const SCHEMA = `
tables:
  movies(
    id int,
    title text,
    fr_title text,
    release_date date,
    budget numeric,
    runtime int,
    cumulatif_qc bigint,
    principal_studio_id int,
    poster_path text
  )
  genres(
    id int,
    name text
  )
  movie_genres(
    movie_id int,
    genre_id int
  )
  actors(
    id int,
    name text,
    gender text,
    popularity real,
    profile_path text
  )
  movie_actors(
    movie_id int,
    actor_id int,
    "order" int
  )
  studios(
    id int,
    name text
  )
  weekends(
    id int,
    start_date date,
    end_date date,
    total_revenues_qc numeric,
    total_revenues_us numeric,
    change_qc numeric,
    change_us numeric
  )
  revenues(
    film_id int,
    weekend_id int,
    rank int,
    cumulatif_qc_to_date numeric,
    cumulatif_us_to_date numeric,
    force_qc_usa numeric,
    week_count int,
    average_showing_occupancy numeric,
    showings_proportion numeric
  )
  showings(
    movie_id int,
    date date
  )
  countries(
    code VARCHAR(2),
    name text,
    fr_name text
  )
  movie_countries(
    movie_id int,
    country_code VARCHAR(5)
  )
    

relationships:
  movies.principal_studio_id -> studios.id
  movie_genres.movie_id -> movies.id
  movie_genres.genre_id -> genres.id
  movie_actors.movie_id -> movies.id
  movie_actors.actor_id -> actors.id
  revenues.film_id -> movies.id
  revenues.weekend_id -> weekends.id
  showings.movie_id -> movies.id

notes:
  - Year can be derived from release_date: EXTRACT(YEAR FROM release_date).
  - Total gross, revenues totaux, those like that means that we want the MAX(cumulatif_qc_to_date) or MAX(cumulatif_us_to_date)
  , depending on the region specified. You must compute one row per film with MAX(revenues.cumulatif_qc_to_date) AS total_revenue_qc in a CTE (e.g., per_film).
  - Prefer LIMIT <= 200 for UI-friendly responses.
`;


const bannedKw = /\b(insert|update|delete|drop|alter|grant|revoke|call|copy|truncate|create|comment)\b/i;

/* ---------- helpers ---------- */
function extractSelect(raw) {
    let q = String(raw || '').trim();
    const fenced = /```(?:sql)?\s*([\s\S]*?)```/i.exec(q);
    if (fenced?.[1]) q = fenced[1].trim();
    const first = /(with[\s\S]*$|select[\s\S]*$)/i.exec(q);  // keep a leading WITH…SELECT… too
    if (first) q = first[0].trim();
    return q;
}

function rowsFrom(res) {
    if (Array.isArray(res)) return res;                 // neon tagged-template shape
    if (res && Array.isArray(res.rows)) return res.rows; // .query() shape
    return [];
}

function normalizeSql(q) {
    if (!/^\s*(with\b|select\b)/i.test(q)) throw new Error('not_select');
    if (bannedKw.test(q)) throw new Error('blocked_keyword');
    const parts = q.split(';').filter(s => s.trim().length);
    if (parts.length > 1) throw new Error('multiple_statements');
    if (!/\blimit\s+\d+\b/i.test(q)) q = q.replace(/;?\s*$/,' LIMIT 50');
    const m = q.match(/\blimit\s+(\d+)\b/i);
    if (m && Number(m[1]) > 200) q = q.replace(/\blimit\s+\d+\b/i, 'LIMIT 200');
    return q.trim();
}

/** minimal fetch of the target movie for injection */
async function fetchTarget(mid) {
    const rows = await sql/*sql*/`
        SELECT
            id,
            COALESCE(fr_title, title) AS title,
            title AS vo_title,
            fr_title,
            budget::float8 AS budget,
            runtime::int   AS runtime,
            COALESCE(EXTRACT(YEAR FROM release_date)::int, NULL) AS year,
      release_date
        FROM public.movies
        WHERE id = ${mid}
            LIMIT 1
    `;
    return rows?.[0] || null;
}

/** dedupe rows by id when possible, else by (title, release_date) */
function dedupeRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return rows;
    const byId = new Map();
    const fallback = new Map();
    const out = [];
    for (const r of rows) {
        const id = r?.id ?? r?.movie_id;
        if (id != null) {
            if (byId.has(id)) continue;
            byId.set(id, true);
            out.push(r);
            continue;
        }
        const key = `${(r?.title ?? '').toLowerCase()}|${r?.release_date ?? ''}`;
        if (fallback.has(key)) continue;
        fallback.set(key, true);
        out.push(r);
    }
    return out;
}

/**
 * Build a COUNT wrapper that won't choke on UNIONs or DISTINCT ON ORDER BY.
 * Strategy:
 *  - Split on UNION ALL / UNION.
 *  - Strip inner ORDER BY and LIMIT from each SELECT for the COUNT version.
 *  - Rejoin with UNION/UNION ALL and wrap.
 */
function makeSafeCountQuery(q) {
    const unionRe = /\bunion(?:\s+all)?\b/i;

    // If no UNION at all, just strip trailing ORDER BY / LIMIT once and wrap.
    if (!unionRe.test(q)) {
        const inner = stripTrailingOrderByAndLimit(q);
        return `SELECT COUNT(*)::int AS n FROM (${inner}) _q`;
    }

    // Split preserving the union tokens
    const tokens = q.split(/(\bunion(?:\s+all)?\b)/i);
    const rebuilt = [];
    for (let i = 0; i < tokens.length; i++) {
        const part = tokens[i];
        if (/\bunion(?:\s+all)?\b/i.test(part)) {
            rebuilt.push(part); // keep UNION / UNION ALL
        } else {
            // This is a SELECT chunk; ensure parentheses for safety and strip inner ORDER BY/LIMIT
            const cleaned = stripTrailingOrderByAndLimit(part.trim());
            rebuilt.push(`(${cleaned})`);
        }
    }
    const innerUnion = rebuilt.join(' ');
    return `SELECT COUNT(*)::int AS n FROM (${innerUnion}) _q`;
}

/** Remove a trailing ORDER BY ... [LIMIT ...] safely from a SELECT chunk (does not touch subselects) */
function stripTrailingOrderByAndLimit(selectChunk) {
    // Remove a final LIMIT n
    let s = selectChunk.replace(/\s+limit\s+\d+\s*$/i, '');
    // Remove a trailing ORDER BY ... that sits at the end
    // (greedy but anchored to end to avoid hitting subqueries)
    s = s.replace(/\s+order\s+by\s+[\s\S]*$/i, '');
    return s.trim();
}

export const handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };

    try {
        const { prompt, movieId } = JSON.parse(event.body || '{}');
        if (!prompt) return json(400, { error: 'prompt is required' });
        const mid = Number(movieId) || null;

        // ---- LLM request with guidance to handle fuzzy text + distinct + target
        const sys = [
            `You are a meticulous Postgres analyst. Use ONLY the given schema.`,
            `Return a STRICT JSON object with keys: intent, metric, cohort, sql, visuals, narrative.`,
            `Rules for "sql":`,
            `- SINGLE Postgres SELECT statement only, starting with SELECT. No code fences.`,
            `- ALWAYS include the movie id in the projection as "id" when selecting from movies (e.g., "m.id AS id").`,
            `- When filtering text fields (e.g., genres.name, actors.name, titles), use ILIKE with wildcards, e.g. ILIKE '%term%'.`,
            `- When joining movie_genres or movie_actors, avoid duplicate movies use GROUP BY m.id + aggregates.`,
            `- When comparing to a target movie id, include the target movie row if it would otherwise be omitted.`,
            `- LIMIT <= 10.`,
            SCHEMA
        ].join('\n');

        const user = [
            `User prompt: """${prompt}"""`,
            mid ? `Target movie id: ${mid}` : ''
        ].join('\n');

        const resp = await oa.chat.completions.create({
            model: 'gpt-4o-mini',
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: sys },
                { role: 'user', content:
                        `Example: "Family or Action movies like this one"
- Use ILIKE '%family%' OR ILIKE '%action%' against genres.name
- SELECT DISTINCT m.id AS id, COALESCE(m.fr_title,m.title) AS title, EXTRACT(YEAR FROM m.release_date) AS year, m.budget
- JOIN movie_genres mg ON mg.movie_id = m.id JOIN genres g ON g.id = mg.genre_id` },
                { role: 'assistant', content: JSON.stringify({
                        intent: "compare",
                        metric: "budget",
                        cohort: { matchGenres: true, minActorOverlap: 0 },
                        sql: "SELECT 1 AS id, 'ok' AS title LIMIT 1",
                        visuals:[{type:"bar",x:"title",y:"budget"}],
                        narrative:["placeholder"]
                    }) },
                { role: 'user', content: user }
            ],
            temperature: 0.1
        });

        const raw = resp.choices[0]?.message?.content || '{}';
        console.log('[report] raw LLM content:', raw);

        let spec;
        try { spec = JSON.parse(raw); }
        catch (e) {
            return json(400, { error: 'bad_llm_json', details: e.message, ...(IS_PROD ? {} : { llmRaw: raw }) });
        }

        // ---- pass-through SQL with minimal checks
        let q = extractSelect(spec.sql);
        try { q = normalizeSql(q); } catch (e) {
            return json(400, { error: 'blocked_not_select', message: e.message, ...(IS_PROD ? {} : { llmSpec: spec }) });
        }

        // ---- Same-session settings + DIAGNOSTICS
        await sql/*sql*/`SET statement_timeout = '10000ms'`;
        await sql/*sql*/`SET search_path TO public`;

        try {
            const who = await sql/*sql*/`
        SELECT current_database() AS db,
               current_schema()   AS schema,
               current_user       AS current_user,
               session_user       AS session_user,
               current_setting('search_path') AS search_path
      `;
            console.log('[report] DIAG who:', who?.[0]);
        } catch (e) {
            console.warn('[report] DIAG who failed:', e?.message);
        }

        console.log('[report] EXEC SQL:\n', q);

        // 1) Execute the LLM query and extract candidate IDs (id | movie_id | film_id)
        const baseRes = await sql.query(q);
        const baseRows = rowsFrom(baseRes);
        console.log('[report] LLM rows:', baseRows.length, 'sample:', baseRows[0]);

        // Extract numeric IDs robustly
        const idSet = new Set();
        for (const r of baseRows) {
            const cand = r?.id ?? r?.movie_id ?? r?.film_id ?? null;
            const n = Number(cand);
            if (Number.isFinite(n)) idSet.add(n);
        }

        // Ensure target is included
        if (mid && Number.isFinite(mid)) idSet.add(mid);

        // Early out: no IDs -> empty result (still return query + highlights)
        const ids = Array.from(idSet);
        console.log('[report] candidate IDs:', ids.length, ids.slice(0, 20));
        if (ids.length === 0) {
            return json(200, {
                query: q,
                data: [],
                charts: spec.visuals || [{ type: 'table' }],
                highlights: spec.narrative || [],
                debug: IS_PROD ? undefined : { llmSpec: spec, cohortIdCount: 0 }
            });
        }

        // 2) Canonical projection for the chosen IDs (pass ids as a param array)
                const canonSql = `
          WITH agg AS (
            SELECT
              r.film_id,
              COALESCE(MAX(r.cumulatif_qc_to_date), 0)::float8 AS total_revenue_qc,
              COALESCE(MAX(r.cumulatif_us_to_date), 0)::float8 AS total_revenue_us
            FROM revenues r
            WHERE r.film_id = ANY($1)
            GROUP BY r.film_id
          )
          SELECT
            m.id,
            COALESCE(m.fr_title, m.title)             AS title,
            m.fr_title,
            m.title            AS vo_title,
            EXTRACT(YEAR FROM m.release_date)::int    AS year,
            m.release_date,
            m.budget::float8   AS budget,
            m.runtime::int     AS runtime,
            s.name                                  AS studio_name,
            m.principal_studio_id                   AS studio_id,
            m.poster_path                           AS poster_path,
            a.total_revenue_qc,
            a.total_revenue_us
          FROM movies m
          LEFT JOIN studios s ON s.id = m.principal_studio_id
          LEFT JOIN agg a     ON a.film_id = m.id
          WHERE m.id = ANY($1)
          LIMIT 200
        `;

        const canonRes = await sql.query(canonSql, [ids]); // <-- pass array as a single param
        let rows = rowsFrom(canonRes);


        return json(200, {
            query: q,                   // the LLM cohort SQL we ran
            data: rows,                 // canonical, consistent fields
            charts: spec.visuals || [{ type: 'table' }],
            highlights: spec.narrative || [],
            debug: IS_PROD ? undefined : {
                llmSpec: spec,
                cohortIdCount: ids.length
            }
        });

    } catch (err) {
        console.error('[report] error', err);
        return json(500, { error: 'report_failed', details: String(err?.message || err) });
    }
};

function cors() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };
}
function json(statusCode, body) {
    return { statusCode, headers: { 'Content-Type': 'application/json', ...cors() }, body: JSON.stringify(body) };
}
