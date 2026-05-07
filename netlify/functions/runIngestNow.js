import { generateReport, parseReportRows, aggregateRows, decrementsFromRows } from '../lib/cfb.js';
import { readBsx, writeBsx, appendSalesEntry, hasSalesEntryForDate } from '../lib/blobs.js';
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

    const qs = event.queryStringParameters || {};
    const dryRun = qs.dryRun === '1';
    const force = qs.force === '1';
    const date = qs.date || todayInTZ();
    const startDate = qs.startDate || date;
    const endDate = qs.endDate || date;
    const log = { date, startDate, endDate, dryRun, force, steps: [] };

    try {
        if (!dryRun && !force && await hasSalesEntryForDate(date)) {
            return jsonResponse(409, {
                error: `Already ingested ${date}. Pass ?force=1 to override (will double-decrement).`,
                date,
            });
        }

        const { html, dateFields } = await generateReport({ startDate, endDate });
        log.steps.push({ step: 'generated_report', htmlLength: html.length, dateFields });

        const { rows, sections, dateRange } = parseReportRows(html, date);
        log.steps.push({ step: 'parsed_rows', sections, dateRange, matchedRows: rows.length });
        if (dryRun) {
            log.sampleRows = rows.slice(0, 3);
            log.totals = aggregateRows(rows);
            log.decrementCount = decrementsFromRows(rows).length;
            if (rows.length === 0) {
                log.htmlHead = html.slice(0, 1500);
                log.htmlTail = html.slice(-1500);
                log.titleMatch = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || null;
                log.h1H3 = [...html.matchAll(/<h[13][^>]*>([^<]*)<\/h[13]>/gi)].map((m) => m[1].trim()).slice(0, 5);
            }
            return jsonResponse(200, log);
        }

        if (!rows.length) {
            log.note = 'No rows matched the requested date.';
            return jsonResponse(200, log);
        }

        const totals = aggregateRows(rows);
        const decrements = decrementsFromRows(rows);
        const platformDecrements = decrementsFromRows(rows.filter((r) => r.section === 'Platforms'));
        log.steps.push({
            step: 'aggregated',
            totals,
            decrementCount: decrements.length,
            platformDecrementCount: platformDecrements.length,
        });

        const bsx = await readBsx();
        if (!bsx) return jsonResponse(412, { error: 'No inventory.bsx in blob store. Seed it first.' });
        const doc = parseBsx(bsx);
        const { applied, missing } = applyDecrements(doc, decrements);
        await writeBsx(serializeBsx(doc));
        log.steps.push({ step: 'bsx_updated', applied: applied.length, missing: missing.length });
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
