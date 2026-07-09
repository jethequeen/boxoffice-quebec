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
    findSalesEntriesForDate,
    removeSalesEntriesForDate,
    appendInventorySnapshot,
} from '../lib/blobs.js';
import { parseBsx, serializeBsx, applyDecrements, inventorySummary } from '../lib/bsx.js';
import { postDailyEntry } from '../lib/sheets.js';
import { getUsdCadRate, toCadTotals } from '../lib/fx.js';
import { jsonResponse } from '../lib/http.js';
import { queueAuthFailure, alertAuthFailures } from '../lib/authAlert.js';

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

// Which sheet(s) the manual post hits. Defaults to 'old' (the legacy sheet) so a
// backfill never accidentally writes a per-day row to the streamlined sheet — that
// one now receives a single weekly aggregate instead (weeklyIngest-background.js).
// Returns the value postDailyEntry's `only` filter expects: 'old' | 'new' | null
// (null = both). 'legacy' is accepted as a synonym for 'old'.
const normalizeTarget = (raw) => {
    const t = String(raw || 'old').trim().toLowerCase();
    if (t === 'old' || t === 'legacy') return 'old';
    if (t === 'new') return 'new';
    if (t === 'both' || t === 'all') return null;
    throw new Error(`Unknown target "${raw}" — expected old, new, or both`);
};

// Re-fetch one source's sheetable aggregate without any side effects. US totals
// are converted to CAD via `fx`. Returns its CAD sheet totals so the caller can
// sum sources and post once.
async function postOnlyTotals({ date, source, fx, log }) {
    const sub = { source, steps: [] };
    log.sources.push(sub);
    const { html } = await generateReport({ startDate: date, endDate: date, source });
    const { rows } = parseReportRows(html, date);
    const sheetable = rows.filter(isSheetableSale);
    const t = source === 'US' ? toCadTotals(aggregateRows(sheetable), fx.rate) : aggregateRows(sheetable);
    sub.steps.push({
        step: 'postOnly_refetched',
        currency: 'CAD',
        fx: source === 'US' ? fx : null,
        sheetTotals: t,
        sheetableCount: sheetable.length,
    });
    return t;
}

async function ingestOne({ source, date, startDate, endDate, dryRun, force, replace, fx, log }) {
    const sub = { source, steps: [] };
    log.sources.push(sub);

    // `replace` corrects a false-zero day (one recorded while the token was
    // expired): it drops the prior entry and re-ingests the real numbers. It is
    // only safe when that prior entry decremented NOTHING — otherwise the
    // inventory was already touched and a blind replace would leave it wrong, so
    // we refuse and ask for a manual fix.
    if (!dryRun && replace) {
        const existing = await findSalesEntriesForDate(date, source);
        if (existing.some((e) => (e.applied?.length || 0) > 0)) {
            sub.error = `Refus de remplacer ${source} ${date}: une entrée existante a déjà décrémenté l’inventaire (correction manuelle requise).`;
            return { status: 'replace_blocked' };
        }
    }

    if (!dryRun && !force && !replace && await hasSalesEntryForDate(date, source)) {
        sub.error = `Already ingested ${source} for ${date}. Pass ?replace=1 to correct a false zero, or ?force=1 to override (will double-decrement).`;
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

    // US reports are in USD — convert every monetary total to CAD so nothing
    // downstream ever mixes currencies. CA is already CAD and passes through.
    const toCad = (t) => (source === 'US' ? toCadTotals(t, fx.rate) : t);
    const rawTotals = aggregateRows(rows);       // pre-conversion (USD for source 'US')
    const totals = toCad(rawTotals);
    const platformRows = rows.filter((r) => r.section === 'Platforms');
    const sheetableRows = rows.filter(isSheetableSale);
    const sheetTotals = toCad(aggregateRows(sheetableRows));
    const decrements = decrementsFromRows(rows);
    const platformDecrements = decrementsFromRows(platformRows);
    sub.steps.push({
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
        currency: 'CAD',
        fx: source === 'US' ? fx : null,
        parts: totals.parts,
        lots: totals.lots,
        total: totals.total,
        payout: totals.payout,
        fees: totals.fees,
        bySection: totals.bySection,
        // Preserve the native pre-conversion amounts for US so invoices can re-convert
        // at a different (invoice-day) rate without reversing the stored CAD figure.
        ...(source === 'US' ? { origCurrency: 'USD', origTotal: rawTotals.total, origPayout: rawTotals.payout } : {}),
    };
    // In replace mode, drop the prior (false-zero) entry now that we have real data
    // — only reached after a successful fetch, so an auth failure never deletes it.
    if (replace) {
        const removed = await removeSalesEntriesForDate(date, source);
        sub.steps.push({ step: 'replaced_prior_entries', removed });
    }
    await appendSalesEntry({ ...entry, applied, missing, platformDecrements });
    sub.steps.push({ step: 'sales_history_appended' });

    // US and CA follow identical tax rules, so the handler sums each source's
    // sheet totals and posts a single combined entry — no per-source POST here.
    return { status: 'ok', sheetTotals };
}

export const handler = async (event) => {
    if (!auth(event)) return jsonResponse(401, { error: 'unauthorized' });

    const qs = event.queryStringParameters || {};
    const dryRun = qs.dryRun === '1';
    const force = qs.force === '1';
    const replace = qs.replace === '1';
    const postOnlyMode = qs.postOnly === '1';
    const date = qs.date || todayInTZ();
    const startDate = qs.startDate || date;
    const endDate = qs.endDate || date;

    let sources;
    let target;  // 'old' | 'new' | null (both) — which sheets webhook(s) fire
    try {
        sources = parseSources(qs.source);
        target = normalizeTarget(qs.target);
    } catch (e) {
        return jsonResponse(400, { error: e.message });
    }

    const log = { date, startDate, endDate, dryRun, force, replace, postOnly: postOnlyMode, target, sources: [] };

    // US money is in USD — fetch the report date's USD→CAD rate so US totals can
    // be converted before being summed with CA. Only needed when US is requested
    // and we'll actually convert (dry runs never reach conversion).
    let fx = null;
    if (sources.includes('US') && !dryRun) {
        try {
            fx = await getUsdCadRate(date);
            log.fx = fx;
        } catch (e) {
            return jsonResponse(502, { error: `USD→CAD rate unavailable: ${e.message}`, log });
        }
    }

    // US and CA share tax rules, so each requested source's sheet totals are
    // summed and posted to the sheet once per invocation.
    const combined = { parts: 0, lots: 0, total: 0, payout: 0, fees: 0 };
    let ingestedAny = false;
    const authFailedSources = [];
    const addTotals = (t) => {
        if (!t) return;
        ingestedAny = true;
        combined.parts += t.parts;
        combined.lots += t.lots;
        combined.total += t.total;
        combined.payout += t.payout;
        combined.fees += t.fees;
    };

    try {
        if (postOnlyMode) {
            // Re-fetch each requested source's report from CFB and post the
            // combined sheetable aggregate (Platforms + Manual Outputs with
            // payout > 0). No inventory or sales-history side effects — safe to
            // run any time for backfills or corrections, including past dates.
            for (const source of sources) {
                try {
                    addTotals(await postOnlyTotals({ date, source, fx, log }));
                } catch (e) {
                    (log.sources.find((s) => s.source === source) || {}).error = e.message;
                    console.error(`[runIngestNow:postOnly:${source}] FAIL`, e);
                    if (await queueAuthFailure(e, { date, source })) authFailedSources.push(source);
                }
            }
        } else {
            for (const source of sources) {
                try {
                    const r = await ingestOne({ source, date, startDate, endDate, dryRun, force, replace, fx, log });
                    if (r.status === 'no_bsx') {
                        return jsonResponse(412, { error: 'No inventory.bsx in blob store. Seed it first.', log });
                    }
                    addTotals(r.sheetTotals);
                } catch (e) {
                    log.sources.find((s) => s.source === source).error = e.message;
                    console.error(`[runIngestNow:${source}] FAIL`, e);
                    // Parity with the cron jobs: an expired session queues the day
                    // and alerts (skipped on dry runs, which must stay side-effect-free).
                    if (!dryRun && await queueAuthFailure(e, { date, source })) authFailedSources.push(source);
                }
            }
        }

        // Manual runs alert just like the cron so a token expiry surfaces on demand.
        if (!dryRun) await alertAuthFailures(authFailedSources, log);

        // Dry runs return no totals and never post.
        if (ingestedAny && !dryRun) {
            try {
                const result = await postDailyEntry({ date, ...combined }, { only: target });
                log.sheets = { step: 'sheets_posted', combined, result };
            } catch (e) {
                log.sheets = { step: 'sheets_failed', combined, error: e.message };
                return jsonResponse(502, log);
            }
        }
        return jsonResponse(200, log);
    } catch (e) {
        console.error('[runIngestNow] FAIL', e);
        return jsonResponse(500, { error: e.message, log });
    }
};
