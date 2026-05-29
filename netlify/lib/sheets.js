/**
 * Posts a daily inventory entry to one or more Google Sheets webhook
 * (Apps Script doPost endpoints).
 *
 * Two destinations are supported during the fiscal-year migration:
 *   - GSHEET_WEBHOOK_URL_OLD  (existing legacy sheet, with optional GSHEET_WEBHOOK_TOKEN_OLD)
 *   - GSHEET_WEBHOOK_URL_NEW  (future streamlined sheet, with optional GSHEET_WEBHOOK_TOKEN_NEW)
 *
 * Both posts run in parallel; one failure does not abort the other. If at least
 * one target is configured and at least one post succeeds, the call resolves.
 * If every configured target fails, the call rejects with a combined error.
 *
 * Saturdays and Sundays are skipped: CFB only records a sale once the order
 * ships, and shipping never happens on weekends, so any weekend total is
 * either zero or an artefact of a Monday-shipped order. Holidays can't be
 * detected reliably and just produce a legitimate $0 row.
 *
 * The payload includes a `source` field ('CA' | 'US') so the Apps Script
 * downstream can branch tax handling per origin — Canadian and US sales hit
 * the same sheet but follow different fiscal rules. Callers must pass `source`;
 * omitting it defaults to 'CA' to preserve pre-US behaviour for any ad-hoc
 * invocation.
 *
 * The `opts.only` filter accepts 'old' or 'new' to restrict which webhook fires
 * (used by the postOnly backfill mode).
 */
function isWeekendYmd(s) {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return false;
    const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
    return day === 0 || day === 6;
}

async function postOne(label, url, token, entry) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, ...entry }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`[${label}] ${res.status} — ${text.slice(0, 200)}`);
    try {
        return { label, ...JSON.parse(text) };
    } catch {
        return { label, ok: true, raw: text };
    }
}

export async function postDailyEntry(entry, opts = {}) {
    if (isWeekendYmd(entry?.date)) {
        return { ok: true, skipped: 'weekend', date: entry?.date, source: entry?.source };
    }
    const payload = { source: 'CA', ...entry };
    const only = opts.only;
    const targets = [];
    if (process.env.GSHEET_WEBHOOK_URL_OLD && (!only || only === 'old')) {
        targets.push({
            label: 'old',
            url: process.env.GSHEET_WEBHOOK_URL_OLD,
            token: process.env.GSHEET_WEBHOOK_TOKEN_OLD,
        });
    }
    if (process.env.GSHEET_WEBHOOK_URL_NEW && (!only || only === 'new')) {
        targets.push({
            label: 'new',
            url: process.env.GSHEET_WEBHOOK_URL_NEW,
            token: process.env.GSHEET_WEBHOOK_TOKEN_NEW,
        });
    }
    if (targets.length === 0) {
        throw new Error('No sheets webhook configured for this call (only=' + (only || 'any') + ')');
    }

    const results = await Promise.allSettled(
        targets.map((t) => postOne(t.label, t.url, t.token, payload)),
    );

    const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    const failed = results
        .map((r, i) => ({ r, label: targets[i].label }))
        .filter(({ r }) => r.status === 'rejected')
        .map(({ r, label }) => `${label}: ${r.reason?.message || r.reason}`);

    if (ok.length === 0) {
        throw new Error(`All sheets webhooks failed — ${failed.join(' | ')}`);
    }
    return { ok: true, posted: ok, failed };
}
