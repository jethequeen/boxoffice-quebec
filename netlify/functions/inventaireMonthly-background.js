import { schedule } from '@netlify/functions';
import { captureInventaire, previousMonthEnd, isFinal } from '../lib/inventaire.js';
import { readInventaireSnapshots, writeInventaireSnapshot } from '../lib/blobs.js';

/**
 * Month-end inventory capture for Alfred: reads the CFB/UFB batch reports as of the
 * last day of the month that just closed and stores the snapshot served by
 * functions/inventaire.js.
 *
 * The portal can't rewind quantities (see lib/inventaire.js), so this read IS the
 * month-end value: it runs early on the 1st. It retries on the 2nd and 3rd when the
 * 1st failed (expired cookie), at the cost of a day or two of sales. A provisional
 * snapshot taken on the last day itself is replaced, not kept.
 */

// 09:00 UTC ≈ 05:00 Toronto (EDT) / 04:00 (EST) — before the daily ingest at 10:00.
export const handler = schedule('0 9 1-3 * *', async () => {
    const date = previousMonthEnd();
    try {
        if (isFinal((await readInventaireSnapshots())[date])) {
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
