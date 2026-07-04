import { readPendingBackfill, clearPendingBackfill } from '../lib/blobs.js';

/**
 * Drains the pending-backfill queue after a CFB token has been refreshed.
 *
 * Runs as a background function (15-min budget) because it must re-ingest each
 * missed day SEQUENTIALLY: every ingest does a read-modify-write on the shared
 * inventory.bsx blob, so parallel days would race and lose decrements. It reuses
 * the existing runIngestNow endpoint (source + date, legacy sheet only) rather
 * than duplicating ingest logic; that endpoint is idempotent (hasSalesEntryForDate
 * short-circuits an already-ingested day), so a re-trigger is safe.
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
                `${base}/api/runIngestNow?source=${p.source}&date=${p.date}&target=old`,
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
