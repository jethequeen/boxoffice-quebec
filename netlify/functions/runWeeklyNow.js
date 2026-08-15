import { runWeek, fridayOfWeek } from '../lib/weekly.js';
import { jsonResponse } from '../lib/http.js';

const todayInTZ = (tz = 'America/Toronto') => {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    return fmt.format(new Date());
};

const auth = (event) => {
    const expected = process.env.INGEST_TOKEN;
    if (!expected) return true;
    const got = event.headers?.authorization || event.headers?.Authorization || '';
    return got === `Bearer ${expected}`;
};

const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Replay the weekly streamlined-sheet aggregate for a given week — for a week the
 * Saturday cron missed (e.g. a token expiry). Reuses the INGEST_TOKEN bearer scheme.
 *
 * Query params:
 *   friday=YYYY-MM-DD | date=YYYY-MM-DD   any day in the target week (snapped to its
 *                                         Mon→Fri week-ending Friday). Default: last week.
 *   dryRun=1                              compute + return what would be posted, no POST.
 */
export const handler = async (event) => {
    if (!auth(event)) return jsonResponse(401, { error: 'unauthorized' });

    const qs = event.queryStringParameters || {};
    const dryRun = qs.dryRun === '1';
    const anchor = qs.friday || qs.date;
    if (anchor && !isYmd(anchor)) {
        return jsonResponse(400, { error: `Invalid date "${anchor}" — expected YYYY-MM-DD` });
    }
    // Default: the week ending on last Friday (same as the Saturday cron).
    const friday = fridayOfWeek(anchor || todayInTZ());

    try {
        const log = await runWeek({ friday, dryRun });
        return jsonResponse(200, log);
    } catch (e) {
        console.error('[runWeeklyNow] FAIL', e);
        return jsonResponse(500, { error: e.message, friday });
    }
};
