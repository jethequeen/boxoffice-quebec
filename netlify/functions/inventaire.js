import { createHash, timingSafeEqual } from 'node:crypto';
import { readInventaireSnapshots, readEnPreparation } from '../lib/blobs.js';
import { toAlfred } from '../lib/inventaire.js';
import { jsonResponse } from '../lib/http.js';

/**
 * Read-only month-end inventory value for Alfred (the bookkeeping agent), which fills
 * the Binobrick / MLJQ inventory columns of "Résultats mensuels".
 *
 *   GET /.netlify/functions/inventaire[?date=YYYY-MM-DD]
 *   X-Alfred-Secret: <ALFRED_SECRET>
 *
 * Serves stored snapshots only (a live read takes ~10 s, too slow for a synchronous
 * function): no date → the latest snapshot; a date → that snapshot, or 404 if it was
 * never captured (capture it with captureInventaire-background?date=…). The secret
 * is mandatory — if ALFRED_SECRET is unset, every request is refused.
 */

const digest = (s) => createHash('sha256').update(String(s)).digest();

const authorized = (event) => {
    const expected = process.env.ALFRED_SECRET;
    const got = event.headers?.['x-alfred-secret'] || event.headers?.['X-Alfred-Secret'] || '';
    const ok = Boolean(expected) && timingSafeEqual(digest(got), digest(expected));
    // Presence flags only, never the values — enough to tell a missing variable
    // (redeploy needed) from a stripped header or a wrong secret.
    if (!ok) console.warn('[inventaire] 401', { secretConfigured: Boolean(expected), headerPresent: Boolean(got), gotLength: got.length });
    return ok;
};

const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export const handler = async (event) => {
    if (!authorized(event)) return jsonResponse(401, { error: 'unauthorized' });
    if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'GET required' });

    const date = event.queryStringParameters?.date;
    if (date && !isYmd(date)) return jsonResponse(400, { error: `Invalid date "${date}" — expected YYYY-MM-DD` });

    try {
        const [snapshots, enPreparation] = await Promise.all([readInventaireSnapshots(), readEnPreparation()]);
        const dates = Object.keys(snapshots).sort();
        if (!dates.length) return jsonResponse(503, { error: 'No inventory snapshot captured yet' });

        const key = date || dates[dates.length - 1];
        const snapshot = snapshots[key];
        if (!snapshot) return jsonResponse(404, { error: `No snapshot for ${key}`, latest: dates[dates.length - 1] });

        const res = jsonResponse(200, toAlfred(snapshot, enPreparation));
        res.headers = { ...res.headers, 'Cache-Control': 'no-store' };
        return res;
    } catch (e) {
        console.error('[inventaire]', e);
        return jsonResponse(500, { error: e.message });
    }
};
