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

const lotKey = (lotId) => String(lotId);

export function indexByLot(doc) {
    const map = new Map();
    for (const item of getItems(doc)) {
        if (item.LotID != null) map.set(lotKey(item.LotID), item);
    }
    return map;
}

/**
 * Apply per-lot decrements to the parsed BSX doc. Mutates in-place.
 * decrements: array of { lotId, qty }
 * Returns { applied: [...], missing: [...] } so the caller can log misses.
 */
export function applyDecrements(doc, decrements) {
    const byLot = indexByLot(doc);
    const applied = [];
    const missing = [];
    for (const { lotId, qty } of decrements) {
        const item = byLot.get(lotKey(lotId));
        if (!item) {
            missing.push({ lotId, qty });
            continue;
        }
        const before = Number(item.Qty ?? 0);
        const after = Math.max(0, before - Number(qty || 0));
        item.Qty = String(after);
        applied.push({ lotId, before, after, decrement: Number(qty || 0) });
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
