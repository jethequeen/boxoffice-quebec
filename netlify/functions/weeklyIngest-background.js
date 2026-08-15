import { schedule } from '@netlify/functions';
import { runWeek, fridayOfWeek, shiftYmd } from '../lib/weekly.js';

/**
 * Weekly streamlined-sheet aggregate for the "Journal officiel" sheet.
 *
 * The daily job (dailyIngest-background.js) keeps posting one row per day to the
 * LEGACY sheet and owns all inventory/sales-history side effects. The streamlined
 * sheet instead receives ONE entry per source per week (see netlify/lib/weekly.js
 * for the aggregation + tax-included Montant logic).
 *
 * This job runs Saturday morning, after Friday has fully settled on CFB. To replay
 * a missed week by hand, use runWeeklyNow.js.
 */

const todayInTZ = (tz = 'America/Toronto') => {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    return fmt.format(new Date());
};

// 10:30 UTC Saturday ≈ 06:30 Toronto — just after the daily job's 10:00 run that
// ingests Friday, so the whole Mon→Fri week is settled on CFB. Netlify crons are UTC;
// cron weekday 6 = Saturday.
export const handler = schedule('30 10 * * 6', async () => {
    try {
        const friday = fridayOfWeek(shiftYmd(todayInTZ(), -1));  // yesterday's week-ending Friday
        const log = await runWeek({ friday });
        console.log('[weeklyIngest] OK', JSON.stringify(log));
        return { statusCode: 200, body: JSON.stringify(log) };
    } catch (e) {
        console.error('[weeklyIngest] FAIL', e);
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
});
