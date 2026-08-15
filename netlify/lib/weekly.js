/**
 * Weekly streamlined-sheet aggregate — shared by the Saturday cron
 * (weeklyIngest-background.js) and the on-demand endpoint (runWeeklyNow.js) so a
 * missed week (e.g. a mid-week token expiry) can be replayed by hand.
 *
 * Re-fetches each weekday (Mon→Fri) of the week ending on `friday` read-only, pools
 * sheetable sales per source (US converted to CAD), and posts ONE entry per source
 * to the new sheet. CA is taxable → tax-INCLUDED amounts (the money that moves);
 * US is a zero-rated export → posted as-is. See cfb-streamlined-sheet.gs.
 */

import { SOURCES, generateReport, parseReportRows, aggregateRows, isSheetableSale } from './cfb.js';
import { getUsdCadRate } from './fx.js';
import { postDailyEntry } from './sheets.js';
import { queueAuthFailure, alertAuthFailures } from './authAlert.js';
import { TAX_RATES } from './invoiceConfig.js';

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const TAX_FACTOR = 1 + TAX_RATES.tps + TAX_RATES.tvq;
const withTaxes = (n) => round2(n * TAX_FACTOR);

// Shift a YYYY-MM-DD by n days. Noon UTC anchor keeps the date math away from DST.
export const shiftYmd = (ymd, n) => {
    const d = new Date(ymd + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
};

/** The week-ending Friday of the Mon→Fri business week containing `ymd`. */
export function fridayOfWeek(ymd) {
    const dow = new Date(ymd + 'T12:00:00Z').getUTCDay();   // 0=Sun … 6=Sat
    const delta = dow === 0 ? -2 : dow === 6 ? -1 : 5 - dow;
    return shiftYmd(ymd, delta);
}

const weekdaysEndingFriday = (friday) => [-4, -3, -2, -1, 0].map((n) => shiftYmd(friday, n));

const toCadRows = (rows, rate) => rows.map((r) => ({ ...r, total: r.total * rate, payout: r.payout * rate }));

/**
 * Aggregate and post the week ending on `friday`. `dryRun` computes everything but
 * skips the sheet POST (returns what WOULD be posted). `sources` restricts which
 * origins are fetched/posted (default both — pass ['US'] to replay just US after a
 * US-only token expiry). Returns a log object.
 */
export async function runWeek({ friday, dryRun = false, sources = Object.keys(SOURCES) }) {
    const wanted = Object.keys(SOURCES).filter((s) => sources.includes(s));
    const days = weekdaysEndingFriday(friday);
    const log = { weekEnding: friday, days, dryRun, sources: wanted, errors: [] };

    const rowsBySource = { CA: [], US: [] };
    const authFailedSources = new Set();
    for (const date of days) {
        let fx = null;  // fetched lazily, once per day, only if US has sales
        for (const source of wanted) {
            try {
                const { html } = await generateReport({ startDate: date, endDate: date, source });
                const { rows } = parseReportRows(html, date);
                const sheetable = rows.filter(isSheetableSale);
                if (sheetable.length === 0) continue;

                if (source === 'US') {
                    if (!fx) fx = await getUsdCadRate(date);
                    rowsBySource.US.push(...toCadRows(sheetable, fx.rate));
                } else {
                    rowsBySource.CA.push(...sheetable);
                }
            } catch (e) {
                log.errors.push(`${date}/${source}: ${e.message}`);
                console.error(`[weekly:${date}:${source}] FAIL`, e);
                if (await queueAuthFailure(e, { date, source })) authFailedSources.add(source);
            }
        }
    }

    // One alert per source whose token expired, so it can be refreshed and replayed.
    await alertAuthFailures(authFailedSources, log);

    if (rowsBySource.CA.length === 0 && rowsBySource.US.length === 0) {
        log.note = `No sheetable sales for week ending ${friday}.`;
        return log;
    }

    // One POST per source. CA taxable → tax-included Montant; US zero-rated → as-is.
    // The 25% commission stays computed on the gross hors taxes (both lines scale by
    // the same factor), so the sheet's J/K formulas extract the taxes back out.
    log.totals = {};
    log.sheets = {};
    for (const source of wanted) {
        const rows = rowsBySource[source];
        if (rows.length === 0) continue;
        const totals = aggregateRows(rows);
        const taxable = source === 'CA';
        const postTotal = taxable ? withTaxes(totals.total) : totals.total;
        const postFees = taxable ? withTaxes(totals.fees) : totals.fees;
        log.totals[source] = { ...totals, taxable, postTotal, postFees };
        if (dryRun) {
            log.sheets[source] = { step: 'dry_run', wouldPost: { total: postTotal, fees: postFees, net: round2(postTotal - postFees) } };
            continue;
        }
        try {
            const result = await postDailyEntry({
                date: friday,
                source,
                parts: totals.parts,
                lots: totals.lots,
                total: postTotal,
                payout: totals.payout,
                fees: postFees,
            }, { only: 'new' });
            log.sheets[source] = { step: 'sheets_posted', result };
        } catch (e) {
            log.sheets[source] = { step: 'sheets_failed', error: e.message };
        }
    }

    return log;
}
