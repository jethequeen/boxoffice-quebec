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
const num = (v) => (v != null && v !== '' ? Number(v) : undefined);

/**
 * On-demand invoice generation. The amounts are entered from the report emails
 * (the "Total payout for the month"); Manon's final USD→CAD rate is entered for UFB.
 *
 * Period (default: previous month): start&end=YYYY-MM-DD | ym=YYYY-MM.
 * Common params: issueDate, to, dryRun=1.
 *
 * Manual amounts (payouts):
 *   cfbNet=…   CFB payout in CAD           → produces the CFB invoice (taxes incl.)
 *   ufbNet=…   UFB payout in USD           → produces the UFB invoice (no taxes)
 *   rate=…     final USD→CAD rate (Manon)  → REQUIRED when ufbNet is given
 *   cfbGross=… / ufbGross=…   optional gross (shows the commission line)
 *   cfbParts=… / ufbParts=…   optional piece counts
 * (data=live|history still available to derive the payouts from CFB instead.)
 */
export const handler = async (event) => {
    if (!auth(event)) return jsonResponse(401, { error: 'unauthorized' });

    const qs = event.queryStringParameters || {};
    const issueDate = qs.issueDate || todayInTZ();
    const dryRun = qs.dryRun === '1';
    const to = qs.to || undefined;
    const dataSource = qs.data === 'live' ? 'live' : (qs.data === 'history' ? 'history' : 'manual');
    const rate = num(qs.rate);

    if (rate != null && !(rate > 0)) {
        return jsonResponse(400, { error: `Invalid rate "${qs.rate}" — expected a positive number` });
    }
    if (!isYmd(issueDate)) return jsonResponse(400, { error: `Invalid issueDate "${issueDate}" — expected YYYY-MM-DD` });

    // Resolve the [start, end] range.
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

    // Build the manual payouts and infer which kinds to produce.
    let salesBySource = null;
    let kinds;
    if (dataSource === 'manual') {
        salesBySource = {};
        if (num(qs.cfbNet) != null) {
            salesBySource.CA = { netNative: num(qs.cfbNet), grossNative: num(qs.cfbGross), parts: num(qs.cfbParts) };
        }
        if (num(qs.ufbNet) != null) {
            salesBySource.US = { netNative: num(qs.ufbNet), grossNative: num(qs.ufbGross), parts: num(qs.ufbParts) };
        }
        kinds = [salesBySource.CA && 'CFB', salesBySource.US && 'UFB'].filter(Boolean);
        if (!kinds.length) {
            return jsonResponse(400, { error: 'Manual mode needs cfbNet (CAD) and/or ufbNet (USD).' });
        }
        if (salesBySource.US && !(rate > 0)) {
            return jsonResponse(400, { error: 'ufbNet requires the rate (from Manon).' });
        }
    } else if (qs.kinds) {
        kinds = qs.kinds.split(',').map((k) => k.trim().toUpperCase()).filter(Boolean);
        const bad = kinds.filter((k) => k !== 'CFB' && k !== 'UFB');
        if (bad.length) return jsonResponse(400, { error: `Unknown kind(s): ${bad.join(', ')}` });
    } else {
        kinds = ['CFB', 'UFB'];
    }

    try {
        const log = await runInvoices({ start, end, issueDate, to, dryRun, dataSource, salesBySource, rate, kinds });
        return jsonResponse(200, log);
    } catch (e) {
        console.error('[runInvoiceNow] FAIL', e);
        return jsonResponse(500, { error: e.message, start, end, issueDate, dataSource });
    }
};
