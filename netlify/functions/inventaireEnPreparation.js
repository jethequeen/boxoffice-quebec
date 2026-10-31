import { writeEnPreparation } from '../lib/blobs.js';
import { torontoIso, torontoYmd } from '../lib/inventaire.js';
import { jsonResponse } from '../lib/http.js';

/**
 * Receives MLJQ's stock "en préparation" (bought, sorted, packed, not yet entered by
 * CFB) from the MLJQ laptop, the only place that can value it. Added to MLJQ's
 * total by functions/inventaire.js.
 *
 *   POST /api/inventaireEnPreparation
 *   Authorization: Bearer <INGEST_TOKEN>
 *   { "value": 1234.56, "pieces": 5000, "date": "2026-10-31" }
 *
 * `value` is CAD; `date` is the as-of date it stands for (default today, Toronto) —
 * the month-end run sends the last day of the closed month. Unlike the other
 * INGEST_TOKEN tools this one changes an accounting figure, so it refuses every
 * request when the token is unset.
 */

const auth = (event) => {
    const expected = process.env.INGEST_TOKEN;
    if (!expected) return false;
    const got = event.headers?.authorization || event.headers?.Authorization || '';
    return got === `Bearer ${expected}`;
};

const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export const handler = async (event) => {
    if (!auth(event)) return jsonResponse(401, { error: 'unauthorized' });
    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'POST required' });

    let body;
    try {
        body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '{}');
    } catch {
        return jsonResponse(400, { error: 'Body must be JSON' });
    }

    const value = Number(body.value);
    const pieces = body.pieces == null ? null : Number(body.pieces);
    const date = body.date || torontoYmd();
    if (!Number.isFinite(value) || value < 0) return jsonResponse(400, { error: '"value" must be a number ≥ 0 (CAD)' });
    if (pieces != null && !Number.isFinite(pieces)) return jsonResponse(400, { error: '"pieces" must be a number' });
    if (!isYmd(date)) return jsonResponse(400, { error: `Invalid date "${date}" — expected YYYY-MM-DD` });

    try {
        const entry = { date, value: Math.round(value * 100) / 100, pieces, au: torontoIso() };
        await writeEnPreparation(entry);
        return jsonResponse(200, { ok: true, entry });
    } catch (e) {
        console.error('[inventaireEnPreparation]', e);
        return jsonResponse(500, { error: e.message });
    }
};
