import { runInvoices } from '../lib/invoiceRun.js';
import { previousMonthYm, monthRange } from '../lib/invoice.js';
import { jsonResponse } from '../lib/http.js';

const todayInTZ = (tz = 'America/Toronto') => {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    return fmt.format(new Date());
};

// Reuses the INGEST_TOKEN bearer scheme from runIngestNow.js — one operator secret.
const auth = (event) => {
    const expected = process.env.INGEST_TOKEN;
    if (!expected) return true;
    const got = event.headers?.authorization || event.headers?.Authorization || '';
    return got === `Bearer ${expected}`;
};

const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * On-demand invoice generation / resend for an arbitrary date range.
 *
 * Query params (pick ONE way to set the period; defaults to the previous month):
 *   start=YYYY-MM-DD & end=YYYY-MM-DD   explicit inclusive range
 *   ym=YYYY-MM                          whole calendar month
 *   (neither)                           the month before issueDate
 *
 *   issueDate=YYYY-MM-DD   invoice date, drives the USD→CAD rate (default: today in Toronto)
 *   to=email               recipient override (default: INVOICE_EMAIL_TO)
 *   dryRun=1               compute + render PDFs but do not email
 *   data=live|history      source the sales live from the CFB reports (default) or
 *                          from the accumulated sales-history blob
 *   spread=0.01            UFB conversion-fee spread as a fraction (0.01 = 1%, the %
 *                          Manon provides). Default: config FX_SPREAD.
 */
export const handler = async (event) => {
    if (!auth(event)) return jsonResponse(401, { error: 'unauthorized' });

    const qs = event.queryStringParameters || {};
    const issueDate = qs.issueDate || todayInTZ();
    const dryRun = qs.dryRun === '1';
    const to = qs.to || undefined;
    const dataSource = qs.data === 'history' ? 'history' : 'live';
    // Conversion-fee spread as a fraction (0.01 = 1%) — the % Manon provides for UFB.
    const spread = qs.spread != null && qs.spread !== '' ? Number(qs.spread) : undefined;

    if (spread != null && !(spread >= 0 && spread < 1)) {
        return jsonResponse(400, { error: `Invalid spread "${qs.spread}" — expected a fraction between 0 and 1 (e.g. 0.01 for 1%)` });
    }

    // Which invoices to produce (default both). e.g. ?kinds=UFB after Manon's %.
    let kinds = ['CFB', 'UFB'];
    if (qs.kinds) {
        kinds = qs.kinds.split(',').map((k) => k.trim().toUpperCase()).filter(Boolean);
        const bad = kinds.filter((k) => k !== 'CFB' && k !== 'UFB');
        if (bad.length) return jsonResponse(400, { error: `Unknown kind(s): ${bad.join(', ')} — expected CFB, UFB, or CFB,UFB` });
    }

    if (!isYmd(issueDate)) return jsonResponse(400, { error: `Invalid issueDate "${issueDate}" — expected YYYY-MM-DD` });

    // Resolve the [start, end] range from the params.
    let start;
    let end;
    if (qs.start || qs.end) {
        start = qs.start;
        end = qs.end;
        if (!isYmd(start) || !isYmd(end)) return jsonResponse(400, { error: 'start and end must both be YYYY-MM-DD' });
        if (start > end) return jsonResponse(400, { error: `start ${start} is after end ${end}` });
    } else {
        const ym = qs.ym || previousMonthYm(issueDate);
        if (!/^\d{4}-\d{2}$/.test(ym)) return jsonResponse(400, { error: `Invalid ym "${ym}" — expected YYYY-MM` });
        ({ start, end } = monthRange(ym));
    }

    try {
        const log = await runInvoices({ start, end, issueDate, to, dryRun, dataSource, spread, kinds });
        return jsonResponse(200, log);
    } catch (e) {
        console.error('[runInvoiceNow] FAIL', e);
        return jsonResponse(500, { error: e.message, start, end, issueDate, dataSource });
    }
};
