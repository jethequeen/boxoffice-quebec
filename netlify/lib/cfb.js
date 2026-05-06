import * as cheerio from 'cheerio';

const BASE = 'https://mocs.canadafirstbricks.com';
const REPORT_NEW_PATH = '/bricklink/inventory_vendor_reports/new';

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
    const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers(), ...(init.headers || {}) } });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`CFB request ${path} failed: ${res.status} ${res.statusText} — ${text.slice(0, 200)}`);
    }
    return { text, res };
}

/**
 * Loads the report form page and pulls the CSRF token + form action.
 * Phoenix apps render `_csrf_token` as a hidden input.
 */
export async function loadReportForm() {
    const { text } = await fetchHtml(REPORT_NEW_PATH);
    const $ = cheerio.load(text);
    const csrf =
        $('input[name="_csrf_token"]').attr('value') ||
        $('meta[name="csrf-token"]').attr('content');
    if (!csrf) throw new Error('Could not find CSRF token on report form page');
    const action = $('form').attr('action') || '/bricklink/inventory_vendor_reports';
    return { csrf, action };
}

/**
 * POST the form to generate a report. The site renders the table on the resulting page.
 * Returns the rendered HTML.
 */
export async function generateReport({ extraFields = {} } = {}) {
    const { csrf, action } = await loadReportForm();
    const body = new URLSearchParams({ _csrf_token: csrf, ...extraFields });
    const { text } = await fetchHtml(action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        redirect: 'follow',
    });
    return text;
}

/**
 * Parse rows from the rendered report table. Filters to rows whose date column matches `targetDate` (YYYY-MM-DD).
 *
 * NOTE: Selectors here are best-guess for a Phoenix/Tailwind table. Adjust once we run it live —
 * the function also returns the rawRowCount so we can detect "table parsed but 0 rows" mismatches.
 */
export function parseReportRows(html, targetDate) {
    const $ = cheerio.load(html);
    const rows = [];
    let rawRowCount = 0;

    $('table').find('tbody tr').each((_, tr) => {
        rawRowCount += 1;
        const cells = $(tr).find('td').map((__, td) => $(td).text().trim()).get();
        if (!cells.length) return;

        const lotId = (cells.find((c) => /^\d{8,}$/.test(c)) || '').toString();
        const dateCell = cells.find((c) => /^\d{4}-\d{2}-\d{2}/.test(c));
        const date = dateCell ? dateCell.slice(0, 10) : null;
        if (targetDate && date !== targetDate) return;

        const money = cells.map((c) => {
            const m = c.match(/-?\$?\s*(\d{1,3}(?:[ ,]\d{3})*|\d+)(?:[.,](\d+))?/);
            if (!m) return null;
            const intPart = m[1].replace(/[ ,]/g, '');
            const frac = m[2] || '0';
            return parseFloat(`${intPart}.${frac}`);
        }).filter((n) => n != null && !Number.isNaN(n));

        const qty = (() => {
            for (const c of cells) {
                const m = c.match(/^\s*(\d{1,4})\s*$/);
                if (m) return parseInt(m[1], 10);
            }
            return null;
        })();

        rows.push({
            date,
            lotId,
            qty,
            moneyValues: money,
            cells,
        });
    });

    return { rows, rawRowCount };
}

/**
 * Aggregate parsed rows into the totals we care about.
 * payout / taxes columns are inferred by position; if the report layout shifts, adjust here.
 */
export function aggregateRows(rows) {
    let parts = 0;
    const lots = new Set();
    let payout = 0;
    let taxes = 0;

    for (const r of rows) {
        if (r.lotId) lots.add(r.lotId);
        if (typeof r.qty === 'number') parts += r.qty;
        const m = r.moneyValues || [];
        if (m.length >= 1) payout += m[m.length - 1] || 0;
        if (m.length >= 2) taxes += m[m.length - 2] || 0;
    }

    return {
        parts,
        lots: lots.size,
        payout: Math.round(payout * 100) / 100,
        taxes: Math.round(taxes * 100) / 100,
    };
}

export function decrementsFromRows(rows) {
    const byLot = new Map();
    for (const r of rows) {
        if (!r.lotId || !r.qty) continue;
        byLot.set(r.lotId, (byLot.get(r.lotId) || 0) + r.qty);
    }
    return [...byLot.entries()].map(([lotId, qty]) => ({ lotId, qty }));
}
