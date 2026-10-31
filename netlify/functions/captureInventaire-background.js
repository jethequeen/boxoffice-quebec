import { captureInventaire, previousMonthEnd } from '../lib/inventaire.js';
import { readInventaireSnapshots, writeInventaireSnapshot } from '../lib/blobs.js';

const auth = (event) => {
    const expected = process.env.INGEST_TOKEN;
    if (!expected) return true;
    const got = event.headers?.authorization || event.headers?.Authorization || '';
    return got === `Bearer ${expected}`;
};

const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Capture the inventory snapshot for any as-of date by hand — e.g. a month the
 * scheduled inventaireMonthly-background run missed. Background function: answers
 * 202 at once; the result lands in the logs and the snapshot store.
 *
 * Query params:
 *   date=YYYY-MM-DD   as-of date (default: last day of the previous month)
 *   force=1           overwrite an existing snapshot for that date
 */
export const handler = async (event) => {
    if (!auth(event)) {
        console.warn('[captureInventaire] unauthorized');
        return;
    }
    const qs = event.queryStringParameters || {};
    const date = qs.date || previousMonthEnd();
    if (!isYmd(date)) {
        console.error(`[captureInventaire] invalid date "${date}"`);
        return;
    }
    try {
        if (qs.force !== '1' && (await readInventaireSnapshots())[date]) {
            console.log(`[captureInventaire] ${date} already captured — pass force=1 to overwrite`);
            return;
        }
        const snapshot = await captureInventaire({ date });
        await writeInventaireSnapshot(snapshot);
        console.log('[captureInventaire] OK', JSON.stringify(snapshot));
    } catch (e) {
        console.error(`[captureInventaire] FAIL ${date}`, e);
    }
};
