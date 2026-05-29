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

// `?source=` accepts a single tag (CA | US) or comma-separated list. Defaults to
// both — matches the cron's behaviour and lets the user re-run everything in one
// shot. Validation lives here so a typo fails fast instead of hitting the network.
const parseSources = (raw) => {
    if (!raw) return Object.keys(SOURCES);
    const wanted = String(raw).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    const bad = wanted.filter((s) => !SOURCES[s]);
    if (bad.length) throw new Error(`Unknown source(s): ${bad.join(', ')} — expected CA, US, or CA,US`);
    return wanted;
};

async function postOnly({ date, source, target, log }) {
    const sub = { source, steps: [] };
    log.sources.push(sub);
    const { html } = await generateReport({ startDate: date, endDate: date, source });
    const { rows } = parseReportRows(html, date);
    const sheetable = rows.filter(isSheetableSale);
    const t = aggregateRows(sheetable);
    const sheetEntry = {
        date,
        source,
        parts: t.parts,
        lots: t.lots,
        total: t.total,
        payout: t.payout,
        fees: t.fees,
    };
    sub.steps.push({ step: 'postOnly_refetched', sheetEntry, sheetableCount: sheetable.length });
    try {
        const result = await postDailyEntry(sheetEntry, { only: target });
        sub.steps.push({ step: 'sheets_posted', result });
        return true;
    } catch (e) {
        sub.steps.push({ step: 'sheets_failed', error: e.message });
        return false;
    }
}

async function ingestOne({ source, date, startDate, endDate, dryRun, force, log }) {
    const sub = { source, steps: [] };
    log.sources.push(sub);

    if (!dryRun && !force && await hasSalesEntryForDate(date, source)) {
        sub.error = `Already ingested ${source} for ${date}. Pass ?force=1 to override (will double-decrement).`;
        return { status: 'already_ingested' };
    }

    const { html, dateFields } = await generateReport({ startDate, endDate, source });
    sub.steps.push({ step: 'generated_report', htmlLength: html.length, dateFields });

    const { rows, sections, dateRange } = parseReportRows(html, date);
    sub.steps.push({ step: 'parsed_rows', sections, dateRange, matchedRows: rows.length });

    if (dryRun) {
        sub.sampleRows = rows.slice(0, 3);
        sub.totals = aggregateRows(rows);
        sub.decrementCount = decrementsFromRows(rows).length;
        if (rows.length === 0) {
            sub.htmlHead = html.slice(0, 1500);
            sub.htmlTail = html.slice(-1500);
            sub.titleMatch = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || null;
            sub.h1H3 = [...html.matchAll(/<h[13][^>]*>([^<]*)<\/h[13]>/gi)].map((m) => m[1].trim()).slice(0, 5);
        }
        return { status: 'dry_run' };
    }

    const totals = aggregateRows(rows);
    const platformRows = rows.filter((r) => r.section === 'Platforms');
    const sheetableRows = rows.filter(isSheetableSale);
    const sheetTotals = aggregateRows(sheetableRows);
    const decrements = decrementsFromRows(rows);
    const platformDecrements = decrementsFromRows(platformRows);
    sub.steps.push({
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
        if (!bsx) return { status: 'no_bsx' };
        const doc = parseBsx(bsx);
        ({ applied, missing } = applyDecrements(doc, decrements));
        await writeBsx(serializeBsx(doc));
        sub.steps.push({ step: 'bsx_updated', applied: applied.length, missing: missing.length });

        await appendInventorySnapshot({
            date,
            timestamp: new Date().toISOString(),
            source: `manual_ingest_${source}`,
            ...inventorySummary(doc),
        });
        if (missing.length) sub.missing = missing;
    } else {
        sub.steps.push({ step: 'no_decrements_zero_day' });
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
    sub.steps.push({ step: 'sales_history_appended' });

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
        const result = await postDailyEntry(sheetEntry, { only: log.target });
        sub.steps.push({ step: 'sheets_posted', result });
    } catch (e) {
        sub.steps.push({ step: 'sheets_failed', error: e.message });
    }
    return { status: 'ok' };
}

export const handler = async (event) => {
    if (!auth(event)) return jsonResponse(401, { error: 'unauthorized' });

    const qs = event.queryStringParameters || {};
    const dryRun = qs.dryRun === '1';
    const force = qs.force === '1';
    const postOnlyMode = qs.postOnly === '1';
    const target = qs.target || null;  // 'legacy' | 'new' — restricts which sheets webhook(s) fire
    const date = qs.date || todayInTZ();
    const startDate = qs.startDate || date;
    const endDate = qs.endDate || date;

    let sources;
    try {
        sources = parseSources(qs.source);
    } catch (e) {
        return jsonResponse(400, { error: e.message });
    }

    const log = { date, startDate, endDate, dryRun, force, postOnly: postOnlyMode, target, sources: [] };

    try {
        if (postOnlyMode) {
            // Re-fetch each requested source's report from CFB and post the
            // sheetable aggregate (Platforms + Manual Outputs with payout > 0).
            // No inventory or sales-history side effects — safe to run any time
            // for backfills or corrections, including past dates.
            let anyFailure = false;
            for (const source of sources) {
                const ok = await postOnly({ date, source, target, log });
                if (!ok) anyFailure = true;
            }
            return jsonResponse(anyFailure ? 502 : 200, log);
        }

        for (const source of sources) {
            try {
                const r = await ingestOne({ source, date, startDate, endDate, dryRun, force, log });
                if (r.status === 'no_bsx') {
                    return jsonResponse(412, { error: 'No inventory.bsx in blob store. Seed it first.', log });
                }
            } catch (e) {
                log.sources.find((s) => s.source === source).error = e.message;
                console.error(`[runIngestNow:${source}] FAIL`, e);
            }
        }
        return jsonResponse(200, log);
    } catch (e) {
        console.error('[runIngestNow] FAIL', e);
        return jsonResponse(500, { error: e.message, log });
    }
};
