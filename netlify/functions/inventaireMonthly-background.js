import { schedule } from '@netlify/functions';
import { captureInventaire, previousMonthEnd } from '../lib/inventaire.js';
import { readInventaireSnapshots, writeInventaireSnapshot } from '../lib/blobs.js';

/**
 * Month-end inventory capture for Alfred: reads the CFB/UFB batch reports as of the
 * last day of the month that just closed and stores the snapshot served by
 * functions/inventaire.js.
 *
 * Runs on the 1st, 2nd and 3rd: the first successful run stores the snapshot and
 * the next ones skip, so an expired cookie on the 1st (reset that day) still gets
 * the month captured. Any other date can be captured by hand with
 * captureInventaire-background?date=YYYY-MM-DD.
 */

// 09:00 UTC ≈ 05:00 Toronto (EDT) / 04:00 (EST) — before the daily ingest at 10:00.
export const handler = schedule('0 9 1-3 * *', async () => {
    const date = previousMonthEnd();
    try {
        if ((await readInventaireSnapshots())[date]) {
            console.log(`[inventaireMonthly] ${date} already captured — skip`);
            return { statusCode: 200, body: JSON.stringify({ skipped: date }) };
        }
        const snapshot = await captureInventaire({ date });
        await writeInventaireSnapshot(snapshot);
        console.log('[inventaireMonthly] OK', JSON.stringify(snapshot));
        return { statusCode: 200, body: JSON.stringify(snapshot) };
    } catch (e) {
        console.error(`[inventaireMonthly] FAIL ${date}`, e);
        return { statusCode: 500, body: JSON.stringify({ error: e.message, date }) };
    }
});
