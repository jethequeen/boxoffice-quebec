import { generateReport, parseReportRows, aggregateRows, decrementsFromRows, isSheetableSale } from '../lib/cfb.js';
import { readBsx, writeBsx, appendSalesEntry, hasSalesEntryForDate, appendInventorySnapshot } from '../lib/blobs.js';
import { parseBsx, serializeBsx, applyDecrements, inventorySummary } from '../lib/bsx.js';
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
    const postOnly = qs.postOnly === '1';
    const target = qs.target || null;  // 'legacy' | 'new' — restricts which sheets webhook(s) fire
    const date = qs.date || todayInTZ();
    const startDate = qs.startDate || date;
    const endDate = qs.endDate || date;
    const log = { date, startDate, endDate, dryRun, force, postOnly, target, steps: [] };

    try {
        if (postOnly) {
            // Re-fetch the report from CFB and post the sheetable aggregate
            // (Platforms + Manual Outputs with payout > 0). No inventory or
            // sales-history side effects, so this is safe to run any time
            // for backfills or corrections — including past dates.
            const { html } = await generateReport({ startDate: date, endDate: date });
            const { rows } = parseReportRows(html, date);
            const sheetable = rows.filter(isSheetableSale);
            const t = aggregateRows(sheetable);
            const sheetEntry = {
                date,
                parts: t.parts,
                lots: t.lots,
                total: t.total,
                payout: t.payout,
                fees: t.fees,
            };
            log.steps.push({ step: 'postOnly_refetched', sheetEntry, sheetableCount: sheetable.length });
            try {
                const result = await postDailyEntry(sheetEntry, { only: target });
                log.steps.push({ step: 'sheets_posted', result });
            } catch (e) {
                log.steps.push({ step: 'sheets_failed', error: e.message });
                return jsonResponse(502, log);
            }
            return jsonResponse(200, log);
        }

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
            if (!bsx) return jsonResponse(412, { error: 'No inventory.bsx in blob store. Seed it first.' });
            const doc = parseBsx(bsx);
            ({ applied, missing } = applyDecrements(doc, decrements));
            await writeBsx(serializeBsx(doc));
            log.steps.push({ step: 'bsx_updated', applied: applied.length, missing: missing.length });

            await appendInventorySnapshot({
                date,
                timestamp: new Date().toISOString(),
                source: 'manual_ingest',
                ...inventorySummary(doc),
            });
            if (missing.length) log.missing = missing;
        } else {
            log.steps.push({ step: 'no_decrements_zero_day' });
        }

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

        // Sheets payload covers real sales only: Platforms + Manual Outputs
        // with positive payout. Zero-payout manual outputs are inventory
        // write-offs (decommissioning / gifts) and must not show up as ventes.
        const sheetEntry = {
            date,
            parts: sheetTotals.parts,
            lots: sheetTotals.lots,
            total: sheetTotals.total,
            payout: sheetTotals.payout,
            fees: sheetTotals.fees,
        };
        try {
            const result = await postDailyEntry(sheetEntry, { only: target });
            log.steps.push({ step: 'sheets_posted', result });
        } catch (e) {
            log.steps.push({ step: 'sheets_failed', error: e.message });
        }

        return jsonResponse(200, log);
    } catch (e) {
        console.error('[runIngestNow] FAIL', e);
        return jsonResponse(500, { error: e.message, log });
    }
};
