import { schedule } from '@netlify/functions';
import {
    SOURCES,
    generateReport,
    parseReportRows,
    aggregateRows,
    isSheetableSale,
} from '../lib/cfb.js';
import { postDailyEntry } from '../lib/sheets.js';
import { getUsdCadRate } from '../lib/fx.js';

/**
 * Weekly sheet aggregate for the streamlined "Journal officiel" sheet.
 *
 * The daily job (dailyIngest-background.js) keeps posting one row per day to the
 * LEGACY sheet and owns all inventory/sales-history side effects. The streamlined
 * sheet instead receives ONE combined entry per week (a "Ventes" row + a
 * "Frais CFB" row), stamped with the week-ending Friday.
 *
 * This job runs Saturday morning, after Friday has fully settled on CFB (orders
 * trickle in through Friday evening — same reason the daily job ingests with a
 * one-day lag). It re-fetches each weekday's report (Mon→Fri) read-only, with
 * NO inventory or sales-history writes, filters to sheetable sales
 * (Platforms + Manual Outputs with payout > 0), and posts the week's aggregate
 * to the new sheet only ({ only: 'new' }).
 *
 * Currency: US reports are USD, so each day's US rows are converted with that
 * day's USD→CAD rate before being pooled with CA rows. Aggregating all rows once
 * at the end (rather than summing per-day aggregates) keeps the weekly "Lots"
 * count distinct across the whole week instead of double-counting a lot sold on
 * more than one day.
 */

const todayInTZ = (tz = 'America/Toronto') => {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    return fmt.format(new Date());
};

// Shift a YYYY-MM-DD by n days. Noon UTC anchor keeps the date math away from
// any DST edge.
const shiftYmd = (ymd, n) => {
    const d = new Date(ymd + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
};

// The five business days of the week ending on `friday`, Mon→Fri.
const weekdaysEndingFriday = (friday) => [-4, -3, -2, -1, 0].map((n) => shiftYmd(friday, n));

// US rows are denominated in USD — scale the monetary fields to CAD. Counts are
// left untouched. aggregateRows() rounds the final sums, so no per-row rounding.
const toCadRows = (rows, rate) => rows.map((r) => ({
    ...r,
    total: r.total * rate,
    payout: r.payout * rate,
}));

async function run() {
    const today = todayInTZ();           // Saturday
    const friday = shiftYmd(today, -1);  // week-ending Friday (yesterday)
    const days = weekdaysEndingFriday(friday);
    const log = { weekEnding: friday, days, errors: [] };

    // Pool every sheetable sale of the week (all sources, all days) into a single
    // CAD-denominated row array, then aggregate once.
    const allRows = [];
    for (const date of days) {
        let fx = null;  // fetched lazily, once per day, only if US has sales
        for (const source of Object.keys(SOURCES)) {
            try {
                const { html } = await generateReport({ startDate: date, endDate: date, source });
                const { rows } = parseReportRows(html, date);
                const sheetable = rows.filter(isSheetableSale);
                if (sheetable.length === 0) continue;

                if (source === 'US') {
                    if (!fx) fx = await getUsdCadRate(date);
                    allRows.push(...toCadRows(sheetable, fx.rate));
                } else {
                    allRows.push(...sheetable);
                }
            } catch (e) {
                log.errors.push(`${date}/${source}: ${e.message}`);
                console.error(`[weeklyIngest:${date}:${source}] FAIL`, e);
            }
        }
    }

    if (allRows.length === 0) {
        log.note = `No sheetable sales for week ending ${friday}.`;
        return log;
    }

    const totals = aggregateRows(allRows);
    log.totals = totals;

    // Stamp the row with the week-ending Friday (a weekday, so the weekend guard
    // in postDailyEntry does not skip it). Post once, new sheet only.
    try {
        const result = await postDailyEntry({
            date: friday,
            parts: totals.parts,
            lots: totals.lots,
            total: totals.total,
            payout: totals.payout,
            fees: totals.fees,
        }, { only: 'new' });
        log.sheets = { step: 'sheets_posted', result };
    } catch (e) {
        log.sheets = { step: 'sheets_failed', error: e.message };
    }

    return log;
}

// 10:30 UTC Saturday ≈ 06:30 Toronto — just after the daily job's 10:00 run that
// ingests Friday, so the whole Mon→Fri week is settled on CFB. Netlify crons are UTC;
// cron weekday 6 = Saturday.
export const handler = schedule('30 10 * * 6', async () => {
    try {
        const log = await run();
        console.log('[weeklyIngest] OK', JSON.stringify(log));
        return { statusCode: 200, body: JSON.stringify(log) };
    } catch (e) {
        console.error('[weeklyIngest] FAIL', e);
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
});
