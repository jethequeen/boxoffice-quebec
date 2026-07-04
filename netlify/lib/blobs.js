import { getStore } from '@netlify/blobs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const STORE_NAME = 'inventory';
const BSX_KEY = 'inventory.bsx';
const SALES_KEY = 'sales-history.json';
const INV_HISTORY_KEY = 'inventory-history.json';
const COOKIES_KEY = 'cfb-cookies.json';
const PENDING_BACKFILL_KEY = 'pending-backfill.json';

/**
 * Local filesystem store — used in dev when BLOBS_LOCAL_DIR is set.
 * Implements the subset of the Netlify Blobs API we actually use.
 */
function localStore(dir) {
    const root = resolve(dir);
    const path = (key) => join(root, key);

    return {
        async get(key, opts = {}) {
            try {
                const buf = await readFile(path(key));
                const text = buf.toString('utf8');
                if (opts.type === 'json') return text ? JSON.parse(text) : null;
                return text;
            } catch (e) {
                if (e.code === 'ENOENT') return null;
                throw e;
            }
        },
        async set(key, value) {
            const full = path(key);
            await mkdir(dirname(full), { recursive: true });
            await writeFile(full, value);
        },
        async setJSON(key, value) {
            await this.set(key, JSON.stringify(value, null, 2));
        },
    };
}

const store = () => {
    if (process.env.BLOBS_LOCAL_DIR) {
        return localStore(process.env.BLOBS_LOCAL_DIR);
    }
    const opts = { name: STORE_NAME, consistency: 'strong' };
    const siteID = process.env.NETLIFY_SITE_ID;
    const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN;
    if (siteID && token) {
        opts.siteID = siteID;
        opts.token = token;
    }
    return getStore(opts);
};

export async function readBsx() {
    return (await store().get(BSX_KEY, { type: 'text' })) ?? null;
}

export async function writeBsx(xml) {
    await store().set(BSX_KEY, xml);
}

export async function readSalesHistory() {
    const raw = await store().get(SALES_KEY, { type: 'json' });
    return Array.isArray(raw) ? raw : [];
}

export async function writeSalesHistory(history) {
    await store().setJSON(SALES_KEY, history);
}

export async function appendSalesEntry(entry) {
    const history = await readSalesHistory();
    history.push(entry);
    await writeSalesHistory(history);
    return history;
}

/**
 * Idempotency check for the daily ingest. We now write one entry per source
 * (CA + US) per day, so the predicate has to match BOTH date and source. Legacy
 * entries written before the US flow existed have no `source` field — those are
 * treated as 'CA' so re-running yesterday's CA ingest still short-circuits.
 */
export async function hasSalesEntryForDate(date, source = 'CA') {
    const history = await readSalesHistory();
    return history.some((e) => e?.date === date && (e?.source || 'CA') === source);
}

export async function findSalesEntriesForDate(date, source = 'CA') {
    const history = await readSalesHistory();
    return history.filter((e) => e?.date === date && (e?.source || 'CA') === source);
}

/**
 * Drop every sales-history entry for (date, source). Used by the `replace` ingest
 * mode to correct a false-zero day (one recorded while the token was expired)
 * before re-ingesting the real numbers. Returns how many entries were removed.
 */
export async function removeSalesEntriesForDate(date, source = 'CA') {
    const history = await readSalesHistory();
    const keep = history.filter((e) => !(e?.date === date && (e?.source || 'CA') === source));
    const removed = history.length - keep.length;
    if (removed) await writeSalesHistory(keep);
    return removed;
}

export async function readInventoryHistory() {
    const raw = await store().get(INV_HISTORY_KEY, { type: 'json' });
    return Array.isArray(raw) ? raw : [];
}

export async function writeInventoryHistory(history) {
    await store().setJSON(INV_HISTORY_KEY, history);
}

export async function appendInventorySnapshot(snapshot) {
    const history = await readInventoryHistory();
    history.push(snapshot);
    await store().setJSON(INV_HISTORY_KEY, history);
    return history;
}

/**
 * CFB session cookies, rotated at runtime via the token-reset flow. Stored as
 * { CA, US, updatedAt }. The effective cookie for a source is the blob value if
 * present, else the env var (CFB_COOKIE / CFB_COOKIE_US) — so a fresh deploy with
 * only env vars still works, and a rotated cookie survives without a redeploy.
 */
export async function readCfbCookies() {
    const raw = await store().get(COOKIES_KEY, { type: 'json' });
    return raw && typeof raw === 'object' ? raw : {};
}

export async function writeCfbCookie(source, cookie) {
    const cookies = await readCfbCookies();
    cookies[source] = cookie;
    cookies.updatedAt = new Date().toISOString();
    await store().setJSON(COOKIES_KEY, cookies);
    return cookies;
}

/**
 * Days that a job could not ingest because the CFB session had expired. Keyed by
 * `${date}|${source}` so a partial outage (one source down) is tracked precisely.
 * The token-reset flow drains this once a fresh cookie is accepted.
 */
export async function readPendingBackfill() {
    const raw = await store().get(PENDING_BACKFILL_KEY, { type: 'json' });
    return Array.isArray(raw) ? raw : [];
}

export async function addPendingBackfill(date, source) {
    const pending = await readPendingBackfill();
    if (!pending.some((p) => p.date === date && p.source === source)) {
        pending.push({ date, source, addedAt: new Date().toISOString() });
        await store().setJSON(PENDING_BACKFILL_KEY, pending);
    }
    return pending;
}

/** Remove the given {date, source} pairs from the pending queue. */
export async function clearPendingBackfill(done) {
    const doneKeys = new Set(done.map((d) => `${d.date}|${d.source}`));
    const remaining = (await readPendingBackfill()).filter(
        (p) => !doneKeys.has(`${p.date}|${p.source}`),
    );
    await store().setJSON(PENDING_BACKFILL_KEY, remaining);
    return remaining;
}
