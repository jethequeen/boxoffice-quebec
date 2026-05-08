/**
 * Posts a daily inventory entry to one or more Google Sheets webhook
 * (Apps Script doPost endpoints).
 *
 * Two destinations are supported during the fiscal-year migration:
 *   - GSHEET_WEBHOOK_URL      (legacy sheet, with optional GSHEET_WEBHOOK_TOKEN)
 *   - GSHEET_WEBHOOK_URL_NEW  (streamlined sheet, with optional GSHEET_WEBHOOK_TOKEN_NEW)
 *
 * Both posts run in parallel; one failure does not abort the other. If at least
 * one target is configured and at least one post succeeds, the call resolves.
 * If every configured target fails, the call rejects with a combined error.
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

export async function postDailyEntry(entry) {
    const targets = [];
    if (process.env.GSHEET_WEBHOOK_URL) {
        targets.push({
            label: 'legacy',
            url: process.env.GSHEET_WEBHOOK_URL,
            token: process.env.GSHEET_WEBHOOK_TOKEN,
        });
    }
    if (process.env.GSHEET_WEBHOOK_URL_NEW) {
        targets.push({
            label: 'new',
            url: process.env.GSHEET_WEBHOOK_URL_NEW,
            token: process.env.GSHEET_WEBHOOK_TOKEN_NEW,
        });
    }
    if (targets.length === 0) {
        throw new Error('No sheets webhook configured (set GSHEET_WEBHOOK_URL and/or GSHEET_WEBHOOK_URL_NEW)');
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
