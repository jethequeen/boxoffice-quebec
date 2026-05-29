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
 * reads the bsx after the first source's write. Sheet payload is tagged with
 * `source` so the downstream Apps Script can apply tax rules per origin.
 */
async function ingestOne(source, date, parentLog) {
    const log = { source, steps: [] };
    parentLog.sources.push(log);

    if (await hasSalesEntryForDate(date, source)) {
        log.note = `Already ingested ${source} for ${date}, skipping.`;
        return;
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

    // Sheets payload covers real sales only: Platforms + Manual Outputs
    // with positive payout. Zero-payout manual outputs are inventory
    // write-offs (decommissioning / gifts) and must not show up as ventes.
    const sheetEntry = {
        date,
        source,
        parts: sheetTotals.parts,
        lots: sheetTotals.lots,
        total: sheetTotals.total,
        payout: sheetTotals.payout,
        fees: sheetTotals.fees,
    };
    try {
        const result = await postDailyEntry(sheetEntry);
        log.steps.push({ step: 'sheets_posted', result });
    } catch (e) {
        log.steps.push({ step: 'sheets_failed', error: e.message });
    }
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

    for (const source of Object.keys(SOURCES)) {
        try {
            await ingestOne(source, date, log);
        } catch (e) {
            log.sources.find((s) => s.source === source).error = e.message;
            console.error(`[dailyIngest:${source}] FAIL`, e);
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
