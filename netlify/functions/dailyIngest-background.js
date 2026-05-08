import { schedule } from '@netlify/functions';
import { generateReport, parseReportRows, aggregateRows, decrementsFromRows } from '../lib/cfb.js';
import { readBsx, writeBsx, appendSalesEntry, hasSalesEntryForDate, appendInventorySnapshot } from '../lib/blobs.js';
import { parseBsx, serializeBsx, applyDecrements, inventorySummary } from '../lib/bsx.js';
import { postDailyEntry } from '../lib/sheets.js';

const todayInTZ = (tz = 'America/Toronto') => {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    return fmt.format(new Date());
};

async function run() {
    const date = todayInTZ();
    const log = { date, steps: [] };

    if (await hasSalesEntryForDate(date)) {
        log.note = `Already ingested ${date}, skipping.`;
        return log;
    }

    const { html } = await generateReport({ startDate: date, endDate: date });
    log.steps.push({ step: 'generated_report', htmlLength: html.length });

    const { rows, sections, dateRange } = parseReportRows(html, date);
    log.steps.push({ step: 'parsed_rows', sections, dateRange, matchedRows: rows.length });

    if (!rows.length) {
        log.note = 'No rows matched today — nothing to ingest.';
        return log;
    }

    const totals = aggregateRows(rows);
    const platformRows = rows.filter((r) => r.section === 'Platforms');
    const platformTotals = aggregateRows(platformRows);
    const decrements = decrementsFromRows(rows);
    const platformDecrements = decrementsFromRows(platformRows);
    log.steps.push({
        step: 'aggregated',
        totals,
        platformTotals,
        decrementCount: decrements.length,
        platformDecrementCount: platformDecrements.length,
    });

    const bsx = await readBsx();
    if (!bsx) throw new Error('No inventory.bsx in blob store — seed it first.');
    const doc = parseBsx(bsx);
    const { applied, missing } = applyDecrements(doc, decrements);
    await writeBsx(serializeBsx(doc));
    log.steps.push({ step: 'bsx_updated', applied: applied.length, missing: missing.length });

    await appendInventorySnapshot({
        date,
        timestamp: new Date().toISOString(),
        source: 'daily_ingest',
        ...inventorySummary(doc),
    });
    if (missing.length) log.missing = missing;

    const entry = {
        date,
        parts: totals.parts,
        lots: totals.lots,
        total: totals.total,
        payout: totals.payout,
        fees: totals.fees,
        bySection: totals.bySection,
    };
    await appendSalesEntry({ ...entry, applied, missing, platformDecrements });
    log.steps.push({ step: 'sales_history_appended' });

    // Sheets payload is Platforms-only — manual outputs are inventory write-offs, not sales.
    const sheetEntry = {
        date,
        parts: platformTotals.parts,
        lots: platformTotals.lots,
        total: platformTotals.total,
        payout: platformTotals.payout,
        fees: platformTotals.fees,
    };
    try {
        await postDailyEntry(sheetEntry);
        log.steps.push({ step: 'sheets_posted' });
    } catch (e) {
        log.steps.push({ step: 'sheets_failed', error: e.message });
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
