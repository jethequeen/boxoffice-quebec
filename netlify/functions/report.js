// netlify/functions/report.js
import OpenAI from 'openai';
import { sql } from '../lib/db.js';

const oa = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const IS_PROD = process.env.NODE_ENV === 'production';

/* Light schema hint for the model (no tight policing) */
const SCHEMA = `
tables:
  movies(id int, title text, fr_title text, release_date date, budget numeric, runtime int,
         cumulatif_qc bigint, cumulatif_us bigint, principal_studio_id int, poster_path text)
  genres(id int, name text)
  movie_genres(movie_id int, genre_id int)
  actors(id int, name text, gender text, popularity real, profile_path text)
  movie_actors(movie_id int, actor_id int, "order" int)
notes:
  - budgets/revenues can be NULL.
  - year can be derived from release_date.
  - keep results compact.
`;

const bannedKw = /\b(insert|update|delete|drop|alter|grant|revoke|call|copy|truncate|create|comment)\b/i;

/* ---------- helpers (minimal) ---------- */
function extractSelect(raw) {
    let q = String(raw || '').trim();
    const fenced = /```(?:sql)?\s*([\s\S]*?)```/i.exec(q);
    if (fenced?.[1]) q = fenced[1].trim();
    const first = /select[\s\S]*$/i.exec(q);
    if (first) q = first[0].trim();
    return q;
}

function rowsFrom(res) {
    if (Array.isArray(res)) return res;           // tagged template shape
    if (res && Array.isArray(res.rows)) return res.rows; // query() shape
    return [];
}

function normalizeSql(q) {
    if (!/^\s*select\b/i.test(q)) throw new Error('not_select');
    if (bannedKw.test(q)) throw new Error('blocked_keyword');

    // no multiple statements
    const parts = q.split(';').filter(s => s.trim().length);
    if (parts.length > 1) throw new Error('multiple_statements');

    // enforce LIMIT ≤ 200 (default LIMIT 50 if none)
    if (!/\blimit\s+\d+\b/i.test(q)) q = q.replace(/;?\s*$/,' LIMIT 50');
    const m = q.match(/\blimit\s+(\d+)\b/i);
    if (m && Number(m[1]) > 200) q = q.replace(/\blimit\s+\d+\b/i, 'LIMIT 200');

    return q.trim();
}

export const handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };

    try {
        const { prompt, movieId } = JSON.parse(event.body || '{}');
        if (!prompt) return json(400, { error: 'prompt is required' });
        const mid = Number(movieId) || null;

        // ---- LLM request (simple) ----
        const sys = [
            `You are a meticulous Postgres analyst. Use ONLY the given schema.`,
            `Return a STRICT JSON object with keys: intent, metric, cohort, sql, visuals, narrative.`,
            `Rules for "sql":`,
            `- It MUST be a SINGLE Postgres SELECT statement.`,
            `- It MUST start with SELECT (no backticks, no code fences, no explanation).`,
            `- No DDL/DML/COPY.`,
            `- LIMIT <= 200.`,
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
                        `Example: "Compare this movie by budget vs similar films (same genres, ≥2 top-billed actors overlap)."
Return JSON. The "sql" field MUST start with SELECT and be a single statement. No code fences.` },
                { role: 'assistant', content: JSON.stringify({
                        intent: "compare",
                        metric: "budget",
                        cohort: { matchGenres: true, minActorOverlap: 2 },
                        sql: "SELECT 1 AS ok LIMIT 1",
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

        // Session/role/schema/paths
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

        // Table counts (quick sanity)
        try {
            const c1 = await sql/*sql*/`SELECT COUNT(*)::int AS n FROM public.movies`;
            const c2 = await sql/*sql*/`SELECT COUNT(*)::int AS n FROM public.movie_genres`;
            const c3 = await sql/*sql*/`SELECT COUNT(*)::int AS n FROM public.actors`;
            console.log('[report] DIAG counts:', {
                movies: c1?.[0]?.n,
                movie_genres: c2?.[0]?.n,
                actors: c3?.[0]?.n,
            });
        } catch (e) {
            console.warn('[report] DIAG counts failed:', e?.message);
        }

        if (mid) {
            try {
                const tgt = await sql/*sql*/`SELECT EXISTS(SELECT 1 FROM public.movies WHERE id = ${mid}) AS target_exists`;
                const tg  = await sql/*sql*/`SELECT COUNT(*)::int AS g FROM public.movie_genres WHERE movie_id = ${mid}`;
                console.log('[report] DIAG target:', tgt?.[0]);
                console.log('[report] DIAG target genres:', tg?.[0]);
            } catch (e) {
                console.warn('[report] DIAG target failed:', e?.message);
            }
        }

        console.log('[report] EXEC SQL:\n', q);

        // Count in THIS session (diagnostic only)
        let rowCount = 0;
        const countQuery = `SELECT COUNT(*)::int AS n FROM (${q}) _q`;
        try {
            console.log('[report] COUNT SQL:\n', countQuery);
            const cnt = await sql.query(`SELECT COUNT(*)::int AS n FROM (${q}) _q`);
            rowCount = Array.isArray(cnt) ? (cnt[0]?.n ?? 0) : (cnt?.rows?.[0]?.n ?? 0);
            console.log('[report] COUNT result:', rowCount);
        } catch (e) {
            console.warn('[report] COUNT failed:', e?.message);
        }

        // Execute the exact query — no fallbacks, no target injection
        console.log('[report] EXEC SQL:\n', q);
        const execRes = await sql.query(q);
        const rows = rowsFrom(execRes);
        console.log('[report] RESULT isArray:', Array.isArray(execRes), 'rows.length:', rows.length, 'sample:', rows[0]);


        return json(200, {
            query: q,                      // exact SQL executed
            data: rows,                    // exact rows returned
            charts: spec.visuals || [{ type: 'table' }],
            highlights: spec.narrative || [],
            debug: IS_PROD ? undefined : {
                llmSpec: spec,
                rowCount,
                // echo the countQuery for copy/paste
                countQuery
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
