import { writeBsx, readBsx, appendInventorySnapshot } from '../lib/blobs.js';
import { parseBsx, inventorySummary } from '../lib/bsx.js';
import { jsonResponse } from '../lib/http.js';

const todayInTZ = (tz = 'America/Toronto') => {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    return fmt.format(new Date());
};

const auth = (event) => {
    const expected = process.env.INGEST_TOKEN;
    if (!expected) return true;
    const got = event.headers?.authorization || event.headers?.Authorization || '';
    return got === `Bearer ${expected}`;
};

export const handler = async (event) => {
    if (!auth(event)) return jsonResponse(401, { error: 'unauthorized' });
    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'POST required' });

    const force = (event.queryStringParameters?.force || '') === '1';
    if (!force) {
        const existing = await readBsx();
        if (existing) {
            return jsonResponse(409, {
                error: 'inventory.bsx already exists. Pass ?force=1 to overwrite.',
                length: existing.length,
            });
        }
    }

    let xml = event.body || '';
    if (event.isBase64Encoded) xml = Buffer.from(xml, 'base64').toString('utf8');
    if (!xml.includes('<BrickStoreXML')) {
        return jsonResponse(400, { error: 'Body must be the BSX XML content (BrickStoreXML root not found).' });
    }

    await writeBsx(xml);

    try {
        const doc = parseBsx(xml);
        await appendInventorySnapshot({
            date: todayInTZ(),
            timestamp: new Date().toISOString(),
            source: 'seed',
            ...inventorySummary(doc),
        });
    } catch (e) {
        console.warn('[seedInventory] snapshot failed', e.message);
    }

    return jsonResponse(200, { ok: true, length: xml.length });
};
