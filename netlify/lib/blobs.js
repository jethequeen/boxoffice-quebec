import { getStore } from '@netlify/blobs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const STORE_NAME = 'inventory';
const BSX_KEY = 'inventory.bsx';
const SALES_KEY = 'sales-history.json';

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

export async function hasSalesEntryForDate(date) {
    const history = await readSalesHistory();
    return history.some((e) => e?.date === date);
}
