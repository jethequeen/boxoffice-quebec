import { sql } from '../lib/db.js';
import { defaultHeaders, jsonResponse } from '../lib/http.js';

/* --------------------- TMDb helpers --------------------- */
async function fetchJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${await r.text()}`);
    return r.json();
}

// Insère/Met à jour le film + TOUS les liens (genres, pays, studios, crew, actors)
async function enrichFromTmdb(movieId) {
    const key = process.env.TMDB_API_KEY;
    if (!key) throw new Error('TMDB_API_KEY missing');

    const [details, credits, images] = await Promise.all([
        fetchJson(`https://api.themoviedb.org/3/movie/${movieId}?api_key=${key}&language=en-US`),
        fetchJson(`https://api.themoviedb.org/3/movie/${movieId}/credits?api_key=${key}`),
        fetchJson(`https://api.themoviedb.org/3/movie/${movieId}/images?api_key=${key}&include_image_language=fr,en,null`),
    ]);

    const choosePoster = (d, imgs) => {
        const posters = (imgs.posters || []).slice();
        const pref = (p) => (p.iso_639_1 === 'fr' ? 3 : p.iso_639_1 === 'en' ? 2 : 1);
        posters.sort((a, b) => (pref(b) - pref(a)) || ((b.vote_count || 0) - (a.vote_count || 0)));
        return posters[0]?.file_path || d.poster_path || null;
    };

    const poster     = choosePoster(details, images);
    const backdrop   = details.backdrop_path ?? null;
    const popularity = details.popularity ?? 0;
    const budget     = (details.budget  && details.budget  > 0) ? details.budget  : null;
    const runtime    = (details.runtime && details.runtime > 0) ? details.runtime : null;
    const release    = details.release_date || null;

    await sql/*sql*/`BEGIN`;
    try {
        await sql/*sql*/`
            INSERT INTO movies (id, title, fr_title, release_date, popularity, poster_path, backdrop_path, budget, runtime)
            VALUES (${movieId}, ${details.title ?? null}, NULL, ${release}, ${popularity}, ${poster}, ${backdrop}, ${budget}, ${runtime})
                ON CONFLICT (id) DO UPDATE
                                        SET title         = COALESCE(movies.title,         EXCLUDED.title),
                                        fr_title      = COALESCE(movies.fr_title,      EXCLUDED.fr_title),
                                        release_date  = COALESCE(movies.release_date,  EXCLUDED.release_date),
                                        poster_path   = COALESCE(movies.poster_path,   EXCLUDED.poster_path),
                                        backdrop_path = COALESCE(movies.backdrop_path, EXCLUDED.backdrop_path),
                                        budget        = CASE WHEN movies.budget  IS NULL OR movies.budget  = 0
                                        THEN COALESCE(EXCLUDED.budget,  movies.budget)  ELSE movies.budget  END,
            runtime       = CASE WHEN movies.runtime IS NULL OR movies.runtime = 0
                                 THEN COALESCE(EXCLUDED.runtime, movies.runtime) ELSE movies.runtime END,
            popularity    = COALESCE(EXCLUDED.popularity, movies.popularity)
        `;

        for (const g of details.genres || []) {
            await sql/*sql*/`INSERT INTO genres (id, name) VALUES (${g.id}, ${g.name}) ON CONFLICT (id) DO NOTHING`;
            await sql/*sql*/`INSERT INTO movie_genres (movie_id, genre_id) VALUES (${movieId}, ${g.id}) ON CONFLICT DO NOTHING`;
        }

        for (const c of details.production_countries || []) {
            await sql/*sql*/`INSERT INTO countries (code, fr_name) VALUES (${c.iso_3166_1}, ${c.name}) ON CONFLICT (code) DO NOTHING`;
            await sql/*sql*/`INSERT INTO movie_countries (movie_id, country_code) VALUES (${movieId}, ${c.iso_3166_1}) ON CONFLICT DO NOTHING`;
        }

        for (const s of details.production_companies || []) {
            await sql/*sql*/`INSERT INTO studios (id, name, popularity) VALUES (${s.id}, ${s.name}, NULL) ON CONFLICT (id) DO NOTHING`;
            await sql/*sql*/`INSERT INTO movie_studio (movie_id, studio_id) VALUES (${movieId}, ${s.id}) ON CONFLICT DO NOTHING`;
        }

        const directors = (credits.crew || []).filter(p => p.job === 'Director');
        for (const d of directors) {
            await sql/*sql*/`
                INSERT INTO crew (id, name, known_for_department, popularity, gender, image_path)
                VALUES (${d.id}, ${d.name}, ${d.known_for_department}, ${d.popularity}, ${d.gender}, ${d.profile_path})
                    ON CONFLICT (id) DO NOTHING
            `;
            await sql/*sql*/`INSERT INTO movie_crew (movie_id, crew_id, job) VALUES (${movieId}, ${d.id}, ${d.job}) ON CONFLICT DO NOTHING`;
        }

        for (const a of (credits.cast || []).slice(0, 9)) {
            await sql/*sql*/`
                INSERT INTO actors (id, name, popularity, gender, profile_path, known_for_department)
                VALUES (${a.id}, ${a.name}, ${a.popularity}, ${a.gender}, ${a.profile_path}, ${a.known_for_department})
                    ON CONFLICT (id) DO NOTHING
            `;
            await sql/*sql*/`INSERT INTO movie_actors (movie_id, actor_id, "order") VALUES (${movieId}, ${a.id}, ${a.order}) ON CONFLICT DO NOTHING`;
        }

        await sql/*sql*/`COMMIT`;
    } catch (e) {
        await sql/*sql*/`ROLLBACK`;
        throw e;
    }
}

/* --------------------- Main handler --------------------- */
export const handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: defaultHeaders };
    if (event.httpMethod !== 'POST')   return jsonResponse(405, { error: 'Method Not Allowed' });

    try {
        const { tempId, newId } = JSON.parse(event.body || '{}');
        const t = Number(tempId), n = Number(newId);

        // 1) validations minimales
        if (!Number.isInteger(t) || !Number.isInteger(n)) {
            return jsonResponse(400, { error: 'tempId and newId must be integers' });
        }
        // newId doit être un ID TMDb plausible
        if (!(n > 0 && n < 10_000_000)) {
            return jsonResponse(400, {
                error: 'Bad ID roles',
                hint: 'newId = ID TMDb (< 10000000). tempId peut être n’importe quel entier ≠ newId.',
                got: { tempId: t, newId: n },
            });
        }

        const [{ old_title, old_fr_title } = {}] = await sql/*sql*/`
      SELECT title AS old_title, fr_title AS old_fr_title
      FROM movies
      WHERE id = ${t}
      LIMIT 1
    `;

        // 2) s’assurer que newId existe (idempotent)
        await sql/*sql*/`INSERT INTO movies (id) VALUES (${n}) ON CONFLICT (id) DO NOTHING`;

        // --- Étape 1: RESET temp’s wrong attachments, KEEP facts (revenues, showings), then drop temp
        await sql/*sql*/`BEGIN`;
        try {
            const [{ exists: tempExists } = { exists: false }] = await sql/*sql*/`
    SELECT EXISTS(SELECT 1 FROM movies WHERE id = ${t}) AS exists
  `;
            if (!tempExists) {
                await sql/*sql*/`ROLLBACK`;
                return jsonResponse(404, { error: `Temp movie ${t} not found` });
            }

            // lock both ids (single statement)
            await sql/*sql*/`SELECT id FROM movies WHERE id IN (${t}, ${n}) FOR UPDATE`;

            // 1) Wipe attachments on the temp movie — ONE STATEMENT PER CALL
            await sql/*sql*/`DELETE FROM movie_genres    WHERE movie_id = ${t}`;
            await sql/*sql*/`DELETE FROM movie_countries WHERE movie_id = ${t}`;
            await sql/*sql*/`DELETE FROM movie_studio    WHERE movie_id = ${t}`;
            await sql/*sql*/`DELETE FROM movie_crew      WHERE movie_id = ${t}`;
            await sql/*sql*/`DELETE FROM movie_actors    WHERE movie_id = ${t}`;
            await sql/*sql*/`DELETE FROM daily_revenues  WHERE film_id  = ${t}`;

            // 2) Keep facts: move to the new ID — also split
            await sql/*sql*/`UPDATE revenues SET film_id = ${n} WHERE film_id = ${t}`;
            await sql/*sql*/`UPDATE showings  SET movie_id = ${n} WHERE movie_id = ${t}`;

            // 3) Drop temp parent
            await sql/*sql*/`DELETE FROM movies WHERE id = ${t}`;

            await sql/*sql*/`COMMIT`;
        } catch (e) {
            await sql/*sql*/`ROLLBACK`;
            throw e;
        }

        // 4) enrichissement TMDb du newId puis backfill fr_title
        await enrichFromTmdb(n);
        await sql/*sql*/`
            UPDATE movies
            SET fr_title = COALESCE(fr_title, ${old_fr_title ?? null}, ${old_title ?? null})
            WHERE id = ${n}
        `;

        return jsonResponse(200, { ok: true, newId: n, redirect: `/movie/${n}` });
    } catch (err) {
        // expose plus d’infos en dev
        console.error('correctMovieId error:', err);
        return jsonResponse(500, {
            error: 'Failed to correct movie id',
            details: err?.detail || err?.message || String(err),
            constraint: err?.constraint,
            code: err?.code,
            function: 'correctMovieId',
            timestamp: new Date().toISOString(),
        });
    }
};
