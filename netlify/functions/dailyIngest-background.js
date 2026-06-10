import { schedule } from '@netlify/functions';
import {
    SOURCES,
    generateReport,
    parseReportRows,
    aggregateRows,
    decrementsFromRows,
    isSheetableSale,
} from '../lib/cfb.js';
import {
    readBsx,
    writeBsx,
    appendSalesEntry,
    hasSalesEntryForDate,
    appendInventorySnapshot,
} from '../lib/blobs.js';
import { parseBsx, serializeBsx, applyDecrements, inventorySummary } from '../lib/bsx.js';
import { postDailyEntry } from '../lib/sheets.js';
import { getUsdCadRate, toCadTotals } from '../lib/fx.js';

const todayInTZ = (tz = 'America/Toronto') => {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    return fmt.format(new Date());
};

// The job runs the morning after, so it ingests the PREVIOUS calendar day —
// by then CFB has recorded every order that shipped that day (orders trickle in
// through the evening, and the snapshot is frozen once written). Noon anchors the
// date math away from any DST edge.
const yesterdayInTZ = (tz = 'America/Toronto') => {
    const d = new Date(todayInTZ(tz) + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
};

const isWeekendYmd = (s) => {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return false;
    const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
    return day === 0 || day === 6;
};

/**
 * Ingest one source (CA or US) for the given date. Both portals decrement the same
 * shared inventory.bsx blob — caller invokes us sequentially so the second source
 * reads the bsx after the first source's write.
 *
 * Inventory decrements and the sales-history blob stay tagged per source for
 * internal tracking. The sheet POST is NOT done here: US and CA follow identical
 * tax rules, so the caller sums each source's sheet totals and posts once.
 *
 * US reports are denominated in USD, so a USD→CAD `fx` rate ({ rate, rateDate,
 * source }) is required for source 'US' — every monetary value (sales history,
 * sheet totals) is converted to CAD before being stored or returned, keeping the
 * whole system single-currency. CA reports are already CAD and ignore `fx`.
 * Returns the source's CAD sheet totals (or null when nothing was ingested).
 */
async function ingestOne(source, date, parentLog, fx) {
    const log = { source, steps: [] };
    parentLog.sources.push(log);

    if (await hasSalesEntryForDate(date, source)) {
        log.note = `Already ingested ${source} for ${date}, skipping.`;
        return null;
    }

    const { html } = await generateReport({ startDate: date, endDate: date, source });
    log.steps.push({ step: 'generated_report', htmlLength: html.length });

    const { rows, sections, dateRange } = parseReportRows(html, date);
    log.steps.push({ step: 'parsed_rows', sections, dateRange, matchedRows: rows.length });

    // US reports are in USD — convert every monetary total to CAD so nothing
    // downstream ever mixes currencies. CA is already CAD and passes through.
    const toCad = (t) => (source === 'US' ? toCadTotals(t, fx.rate) : t);
    const totals = toCad(aggregateRows(rows));
    const platformRows = rows.filter((r) => r.section === 'Platforms');
    const sheetableRows = rows.filter(isSheetableSale);
    const sheetTotals = toCad(aggregateRows(sheetableRows));
    const decrements = decrementsFromRows(rows);
    const platformDecrements = decrementsFromRows(platformRows);
    log.steps.push({
        step: 'aggregated',
        currency: 'CAD',
        fx: source === 'US' ? fx : null,
        totals,
        sheetTotals,
        decrementCount: decrements.length,
        platformDecrementCount: platformDecrements.length,
        sheetableCount: sheetableRows.length,
    });

    let applied = [];
    let missing = [];
    if (decrements.length) {
        const bsx = await readBsx();
        if (!bsx) throw new Error('No inventory.bsx in blob store — seed it first.');
        const doc = parseBsx(bsx);
        ({ applied, missing } = applyDecrements(doc, decrements));
        await writeBsx(serializeBsx(doc));
        log.steps.push({ step: 'bsx_updated', applied: applied.length, missing: missing.length });

        await appendInventorySnapshot({
            date,
            timestamp: new Date().toISOString(),
            source: `daily_ingest_${source}`,
            ...inventorySummary(doc),
        });
        if (missing.length) log.missing = missing;
    } else {
        log.steps.push({ step: 'no_decrements_zero_day' });
    }

    const entry = {
        date,
        source,
        currency: 'CAD',
        fx: source === 'US' ? fx : null,
        parts: totals.parts,
        lots: totals.lots,
        total: totals.total,
        payout: totals.payout,
        fees: totals.fees,
        bySection: totals.bySection,
    };
    await appendSalesEntry({ ...entry, applied, missing, platformDecrements });
    log.steps.push({ step: 'sales_history_appended' });

    // Sheet totals cover real sales only: Platforms + Manual Outputs with
    // positive payout. Zero-payout manual outputs are inventory write-offs
    // (decommissioning / gifts) and must not show up as ventes. The caller
    // sums these across sources and posts a single combined sheet entry.
    return sheetTotals;
}

async function run() {
    const date = yesterdayInTZ();
    const log = { date, sources: [] };

    // CFB only records a sale once the order ships, and shipping never happens
    // on Saturdays or Sundays. If the day we're ingesting (yesterday) was a
    // weekend, skip — it keeps the sales-history blob (and the dashboard graph)
    // clean of zero rows.
    if (isWeekendYmd(date)) {
        log.note = `Weekend (${date}) — daily ingest skipped.`;
        return log;
    }

    // US sales are in USD; fetch the day's USD→CAD rate once so every source's
    // money lands in CAD. A failure here aborts the run rather than posting a
    // mixed-currency total — the day can be replayed via runIngestNow.
    const fx = await getUsdCadRate(date);
    log.fx = fx;

    const combined = { parts: 0, lots: 0, total: 0, payout: 0, fees: 0 };
    let ingestedAny = false;

    for (const source of Object.keys(SOURCES)) {
        try {
            const sheetTotals = await ingestOne(source, date, log, fx);
            if (sheetTotals) {
                ingestedAny = true;
                combined.parts += sheetTotals.parts;
                combined.lots += sheetTotals.lots;
                combined.total += sheetTotals.total;
                combined.payout += sheetTotals.payout;
                combined.fees += sheetTotals.fees;
            }
        } catch (e) {
            log.sources.find((s) => s.source === source).error = e.message;
            console.error(`[dailyIngest:${source}] FAIL`, e);
        }
    }

    // US and CA follow identical tax rules and are now both in CAD, so US sales
    // are folded into the Canadian numbers and the day's combined total is posted
    // to the sheet once.
    if (ingestedAny) {
        try {
            const result = await postDailyEntry({ date, ...combined });
            log.sheets = { step: 'sheets_posted', combined, result };
        } catch (e) {
            log.sheets = { step: 'sheets_failed', combined, error: e.message };
        }
    }

    return log;
}

// 10:00 UTC ≈ 06:00 Toronto (EDT) / 05:00 (EST) — early morning, so the previous
// Toronto day is fully closed on CFB before we ingest it. Netlify crons are UTC.
export const handler = schedule('0 10 * * *', async () => {
    try {
        const log = await run();
        console.log('[dailyIngest] OK', JSON.stringify(log));
        return { statusCode: 200, body: JSON.stringify(log) };
    } catch (e) {
        console.error('[dailyIngest] FAIL', e);
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
});
