import * as cheerio from 'cheerio';

const BASE = 'https://mocs.canadafirstbricks.com';
const REPORT_NEW_PATH = '/bricklink/inventory_vendor_reports/new';
const REPORT_POST_PATH = '/bricklink/inventory_vendor_reports';

const cookieHeader = () => {
    const cookie = process.env.CFB_COOKIE;
    if (!cookie) throw new Error('CFB_COOKIE env var is required');
    return cookie;
};

const headers = (extra = {}) => ({
    Cookie: cookieHeader(),
    'User-Agent': 'Mozilla/5.0 (compatible; CineStatsInventoryBot/1.0)',
    Accept: 'text/html,application/xhtml+xml',
    ...extra,
});

async function fetchHtml(path, init = {}) {
    const url = path.startsWith('http') ? path : `${BASE}${path}`;
    const res = await fetch(url, { ...init, headers: { ...headers(), ...(init.headers || {}) } });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`CFB request ${path} failed: ${res.status} ${res.statusText} — ${text.slice(0, 200)}`);
    }
    return { text, res };
}

/**
 * Loads /new and pulls CSRF, form action, all named inputs (with defaults),
 * and identifies the start/end-date input names heuristically.
 */
export async function loadReportForm() {
    const { text } = await fetchHtml(REPORT_NEW_PATH);
    const $ = cheerio.load(text);

    const csrf =
        $('input[name="_csrf_token"]').first().attr('value') ||
        $('meta[name="csrf-token"]').attr('content');
    if (!csrf) throw new Error('Could not find CSRF token on /new');

    const $form = $('form').filter((_, el) => /vendor_report/.test($(el).attr('action') || '')).first();
    const $effectiveForm = $form.length ? $form : $('form').first();
    const action = $effectiveForm.attr('action') || REPORT_POST_PATH;

    const fields = {};
    let startName = null;
    let endName = null;

    $effectiveForm.find('input,select,textarea').each((_, el) => {
        const $el = $(el);
        const name = $el.attr('name');
        if (!name || name === '_csrf_token') return;
        const value = $el.attr('value') ?? '';
        if (!(name in fields)) fields[name] = value;
        const lower = name.toLowerCase();
        if (!startName && /(start|from|begin)/.test(lower) && /date/.test(lower)) startName = name;
        if (!endName && /(end|to|until)/.test(lower) && /date/.test(lower)) endName = name;
    });

    return { csrf, action, fields, startName, endName };
}

/**
 * POST the form. Always passes startDate/endDate when provided. The server returns
 * a 302 to /bricklink/inventory_vendor_reports/{uuid}; fetch follows it and we get
 * the rendered report HTML.
 */
export async function generateReport({ startDate, endDate } = {}) {
    const { csrf, action, fields, startName, endName } = await loadReportForm();
    const body = new URLSearchParams();
    body.set('_csrf_token', csrf);
    for (const [k, v] of Object.entries(fields)) body.set(k, v);
    if (startName && startDate) body.set(startName, startDate);
    if (endName && endDate) body.set(endName, endDate);

    const { text } = await fetchHtml(action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        redirect: 'follow',
    });
    return { html: text, dateFields: { startName, endName } };
}

const NB_SPACE = / /g;

/** "1,16 $CA" / "1,16 $CA" / "5,64 $CA" → 5.64 */
function parseFrMoney(text) {
    if (!text) return null;
    const cleaned = String(text).replace(NB_SPACE, ' ').replace(/\$CA|CAD|\$/gi, '').trim();
    if (!cleaned) return null;
    const m = cleaned.match(/-?\d{1,3}(?:[  ]\d{3})*(?:,\d+)?|-?\d+(?:,\d+)?/);
    if (!m) return null;
    const v = m[0].replace(/[  ]/g, '').replace(',', '.');
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
}

/** "$0.0552" → 0.0552 */
function parseUsMoney(text) {
    if (!text) return null;
    const m = String(text).replace(/[$\s]/g, '').match(/-?\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
}

function parseIntCell(text) {
    if (text == null) return null;
    const m = String(text).match(/-?\d+/);
    return m ? parseInt(m[0], 10) : null;
}

const normalizeCondition = (raw) => {
    const v = String(raw || '').trim().toLowerCase();
    if (v.startsWith('n')) return 'N';
    if (v.startsWith('u')) return 'U';
    return v.toUpperCase().slice(0, 1);
};

/**
 * Parse rows from every report table on the page. Each row is structured.
 * Tables we expect: "Manual Outputs" and "Platforms" — both share the same column layout:
 *   Date | Source | Type | Item No | Color | Cond | Qty | Price | Total | Payout
 *
 * `dateFilter` may be a YYYY-MM-DD string (exact match) or a function (date) => boolean.
 * Returns { rows, sections, dateRange }.
 */
export function parseReportRows(html, dateFilter = null) {
    const $ = cheerio.load(html);

    const rangeText = $('h4.text-secondary, h4').first().text().trim();
    const rangeMatch = rangeText.match(/(\d{4}-\d{2}-\d{2}).*?(\d{4}-\d{2}-\d{2})/);
    const dateRange = rangeMatch ? { from: rangeMatch[1], to: rangeMatch[2] } : null;

    const matches = (date) => {
        if (!dateFilter) return true;
        if (typeof dateFilter === 'function') return dateFilter(date);
        return date === dateFilter;
    };

    const rows = [];
    const sections = {};

    $('main table.table, table.table').each((_, table) => {
        const $table = $(table);
        const sectionTitle = $table.prevAll('h5').first().text().trim() || 'Unknown';
        sections[sectionTitle] = sections[sectionTitle] || 0;

        $table.find('tbody > tr').each((__, tr) => {
            const $cells = $(tr).find('td');
            if ($cells.length < 10) return;

            const date = $cells.eq(0).text().trim();
            const sourceFull = $cells.eq(1).text().replace(/\s+/g, ' ').trim();
            const sourceMain = $cells.eq(1).contents().filter((___, n) => n.type === 'text').text().trim()
                || sourceFull;
            const sourceNote = $cells.eq(1).find('.form-text').text().trim() || null;
            const type = $cells.eq(2).text().trim();
            const itemId = $cells.eq(3).text().trim();
            const colorName = $cells.eq(4).text().trim();
            const condRaw = $cells.eq(5).text().trim();
            const qty = parseIntCell($cells.eq(6).text());
            const unitPriceUsd = parseUsMoney($cells.eq(7).text());
            const total = parseFrMoney($cells.eq(8).text());
            const payout = parseFrMoney($cells.eq(9).text());

            if (!date || !itemId || qty == null) return;
            if (!matches(date)) return;

            sections[sectionTitle] = (sections[sectionTitle] || 0) + 1;
            rows.push({
                section: sectionTitle,
                date,
                source: sourceMain,
                sourceNote,
                type,
                itemId,
                colorName,
                condition: normalizeCondition(condRaw),
                qty,
                unitPriceUsd,
                total: total ?? 0,
                payout: payout ?? 0,
            });
        });
    });

    return { rows, sections, dateRange };
}

/**
 * Aggregate parsed rows. There is no taxes column in this report — `fees` is total - payout
 * (platform commissions, BL/BO fees, etc.) and may be useful for the sheet log.
 */
export function aggregateRows(rows) {
    let parts = 0;
    let total = 0;
    let payout = 0;
    const lotKeys = new Set();
    const bySection = {};

    for (const r of rows) {
        parts += r.qty;
        total += r.total;
        payout += r.payout;
        lotKeys.add(`${r.itemId}|${r.colorName}|${r.condition}`);
        const s = bySection[r.section] || { parts: 0, total: 0, payout: 0 };
        s.parts += r.qty;
        s.total += r.total;
        s.payout += r.payout;
        bySection[r.section] = s;
    }

    return {
        parts,
        lots: lotKeys.size,
        total: Math.round(total * 100) / 100,
        payout: Math.round(payout * 100) / 100,
        fees: Math.round((total - payout) * 100) / 100,
        bySection,
    };
}

/**
 * Collapse rows into per-(itemId, colorName, condition) decrements. Multiple report rows
 * for the same lot key (e.g. multi-order same part same day) are summed.
 */
export function decrementsFromRows(rows) {
    const map = new Map();
    for (const r of rows) {
        const key = `${r.itemId}|${r.colorName}|${r.condition}`;
        const cur = map.get(key) || {
            itemId: r.itemId,
            colorName: r.colorName,
            condition: r.condition,
            qty: 0,
            occurrences: 0,
        };
        cur.qty += r.qty;
        cur.occurrences += 1;
        map.set(key, cur);
    }
    return [...map.values()];
}
