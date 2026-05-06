import { readBsx, readSalesHistory } from '../lib/blobs.js';
import { parseBsx, inventorySnapshot, getItems } from '../lib/bsx.js';
import { jsonResponse } from '../lib/http.js';

const ymd = (d) => {
    const dt = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return null;
    return dt.toISOString().slice(0, 10);
};

const isoWeek = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00Z');
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
};

const monthKey = (dateStr) => dateStr.slice(0, 7);

function bucketSales(history) {
    const day = new Map();
    const week = new Map();
    const month = new Map();
    const lotTotals = new Map();

    for (const e of history) {
        const date = ymd(e.date);
        if (!date) continue;
        const totals = { parts: e.parts || 0, lots: e.lots || 0, payout: e.payout || 0, taxes: e.taxes || 0 };
        accumulate(day, date, totals);
        accumulate(week, isoWeek(date), totals);
        accumulate(month, monthKey(date), totals);
        for (const a of e.applied || []) {
            const key = String(a.lotId);
            const cur = lotTotals.get(key) || { lotId: a.lotId, partsSold: 0, occurrences: 0 };
            cur.partsSold += Number(a.decrement || 0);
            cur.occurrences += 1;
            lotTotals.set(key, cur);
        }
    }

    return {
        daily: [...day.entries()].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => a.key.localeCompare(b.key)),
        weekly: [...week.entries()].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => a.key.localeCompare(b.key)),
        monthly: [...month.entries()].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => a.key.localeCompare(b.key)),
        lotTotals,
    };
}

function accumulate(map, key, totals) {
    const cur = map.get(key) || { parts: 0, lots: 0, payout: 0, taxes: 0 };
    cur.parts += totals.parts;
    cur.lots += totals.lots;
    cur.payout += totals.payout;
    cur.taxes += totals.taxes;
    map.set(key, cur);
}

function topSellers(lotTotals, doc) {
    const items = getItems(doc);
    const byLot = new Map();
    for (const it of items) if (it.LotID != null) byLot.set(String(it.LotID), it);
    const enriched = [...lotTotals.values()]
        .map((t) => {
            const it = byLot.get(String(t.lotId));
            return {
                lotId: t.lotId,
                partsSold: t.partsSold,
                occurrences: t.occurrences,
                name: it?.ItemName || '(removed lot)',
                color: it?.ColorName || null,
                category: it?.CategoryName || null,
                price: Number(it?.Price ?? 0),
            };
        })
        .sort((a, b) => b.partsSold - a.partsSold);
    return enriched.slice(0, 25);
}

export const handler = async () => {
    try {
        const bsx = await readBsx();
        if (!bsx) return jsonResponse(404, { error: 'No inventory yet. Seed via /api/seedInventory.' });
        const doc = parseBsx(bsx);
        const snapshot = inventorySnapshot(doc);

        const history = await readSalesHistory();
        const buckets = bucketSales(history);
        const top = topSellers(buckets.lotTotals, doc);

        return jsonResponse(200, {
            inventory: snapshot,
            sales: {
                daily: buckets.daily,
                weekly: buckets.weekly,
                monthly: buckets.monthly,
                topSellers: top,
                latestEntry: history[history.length - 1] || null,
                entryCount: history.length,
            },
        });
    } catch (e) {
        console.error('[getInventorySnapshot]', e);
        return jsonResponse(500, { error: e.message });
    }
};
