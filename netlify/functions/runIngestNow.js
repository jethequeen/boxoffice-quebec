import { generateReport, parseReportRows, aggregateRows, decrementsFromRows } from '../lib/cfb.js';
import { readBsx, writeBsx, appendSalesEntry } from '../lib/blobs.js';
import { parseBsx, serializeBsx, applyDecrements } from '../lib/bsx.js';
import { postDailyEntry } from '../lib/sheets.js';
import { jsonResponse } from '../lib/http.js';

const todayInTZ = (tz = 'America/Toronto') => {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    return fmt.format(new Date());
};

const auth = (event) => {
    const expected = process.env.INGEST_TOKEN;
    if (!expected) return true;
    const got = event.headers?.authorization || event.headers?.Authorization || '';
    return got === `Bearer ${expected}`;
};

export const handler = async (event) => {
    if (!auth(event)) return jsonResponse(401, { error: 'unauthorized' });

    const dryRun = (event.queryStringParameters?.dryRun || '') === '1';
    const date = event.queryStringParameters?.date || todayInTZ();
    const log = { date, dryRun, steps: [] };

    try {
        const html = await generateReport();
        log.steps.push({ step: 'generated_report', htmlLength: html.length });

        const { rows, rawRowCount } = parseReportRows(html, date);
        log.steps.push({ step: 'parsed_rows', rawRowCount, matchedRows: rows.length });
        if (dryRun) log.sampleRow = rows[0] || null;

        if (!rows.length) {
            log.note = 'No rows matched the requested date.';
            return jsonResponse(200, log);
        }

        const totals = aggregateRows(rows);
        const decrements = decrementsFromRows(rows);
        log.steps.push({ step: 'aggregated', totals, decrementCount: decrements.length });

        if (dryRun) return jsonResponse(200, log);

        const bsx = await readBsx();
        if (!bsx) return jsonResponse(412, { error: 'No inventory.bsx in blob store. Seed it first.' });
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

        return jsonResponse(200, log);
    } catch (e) {
        console.error('[runIngestNow] FAIL', e);
        return jsonResponse(500, { error: e.message, log });
    }
};
