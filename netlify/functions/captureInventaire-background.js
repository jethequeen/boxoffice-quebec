import { captureInventaire, isFinal, torontoYmd } from '../lib/inventaire.js';
import { readInventaireSnapshots, writeInventaireSnapshot } from '../lib/blobs.js';

const auth = (event) => {
    const expected = process.env.INGEST_TOKEN;
    if (!expected) return true;
    const got = event.headers?.authorization || event.headers?.Authorization || '';
    return got === `Bearer ${expected}`;
};

const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Capture the inventory snapshot by hand — e.g. when the scheduled month-end run
 * failed on the 1st–3rd. Background function: answers 202 at once; the result lands
 * in the logs and the snapshot store.
 *
 * The portal only reports CURRENT quantities (see lib/inventaire.js), so only today
 * or yesterday can be captured: an older date would store today's stock under it.
 *
 * Query params:
 *   date=YYYY-MM-DD   as-of date, today or yesterday (default: yesterday)
 *   force=1           overwrite a final snapshot for that date
 */
export const handler = async (event) => {
    if (!auth(event)) {
        console.warn('[captureInventaire] unauthorized');
        return;
    }
    const qs = event.queryStringParameters || {};
    const date = qs.date || torontoYmd(-1);
    if (!isYmd(date) || date < torontoYmd(-1) || date > torontoYmd()) {
        console.error(`[captureInventaire] refused date "${date}" — only today or yesterday can be read`);
        return;
    }
    try {
        if (qs.force !== '1' && isFinal((await readInventaireSnapshots())[date])) {
            console.log(`[captureInventaire] ${date} already final — pass force=1 to overwrite`);
            return;
        }
        const snapshot = await captureInventaire({ date });
        await writeInventaireSnapshot(snapshot);
        console.log('[captureInventaire] OK', JSON.stringify(snapshot));
    } catch (e) {
        console.error(`[captureInventaire] FAIL ${date}`, e);
    }
};
