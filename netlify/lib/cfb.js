import * as cheerio from 'cheerio';
import { readCfbCookies } from './blobs.js';

const REPORT_NEW_PATH = '/bricklink/inventory_vendor_reports/new';
const REPORT_POST_PATH = '/bricklink/inventory_vendor_reports';

/**
 * Thrown when a CFB request lands on the login page — i.e. the session cookie has
 * expired. Callers must treat this distinctly: an expired token used to silently
 * yield an empty report (parsed as a legitimate zero day), which is how 2026-07-03
 * was lost. Now it surfaces so the day can be flagged for backfill and an alert
 * sent instead of recording a false zero.
 */
export class CfbAuthError extends Error {
    constructor(source, detail) {
        super(`CFB[${source}] session expired${detail ? ` — ${detail}` : ''}`);
        this.name = 'CfbAuthError';
        this.source = source;
        this.authExpired = true;
    }
}

/** Heuristic: did this response bounce us to a login page? Returns a reason or null. */
function loginReason(res, html) {
    const finalUrl = (res && res.url) || '';
    if (/\/(login|sign[_-]?in|sessions|users\/sign_in)\b/i.test(finalUrl)) return 'redirected to login';
    const hasReportMarker = /inventory_vendor|vendor_report/i.test(html);
    const hasPasswordField = /<input[^>]+type=["']?password/i.test(html);
    if (hasPasswordField && !hasReportMarker) return 'login form detected';
    return null;
}

/**
 * Both the Canadian (mocs.canadafirstbricks.com) and US (usmocs.canadafirstbricks.com)
 * vendor portals serve the exact same report form / table layout — only the host and
 * the session cookie differ. We key on a short `source` tag ('CA' | 'US') everywhere
 * so sales-history entries, sheet payloads and logs can be told apart for tax handling.
 */
export const SOURCES = {
    CA: { base: 'https://mocs.canadafirstbricks.com',   cookieEnv: 'CFB_COOKIE' },
    US: { base: 'https://usmocs.canadafirstbricks.com', cookieEnv: 'CFB_COOKIE_US' },
};

const siteConfig = (source) => {
    const cfg = SOURCES[source];
    if (!cfg) throw new Error(`Unknown CFB source "${source}" — expected CA or US`);
    return cfg;
};

// Effective session cookie: the runtime-rotated blob value if present, else the
// env var. Lets the token-reset flow swap a cookie without a redeploy.
const cookieHeader = async (source) => {
    const { cookieEnv } = siteConfig(source);
    const cookie = (await readCfbCookies())[source] || process.env[cookieEnv];
    if (!cookie) throw new Error(`No CFB cookie for source=${source} (blob or ${cookieEnv})`);
    return cookie;
};

const headers = async (source, extra = {}) => ({
    Cookie: await cookieHeader(source),
    'User-Agent': 'Mozilla/5.0 (compatible; CineStatsInventoryBot/1.0)',
    Accept: 'text/html,application/xhtml+xml',
    ...extra,
});

async function fetchHtml(source, path, init = {}) {
    const { base } = siteConfig(source);
    const url = path.startsWith('http') ? path : `${base}${path}`;
    const res = await fetch(url, { ...init, headers: { ...(await headers(source)), ...(init.headers || {}) } });
    const text = await res.text();

    // An expired session redirects to (or renders) the login page. Surface it as a
    // typed error instead of letting the parser see zero rows and record a false zero.
    const reason = loginReason(res, text);
    if (reason || res.status === 401 || res.status === 403) {
        throw new CfbAuthError(source, reason || `HTTP ${res.status}`);
    }
    if (!res.ok) {
        throw new Error(`CFB[${source}] request ${path} failed: ${res.status} ${res.statusText} — ${text.slice(0, 200)}`);
    }
    return { text, res };
}

/**
 * Loads /new and pulls CSRF, form action, all named inputs (with defaults),
 * and identifies the start/end-date input names heuristically.
 */
export async function loadReportForm(source = 'CA') {
    const { text } = await fetchHtml(source, REPORT_NEW_PATH);
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
        const tag = (el.tagName || el.name || '').toLowerCase();
        const name = $el.attr('name');
        if (!name || name === '_csrf_token') return;

        let value = '';
        if (tag === 'select') {
            const $selected = $el.find('option[selected]').first();
            const $first = $el.find('option').first();
            const $eff = $selected.length ? $selected : $first;
            value = $eff.attr('value') ?? $eff.text().trim() ?? '';
        } else if (tag === 'textarea') {
            value = $el.text();
        } else {
            const type = ($el.attr('type') || '').toLowerCase();
            if (type === 'checkbox' || type === 'radio') {
                if ($el.attr('checked') == null) return;
                value = $el.attr('value') ?? 'on';
            } else {
                value = $el.attr('value') ?? '';
            }
        }
        if (!(name in fields)) fields[name] = value;

        const inputType = ($el.attr('type') || '').toLowerCase();
        const lower = name.toLowerCase();
        const looksLikeDate = inputType === 'date' || /date/.test(lower);
        if (!startName && looksLikeDate && /\b(start|from|begin)\b/.test(lower)) startName = name;
        if (!endName && looksLikeDate && /\b(end|to|until)\b/.test(lower)) endName = name;
    });

    return { csrf, action, fields, startName, endName };
}

/**
 * POST the form. Always passes startDate/endDate when provided. The server returns
 * a 302 to /bricklink/inventory_vendor_reports/{uuid}; fetch follows it and we get
 * the rendered report HTML.
 */
export async function generateReport({ startDate, endDate, source = 'CA' } = {}) {
    const { csrf, action, fields, startName, endName } = await loadReportForm(source);
    const body = new URLSearchParams();
    body.set('_csrf_token', csrf);
    for (const [k, v] of Object.entries(fields)) body.set(k, v);
    if (startName && startDate) body.set(startName, startDate);
    if (endName && endDate) body.set(endName, endDate);

    const { text } = await fetchHtml(source, action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        redirect: 'follow',
    });
    return { html: text, dateFields: { startName, endName }, source };
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
 * Rows that should appear as sales in the bookkeeping sheet:
 *   - All Platforms rows (BrickLink/BrickOwl/etc — money in, fees taken).
 *   - Manual Outputs rows only when payout > 0. Most manual outputs are
 *     inventory write-offs (decommissioning, gifts) with payout 0; those
 *     should NOT show up as ventes. But a manual output with a positive
 *     payout is a direct sale (e.g. paid in cash outside a platform) and
 *     belongs in the sheet just like a platform sale.
 */
export function isSheetableSale(row) {
    if (row.section === 'Platforms') return true;
    if (row.section === 'Manual Outputs' && Number(row.payout || 0) > 0) return true;
    return false;
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
