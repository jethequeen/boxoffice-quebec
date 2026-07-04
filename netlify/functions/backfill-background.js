import { readPendingBackfill, clearPendingBackfill } from '../lib/blobs.js';

/**
 * Drains the pending-backfill queue after a CFB token has been refreshed.
 *
 * Runs as a background function (15-min budget) because it must re-ingest each
 * missed day SEQUENTIALLY: every ingest does a read-modify-write on the shared
 * inventory.bsx blob, so parallel days would race and lose decrements. It reuses
 * the existing runIngestNow endpoint (source + date, legacy sheet only) rather
 * than duplicating ingest logic.
 *
 * It passes replace=1: a queued day was usually already recorded as a false zero
 * (by an ingest that ran while the token was expired), so a plain re-ingest would
 * hit the idempotency check and skip it, leaving the zero in place. replace=1 drops
 * that false-zero entry and re-ingests the real numbers. It stays safe otherwise —
 * replace refuses to overwrite an entry that decremented inventory, and a day with
 * no entry re-ingests normally.
 *
 * Triggered by cfbToken.js on a successful token submit, optionally filtered to
 * the source that was just fixed (?source=CA). Gated by INGEST_TOKEN when set.
 */

const auth = (event) => {
    const expected = process.env.INGEST_TOKEN;
    if (!expected) return true;
    const got = event.headers?.authorization || event.headers?.Authorization || '';
    return got === `Bearer ${expected}`;
};

export const handler = async (event) => {
    if (!auth(event)) return { statusCode: 401, body: 'unauthorized' };

    const source = event.queryStringParameters?.source || null;
    const pending = (await readPendingBackfill()).filter((p) => !source || p.source === source);

    const base = (process.env.URL || 'https://boxofficequebec.netlify.app').replace(/\/$/, '');
    const authHeader = process.env.INGEST_TOKEN ? { Authorization: `Bearer ${process.env.INGEST_TOKEN}` } : {};

    const done = [];
    const failed = [];
    for (const p of pending) {
        try {
            const res = await fetch(
                `${base}/api/runIngestNow?source=${p.source}&date=${p.date}&target=old&replace=1`,
                { method: 'POST', headers: authHeader },
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            done.push(p);
        } catch (e) {
            failed.push({ ...p, error: e.message });
            console.error(`[backfill:${p.date}:${p.source}] FAIL`, e);
        }
    }

    if (done.length) await clearPendingBackfill(done);
    const summary = { source: source || 'all', attempted: pending.length, done: done.length, failed };
    console.log('[backfill] done', JSON.stringify(summary));
    return { statusCode: 200, body: JSON.stringify(summary) };
};
