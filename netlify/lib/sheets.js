/**
 * Posts a daily inventory entry to a Google Sheets webhook (Apps Script doPost endpoint).
 * Configure GSHEET_WEBHOOK_URL and (optional) GSHEET_WEBHOOK_TOKEN in Netlify env.
 */
export async function postDailyEntry(entry) {
    const url = process.env.GSHEET_WEBHOOK_URL;
    if (!url) throw new Error('GSHEET_WEBHOOK_URL env var is required');
    const token = process.env.GSHEET_WEBHOOK_TOKEN;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, ...entry }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Sheets webhook failed: ${res.status} — ${text.slice(0, 200)}`);
    try {
        return JSON.parse(text);
    } catch {
        return { ok: true, raw: text };
    }
}
