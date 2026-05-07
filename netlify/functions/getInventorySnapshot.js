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

const sellerKey = (itemId, colorName, condition) =>
    `${String(itemId).trim()}|${String(colorName).trim().toLowerCase()}|${String(condition).trim().toUpperCase().slice(0, 1)}`;

function accumulate(map, key, totals) {
    const cur = map.get(key) || { parts: 0, lots: 0, total: 0, payout: 0, fees: 0 };
    cur.parts += totals.parts;
    cur.lots += totals.lots;
    cur.total += totals.total;
    cur.payout += totals.payout;
    cur.fees += totals.fees;
    map.set(key, cur);
}

function bucketSales(history) {
    const day = new Map();
    const week = new Map();
    const month = new Map();
    const sellers = new Map();

    for (const e of history) {
        const date = ymd(e.date);
        if (!date) continue;
        const totals = {
            parts: e.parts || 0,
            lots: e.lots || 0,
            total: e.total || 0,
            payout: e.payout || 0,
            fees: e.fees || 0,
        };
        accumulate(day, date, totals);
        accumulate(week, isoWeek(date), totals);
        accumulate(month, monthKey(date), totals);

        for (const a of e.applied || []) {
            if (a.itemId == null) continue;
            const key = sellerKey(a.itemId, a.colorName, a.condition);
            const cur = sellers.get(key) || {
                itemId: a.itemId,
                colorName: a.colorName,
                condition: a.condition,
                partsSold: 0,
                occurrences: 0,
            };
            cur.partsSold += Number(a.decrement || 0);
            cur.occurrences += 1;
            sellers.set(key, cur);
        }
    }

    const flat = (m) => [...m.entries()]
        .map(([k, v]) => ({ key: k, ...v }))
        .sort((a, b) => a.key.localeCompare(b.key));

    return {
        daily: flat(day),
        weekly: flat(week),
        monthly: flat(month),
        sellers,
    };
}

function topSellers(sellers, doc) {
    const items = getItems(doc);
    const byKey = new Map();
    for (const it of items) {
        if (it.ItemID == null) continue;
        const k = sellerKey(it.ItemID, it.ColorName, it.Condition);
        if (!byKey.has(k)) byKey.set(k, it);
    }
    return [...sellers.values()]
        .map((s) => {
            const k = sellerKey(s.itemId, s.colorName, s.condition);
            const it = byKey.get(k);
            return {
                itemId: s.itemId,
                colorName: s.colorName,
                condition: s.condition,
                partsSold: s.partsSold,
                occurrences: s.occurrences,
                name: it?.ItemName || '(removed lot)',
                category: it?.CategoryName || null,
                price: Number(it?.Price ?? 0),
                qtyOnHand: Number(it?.Qty ?? 0),
            };
        })
        .sort((a, b) => b.partsSold - a.partsSold)
        .slice(0, 25);
}

export const handler = async () => {
    try {
        const bsx = await readBsx();
        if (!bsx) return jsonResponse(404, { error: 'No inventory yet. Seed via /api/seedInventory.' });
        const doc = parseBsx(bsx);
        const snapshot = inventorySnapshot(doc);

        const history = await readSalesHistory();
        const buckets = bucketSales(history);
        const top = topSellers(buckets.sellers, doc);

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
