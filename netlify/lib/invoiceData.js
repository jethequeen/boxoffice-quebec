/**
 * Live invoice source data — fetch the CFB/UFB vendor reports directly for the
 * invoice's date range, rather than summing the daily sales-history blob.
 *
 * This is the accurate path: the report is the system of record, it covers exactly
 * the requested range in one shot, and US totals come back in NATIVE USD (no
 * ingest-day-rate round-trip). We keep only real sales (isSheetableSale = Platforms
 * + Manual Outputs with payout > 0), which excludes inventory write-offs/gifts.
 */

import {
    SOURCES,
    generateReport,
    parseReportRows,
    aggregateRows,
    isSheetableSale,
} from './cfb.js';
import { isAuthError } from './authAlert.js';
import { sendAuthExpiredEmail } from './email.js';

/**
 * Fetch one platform's sheetable sales for [start, end]. Returns native-currency
 * gross (USD for US, CAD for CA), piece count and the days that contributed.
 */
export async function fetchRangeSales({ start, end, source }) {
    const { html } = await generateReport({ startDate: start, endDate: end, source });
    // The server already scopes the report to the range; bound it again defensively
    // in case a boundary row slips in.
    const { rows, dateRange } = parseReportRows(html, (d) => d >= start && d <= end);
    const sheetable = rows.filter(isSheetableSale);
    const agg = aggregateRows(sheetable);
    const days = [...new Set(sheetable.map((r) => r.date))].sort();
    // netNative = payout (the amount owed, already net of commission); grossNative
    // = total sales (before commission) for the optional gross line on the invoice.
    return { parts: agg.parts, netNative: agg.payout, grossNative: agg.total, days, rowCount: sheetable.length, dateRange };
}

/**
 * Fetch both platforms for the invoice range. On an expired session, email the
 * token-reset alert for that source and throw — an invoice must not go out with a
 * platform silently missing. Records per-source detail on `log.fetched`.
 */
export async function fetchInvoiceSales({ start, end, sources = Object.keys(SOURCES), log = {} }) {
    const bySource = {};
    for (const source of sources) {
        try {
            const s = await fetchRangeSales({ start, end, source });
            bySource[source] = s;
            (log.fetched ||= []).push({ source, parts: s.parts, grossNative: s.grossNative, rows: s.rowCount });
        } catch (e) {
            if (isAuthError(e)) {
                (log.authFailed ||= []).push(source);
                await sendAuthExpiredEmail({ source, missed: [] }).catch(() => {});
            }
            throw new Error(`Fetch ${source} ${start}..${end} failed: ${e.message}`);
        }
    }
    return bySource;
}
