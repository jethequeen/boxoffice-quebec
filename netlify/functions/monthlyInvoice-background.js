import { schedule } from '@netlify/functions';
import { runMonthlyInvoices } from '../lib/invoiceRun.js';
import { previousMonthYm } from '../lib/invoice.js';

const todayInTZ = (tz = 'America/Toronto') => {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    return fmt.format(new Date());
};

async function run() {
    const issueDate = todayInTZ();          // the 1st, when the cron fires
    const ym = previousMonthYm(issueDate);  // invoice the month that just closed
    // CFB only: it needs no external input. The UFB invoice waits for Manon's
    // conversion % and is generated manually (UI / runInvoiceNow).
    return runMonthlyInvoices({ ym, issueDate, kinds: ['CFB'] });
}

// 12:00 UTC on the 1st of each month ≈ 08:00 Toronto (EDT) — the previous month is
// fully closed on CFB by then. Netlify crons are UTC.
export const handler = schedule('0 12 1 * *', async () => {
    try {
        const log = await run();
        console.log('[monthlyInvoice] OK', JSON.stringify(log));
        return { statusCode: 200, body: JSON.stringify(log) };
    } catch (e) {
        console.error('[monthlyInvoice] FAIL', e);
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
});
