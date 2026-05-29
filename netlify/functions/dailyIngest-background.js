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

const todayInTZ = (tz = 'America/Toronto') => {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    return fmt.format(new Date());
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
 * Returns the source's sheet totals (or null when nothing was ingested).
 */
async function ingestOne(source, date, parentLog) {
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

    const totals = aggregateRows(rows);
    const platformRows = rows.filter((r) => r.section === 'Platforms');
    const sheetableRows = rows.filter(isSheetableSale);
    const sheetTotals = aggregateRows(sheetableRows);
    const decrements = decrementsFromRows(rows);
    const platformDecrements = decrementsFromRows(platformRows);
    log.steps.push({
        step: 'aggregated',
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
    const date = todayInTZ();
    const log = { date, sources: [] };

    // CFB only records a sale once the order ships, and shipping never happens
    // on Saturdays or Sundays. Skipping the whole run on weekends keeps the
    // sales-history blob (and therefore the dashboard graph) clean of zero rows.
    if (isWeekendYmd(date)) {
        log.note = `Weekend (${date}) — daily ingest skipped.`;
        return log;
    }

    const combined = { parts: 0, lots: 0, total: 0, payout: 0, fees: 0 };
    let ingestedAny = false;

    for (const source of Object.keys(SOURCES)) {
        try {
            const sheetTotals = await ingestOne(source, date, log);
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

    // US and CA follow identical tax rules, so US sales are folded into the
    // Canadian numbers and the day's combined total is posted to the sheet once.
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

export const handler = schedule('0 22 * * *', async () => {
    try {
        const log = await run();
        console.log('[dailyIngest] OK', JSON.stringify(log));
        return { statusCode: 200, body: JSON.stringify(log) };
    } catch (e) {
        console.error('[dailyIngest] FAIL', e);
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
});
