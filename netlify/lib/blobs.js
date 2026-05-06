import { getStore } from '@netlify/blobs';

const STORE_NAME = 'inventory';
const BSX_KEY = 'inventory.bsx';
const SALES_KEY = 'sales-history.json';

const store = () => getStore({ name: STORE_NAME, consistency: 'strong' });

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
