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
 * The `opts.only` filter accepts 'old' or 'new' to restrict which webhook fires
 * (used by the postOnly backfill mode).
 */
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
        targets.map((t) => postOne(t.label, t.url, t.token, entry)),
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
