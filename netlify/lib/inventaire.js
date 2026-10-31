import * as cheerio from 'cheerio';
import { fetchHtml } from './cfb.js';
import { getUsdCadRate } from './fx.js';

/**
 * Inventory value per seller, read from the CFB/UFB "Inventory Batches" report
 * (/bricklink/inventory_vendor_batch_reports) — the report that IS the inventory,
 * unlike the vendor (sales) report in cfb.js. Ported from the MLJQ project's
 * sortpack/cfb_inventory.py so the month-end value no longer depends on a laptop
 * being awake on the 1st.
 *
 * One report per (seller × portal): the form has a vendor <select> and an as-of
 * date, so any past date can be re-read. CA values are CAD; US values are USD and
 * converted at the Bank of Canada rate of the as-of date. Served to Alfred by
 * functions/inventaire.js.
 */

const BATCH_NEW_PATH = '/bricklink/inventory_vendor_batch_reports/new';
const BATCH_POST_PATH = '/bricklink/inventory_vendor_batch_reports';
const TZ = 'America/Toronto';

// Dropdown labels accepted per seller (case-insensitive substring). The US portal
// listed MLJQ as "MLJC" for a while; both are accepted so a relabel can't break it.
export const VENDORS = {
    binobrick: ['bino'],
    mljq: ['mljq', 'mljc'],
};

const SOURCE_KEY = { CA: 'cfb', US: 'ufb' };

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/** YYYY-MM-DD in Toronto, `offsetDays` from today. */
export function torontoYmd(offsetDays = 0) {
    const d = new Date(Date.now() + offsetDays * 86400000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Last day of the month before today's (Toronto) — the month-end the 1st closes. */
export function previousMonthEnd() {
    const [y, m] = torontoYmd().split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
}

/** ISO timestamp with Toronto's offset, e.g. 2026-11-01T05:00:12-04:00. */
export function torontoIso(d = new Date()) {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', {
            timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
            timeZoneName: 'longOffset',
        }).formatToParts(d).map((p) => [p.type, p.value]),
    );
    const offset = parts.timeZoneName.replace('GMT', '') || '+00:00';
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

/** "$104,901.73" → 104901.73 */
function parseMoney(text) {
    const m = String(text || '').replace(/[\s,]/g, '').match(/\$(-?\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
}

/** Leading integer of a cell, ignoring the "(xx%)" note under it: "959530 (89.44%)" → 959530 */
function leadingInt(text) {
    const m = String(text || '').replace(/,/g, '').match(/^\s*(\d+)/);
    return m ? parseInt(m[1], 10) : null;
}

/**
 * Totals of a rendered batch report. The portal computes them itself in the
 * <tfoot>: Total | N Lots | … | Qty Added | Qty Sold | Qty Remaining | | Total
 * Actual Value. The header repeats the seller name, the value and "as of" date.
 * Throws if the value can't be read — a layout change must never become a $0.
 */
export function parseBatchReport(html) {
    const $ = cheerio.load(html);
    const $h3 = $('main h3');
    const vendor = $h3.filter((_, el) => !/^\s*\$/.test($(el).text())).first().text().trim() || null;
    const headerValue = parseMoney($h3.filter((_, el) => /^\s*\$/.test($(el).text())).first().text());
    const asOf = ($('main h4').first().text().match(/as of\s*(\d{4}-\d{2}-\d{2})/i) || [])[1] || null;

    const $cells = $('table tfoot tr').first().find('td');
    const cell = (i) => $cells.eq(i).text();
    const value = $cells.length ? parseMoney(cell($cells.length - 1)) : headerValue;
    if (value == null) throw new Error('Batch report: total value not found (layout changed?)');

    return {
        vendor,
        asOf,
        value,
        lots: $cells.length ? leadingInt(cell(1)) : null,
        qtyAdded: $cells.length ? leadingInt(cell(3)) : null,
        qtySold: $cells.length ? leadingInt(cell(4)) : null,
        pieces: $cells.length ? leadingInt(cell(5)) : null,   // Qty Remaining = still in stock
    };
}

/**
 * Load the batch form, select `vendorKey`'s option and the as-of `date`, POST it
 * and return the rendered report HTML. Throws if the seller isn't in the dropdown
 * rather than silently reading the form's default seller.
 */
export async function generateBatchReport(source, vendorKey, date) {
    const aliases = VENDORS[vendorKey];
    if (!aliases) throw new Error(`Unknown vendor "${vendorKey}"`);

    const { text } = await fetchHtml(source, BATCH_NEW_PATH);
    const $ = cheerio.load(text);
    const $form = $('form').filter((_, el) => /batch_report/.test($(el).attr('action') || '')).first();
    if (!$form.length) throw new Error(`CFB[${source}] batch report form not found`);

    const body = new URLSearchParams();
    let vendorSet = false;
    let dateSet = false;
    const labels = [];
    $form.find('input,select').each((_, el) => {
        const $el = $(el);
        const name = $el.attr('name');
        if (!name) return;
        if (el.tagName === 'select') {
            const $opts = $el.find('option');
            let value = ($el.find('option[selected]').first().attr('value') ?? $opts.first().attr('value')) || '';
            if (/vendor_id/.test(name)) {
                $opts.each((__, o) => { labels.push($(o).text().trim()); });
                const $match = $opts.filter((__, o) => aliases.some((a) => $(o).text().toLowerCase().includes(a))).first();
                if (!$match.length) return;
                value = $match.attr('value');
                vendorSet = true;
            }
            body.set(name, value);
        } else if (/\[date\]$|^date$/.test(name) && date) {
            body.set(name, date);
            dateSet = true;
        } else {
            body.set(name, $el.attr('value') ?? '');
        }
    });
    if (!vendorSet) {
        throw new Error(`CFB[${source}] seller "${vendorKey}" not in the vendor list (${labels.join(', ') || 'empty'})`);
    }
    if (date && !dateSet) throw new Error(`CFB[${source}] batch report form has no date field`);

    const { text: html } = await fetchHtml(source, $form.attr('action') || BATCH_POST_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        redirect: 'follow',
    });
    return html;
}

async function readOne(source, vendorKey, date) {
    const t0 = Date.now();
    const report = parseBatchReport(await generateBatchReport(source, vendorKey, date));
    if (report.asOf && date && report.asOf !== date) {
        throw new Error(`CFB[${source}] ${vendorKey}: report is as of ${report.asOf}, asked ${date}`);
    }
    return { source, vendorKey, ...report, ms: Date.now() - t0 };
}

/**
 * Read both sellers on both portals as of `date` (YYYY-MM-DD) — 4 reports in
 * parallel, ~8 s each — and build the snapshot stored for Alfred. All-or-nothing:
 * any failure (expired cookie, missing seller, unreadable report) throws, so a
 * partial read is never stored as a low inventory.
 *
 * Snapshot: { date, au, binobrick: {cfb, ufb, total}, mljq: {cfb, ufb, total},
 *             fx, detail }. MLJQ's en_preparation is added at read time
 * (functions/inventaire.js) since the laptop may push it after the capture.
 */
export async function captureInventaire({ date }) {
    const jobs = [];
    for (const vendorKey of Object.keys(VENDORS)) {
        for (const source of Object.keys(SOURCE_KEY)) jobs.push(readOne(source, vendorKey, date));
    }
    const [fx, ...reads] = await Promise.all([getUsdCadRate(date), ...jobs]);

    const snapshot = { date, au: torontoIso(), fx, detail: {} };
    for (const r of reads) {
        const cad = r.source === 'US' ? round2(r.value * fx.rate) : round2(r.value);
        const seller = (snapshot[r.vendorKey] ||= { cfb: 0, ufb: 0, total: 0 });
        seller[SOURCE_KEY[r.source]] = cad;
        seller.total = round2(seller.total + cad);
        (snapshot.detail[r.vendorKey] ||= {})[r.source] = {
            label: r.vendor,
            asOf: r.asOf,
            value: r.value,
            currency: r.source === 'US' ? 'USD' : 'CAD',
            cad,
            lots: r.lots,
            pieces: r.pieces,
            ms: r.ms,
        };
    }
    return snapshot;
}

/**
 * The en_preparation entry that applies to an as-of `date`: the latest pushed on or
 * before it, within the same month (stock from a previous month says nothing about
 * this one). Null if the laptop pushed nothing that month.
 */
export function enPreparationFor(entries, date) {
    const month = date.slice(0, 7);
    const best = Object.keys(entries)
        .filter((d) => d <= date && d.slice(0, 7) === month)
        .sort()
        .pop();
    return best ? entries[best] : null;
}

/** Alfred's response shape (amounts in CAD, numbers only). */
export function toAlfred(snapshot, enPreparationEntries) {
    const prep = enPreparationFor(enPreparationEntries, snapshot.date);
    const enPreparation = round2(prep?.value || 0);
    return {
        au: snapshot.au,
        date: snapshot.date,
        binobrick: { ...snapshot.binobrick },
        mljq: {
            cfb: snapshot.mljq.cfb,
            ufb: snapshot.mljq.ufb,
            en_preparation: enPreparation,
            total: round2(snapshot.mljq.total + enPreparation),
        },
        en_preparation_au: prep?.au ?? null,
    };
}
