import { schedule } from '@netlify/functions';
import { generateReport, parseReportRows, aggregateRows, decrementsFromRows } from '../lib/cfb.js';
import { readBsx, writeBsx, appendSalesEntry } from '../lib/blobs.js';
import { parseBsx, serializeBsx, applyDecrements } from '../lib/bsx.js';
import { postDailyEntry } from '../lib/sheets.js';

const todayInTZ = (tz = 'America/Toronto') => {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    return fmt.format(new Date());
};

async function run() {
    const date = todayInTZ();
    const log = { date, steps: [] };

    const html = await generateReport();
    log.steps.push({ step: 'generated_report', htmlLength: html.length });

    const { rows, rawRowCount } = parseReportRows(html, date);
    log.steps.push({ step: 'parsed_rows', rawRowCount, matchedRows: rows.length });

    if (!rows.length) {
        log.note = 'No rows matched today — nothing to ingest.';
        return log;
    }

    const totals = aggregateRows(rows);
    const decrements = decrementsFromRows(rows);
    log.steps.push({ step: 'aggregated', totals, decrementCount: decrements.length });

    const bsx = await readBsx();
    if (!bsx) throw new Error('No inventory.bsx in blob store — seed it first via /api/seedInventory.');
    const doc = parseBsx(bsx);
    const { applied, missing } = applyDecrements(doc, decrements);
    await writeBsx(serializeBsx(doc));
    log.steps.push({ step: 'bsx_updated', applied: applied.length, missing: missing.length });
    if (missing.length) log.missing = missing;

    const entry = { date, ...totals, lotIds: decrements.map((d) => d.lotId) };
    await appendSalesEntry({ ...entry, applied, missing });
    log.steps.push({ step: 'sales_history_appended' });

    try {
        await postDailyEntry(entry);
        log.steps.push({ step: 'sheets_posted' });
    } catch (e) {
        log.steps.push({ step: 'sheets_failed', error: e.message });
    }

    return log;
}

// 22:00 UTC daily ≈ 18:00 ET (17:00 during EST). Adjust if needed.
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
