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
        // Upsert du film (sans écraser tes valeurs si elles existent déjà)
        await sql/*sql*/`
            INSERT INTO movies (id, title, fr_title, release_date, popularity, poster_path, backdrop_path, budget, runtime)
            VALUES (${movieId}, ${details.title ?? null}, NULL, ${release}, ${popularity}, ${poster}, ${backdrop}, ${budget}, ${runtime})
                ON CONFLICT (id) DO UPDATE
                                        SET
                                            title         = COALESCE(movies.title,         EXCLUDED.title),
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

        // Genres + liens
        for (const g of details.genres || []) {
            await sql/*sql*/`
                INSERT INTO genres (id, name) VALUES (${g.id}, ${g.name})
                    ON CONFLICT (id) DO NOTHING
            `;
            await sql/*sql*/`
                INSERT INTO movie_genres (movie_id, genre_id)
                VALUES (${movieId}, ${g.id})
                    ON CONFLICT DO NOTHING
            `;
        }

        // Pays + liens
        for (const c of details.production_countries || []) {
            await sql/*sql*/`
                INSERT INTO countries (code, fr_name) VALUES (${c.iso_3166_1}, ${c.name})
                    ON CONFLICT (code) DO NOTHING
            `;
            await sql/*sql*/`
                INSERT INTO movie_countries (movie_id, country_code)
                VALUES (${movieId}, ${c.iso_3166_1})
                    ON CONFLICT DO NOTHING
            `;
        }

        // Studios + liens
        for (const s of details.production_companies || []) {
            await sql/*sql*/`
                INSERT INTO studios (id, name, popularity)
                VALUES (${s.id}, ${s.name}, NULL)
                    ON CONFLICT (id) DO NOTHING
            `;
            await sql/*sql*/`
                INSERT INTO movie_studio (movie_id, studio_id)
                VALUES (${movieId}, ${s.id})
                    ON CONFLICT DO NOTHING
            `;
        }

        // Réals
        const directors = (credits.crew || []).filter(p => p.job === 'Director');
        for (const d of directors) {
            await sql/*sql*/`
                INSERT INTO crew (id, name, known_for_department, popularity, gender, image_path)
                VALUES (${d.id}, ${d.name}, ${d.known_for_department}, ${d.popularity}, ${d.gender}, ${d.profile_path})
                    ON CONFLICT (id) DO NOTHING
            `;
            await sql/*sql*/`
                INSERT INTO movie_crew (movie_id, crew_id, job)
                VALUES (${movieId}, ${d.id}, ${d.job})
                    ON CONFLICT DO NOTHING
            `;
        }

        // Acteurs (top 9)
        for (const a of (credits.cast || []).slice(0, 9)) {
            await sql/*sql*/`
                INSERT INTO actors (id, name, popularity, gender, profile_path, known_for_department)
                VALUES (${a.id}, ${a.name}, ${a.popularity}, ${a.gender}, ${a.profile_path}, ${a.known_for_department})
                    ON CONFLICT (id) DO NOTHING
            `;
            await sql/*sql*/`
                INSERT INTO movie_actors (movie_id, actor_id, "order")
                VALUES (${movieId}, ${a.id}, ${a.order})
                    ON CONFLICT DO NOTHING
            `;
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
        const [{ old_title, old_fr_title } = {}] = await sql/*sql*/`
          SELECT title AS old_title, fr_title AS old_fr_title
          FROM movies
          WHERE id = ${t}
          LIMIT 1
        `;

        if (!Number.isInteger(t) || !Number.isInteger(n))
            return jsonResponse(400, { error: 'tempId and newId must be integers' });
        if (t === n)
            return jsonResponse(400, { error: 'tempId and newId must be different' });

        // Garde-fou : tempId doit être un ID temporaire, newId un ID TMDb plausible
        if (!(t >= 10_000_000) || !(n > 0 && n < 10_000_000)) {
            return jsonResponse(400, {
                error: 'Bad ID roles',
                hint: 'tempId >= 10000000 (temporaire). newId = ID TMDb (< 10000000).',
                got: { tempId: t, newId: n },
            });
        }

        // --- Étape 0: garantir que la ligne parent (newId) existe AVANT les FKs
        await sql/*sql*/`
            INSERT INTO movies (id) VALUES (${n})
                ON CONFLICT (id) DO NOTHING
        `;

        // --- Étape 1: migration FK + bascule de la PK
        await sql/*sql*/`BEGIN`;
        try {
            // Sanity: temp doit exister
            const [{ exists: tempExists } = { exists: false }] = await sql/*sql*/`
        SELECT EXISTS(SELECT 1 FROM movies WHERE id = ${t}) AS exists
      `;
            if (!tempExists) {
                await sql/*sql*/`ROLLBACK`;
                return jsonResponse(404, { error: `Temp movie ${t} not found` });
            }

            // Enfants → newId (le parent newId existe déjà)
            await sql/*sql*/`UPDATE movie_genres     SET movie_id = ${n} WHERE movie_id = ${t};`;
            await sql/*sql*/`UPDATE movie_countries  SET movie_id = ${n} WHERE movie_id = ${t};`;
            await sql/*sql*/`UPDATE movie_studio     SET movie_id = ${n} WHERE movie_id = ${t};`;
            await sql/*sql*/`UPDATE movie_crew       SET movie_id = ${n} WHERE movie_id = ${t};`;
            await sql/*sql*/`UPDATE movie_actors     SET movie_id = ${n} WHERE movie_id = ${t};`;

            await sql/*sql*/`UPDATE revenues         SET film_id = ${n} WHERE film_id = ${t};`;
            await sql/*sql*/`UPDATE daily_revenues   SET film_id = ${n} WHERE film_id = ${t};`;
            await sql/*sql*/`UPDATE showings         SET movie_id = ${n} WHERE movie_id = ${t};`;

            // Supprimer la ligne temporaire (elle n’est plus référencée)
            await sql/*sql*/`DELETE FROM movies WHERE id = ${t};`;

            await sql/*sql*/`COMMIT`;
        } catch (e) {
            await sql/*sql*/`ROLLBACK`;
            throw e;
        }

        // --- Étape 2: enrichissement TMDb (film + liens)
        await enrichFromTmdb(n);
        await sql/*sql*/`
          UPDATE movies
             SET fr_title = COALESCE(fr_title, ${old_fr_title ?? null}, ${old_title ?? null})
           WHERE id = ${n}
        `;

        return jsonResponse(200, { ok: true, newId: n, redirect: `/movie/${n}` });
    } catch (err) {
        console.error('correctMovieId error:', err);
        return jsonResponse(500, {
            error: 'Failed to correct movie id',
            details: err.message,
            function: 'correctMovieId',
            timestamp: new Date().toISOString(),
        });
    }
};
