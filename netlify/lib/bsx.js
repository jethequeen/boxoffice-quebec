import { XMLParser, XMLBuilder } from 'fast-xml-parser';

const parserOpts = {
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    cdataPropName: '__cdata',
    isArray: (name, jpath) => jpath === 'BrickStoreXML.Inventory.Item',
};

const builderOpts = {
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    cdataPropName: '__cdata',
    format: true,
    indentBy: ' ',
    suppressEmptyNode: false,
};

export function parseBsx(xml) {
    const parser = new XMLParser(parserOpts);
    return parser.parse(xml);
}

export function serializeBsx(doc) {
    const builder = new XMLBuilder(builderOpts);
    const xml = builder.build(doc);
    return xml.startsWith('<?xml') ? xml : `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
}

export function getItems(doc) {
    return doc?.BrickStoreXML?.Inventory?.Item ?? [];
}

const compositeKey = (itemId, colorName, condition) =>
    `${String(itemId).trim()}|${String(colorName).trim().toLowerCase()}|${String(condition).trim().toUpperCase().slice(0, 1)}`;

/**
 * Group items by (ItemID, ColorName, Condition). Same key may map to multiple lots
 * (different remarks / sub-conditions / lots from BrickStore).
 */
export function indexByCompositeKey(doc) {
    const map = new Map();
    for (const item of getItems(doc)) {
        if (item.ItemID == null) continue;
        const key = compositeKey(item.ItemID, item.ColorName, item.Condition);
        const list = map.get(key) || [];
        list.push(item);
        map.set(key, list);
    }
    return map;
}

/**
 * Apply decrements to the parsed BSX doc. Mutates in-place.
 * decrements: array of { itemId, colorName, condition, qty }
 *
 * Match strategy:
 *  - Exact match on (itemId, colorName-case-insensitive, condition-first-letter).
 *  - On multi-lot collision (same key spread across multiple BSX <Item> entries),
 *    decrement from the lot with the largest current Qty first, falling through
 *    to the next as needed. Deterministic tie-break by LotID asc.
 *  - If total available across matches is less than requested, decrement all to 0
 *    and report the shortfall in `missing[].shortfall`.
 *
 * Returns { applied: [...], missing: [...] }.
 */
export function applyDecrements(doc, decrements) {
    const byKey = indexByCompositeKey(doc);
    const applied = [];
    const missing = [];

    for (const dec of decrements) {
        const { itemId, colorName, condition, qty } = dec;
        const want = Number(qty || 0);
        if (want <= 0) continue;

        const key = compositeKey(itemId, colorName, condition);
        const lots = byKey.get(key);
        if (!lots || !lots.length) {
            missing.push({ ...dec, reason: 'no_match' });
            continue;
        }

        const sorted = [...lots].sort((a, b) => {
            const qa = Number(a.Qty ?? 0);
            const qb = Number(b.Qty ?? 0);
            if (qb !== qa) return qb - qa;
            return String(a.LotID ?? '').localeCompare(String(b.LotID ?? ''));
        });

        let remaining = want;
        const hits = [];
        for (const item of sorted) {
            if (remaining <= 0) break;
            const before = Number(item.Qty ?? 0);
            const take = Math.min(before, remaining);
            const after = before - take;
            item.Qty = String(after);
            remaining -= take;
            hits.push({ lotId: item.LotID, before, after, taken: take });
        }

        const decrement = want - remaining;
        applied.push({ ...dec, decrement, hits });
        if (remaining > 0) {
            missing.push({ ...dec, reason: 'insufficient_qty', shortfall: remaining });
        }
    }

    return { applied, missing };
}

export function inventorySnapshot(doc) {
    const items = getItems(doc);
    let totalLots = 0;
    let totalParts = 0;
    let totalValue = 0;
    const byCategory = new Map();
    const byColor = new Map();
    const valuableLots = [];

    for (const it of items) {
        const qty = Number(it.Qty ?? 0);
        const price = Number(it.Price ?? 0);
        if (qty <= 0) continue;
        totalLots += 1;
        totalParts += qty;
        totalValue += qty * price;

        const cat = it.CategoryName || 'Unknown';
        const cur = byCategory.get(cat) || { category: cat, lots: 0, parts: 0, value: 0 };
        cur.lots += 1;
        cur.parts += qty;
        cur.value += qty * price;
        byCategory.set(cat, cur);

        const color = it.ColorName || 'Unknown';
        const c = byColor.get(color) || { color, lots: 0, parts: 0, value: 0 };
        c.lots += 1;
        c.parts += qty;
        c.value += qty * price;
        byColor.set(color, c);

        valuableLots.push({
            lotId: it.LotID,
            itemId: it.ItemID,
            colorId: it.ColorID,
            name: it.ItemName,
            color: it.ColorName,
            qty,
            price,
            value: qty * price,
        });
    }

    valuableLots.sort((a, b) => b.value - a.value);

    return {
        totalLots,
        totalParts,
        totalValue: Math.round(totalValue * 100) / 100,
        topCategories: [...byCategory.values()].sort((a, b) => b.value - a.value).slice(0, 10),
        topColors: [...byColor.values()].sort((a, b) => b.value - a.value).slice(0, 10),
        topLots: valuableLots.slice(0, 25),
    };
}
