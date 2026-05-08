import { writeBsx, readBsx, appendInventorySnapshot } from '../lib/blobs.js';
import { parseBsx, serializeBsx, mergeInventory, inventorySummary } from '../lib/bsx.js';
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

    const mode = event.queryStringParameters?.mode;
    if (mode !== 'min' && mode !== 'add') {
        return jsonResponse(400, { error: 'Query param mode=min|add is required.' });
    }

    let xml = event.body || '';
    if (event.isBase64Encoded) xml = Buffer.from(xml, 'base64').toString('utf8');
    if (!xml.includes('<BrickStoreXML')) {
        return jsonResponse(400, { error: 'Body must be the BSX XML content (BrickStoreXML root not found).' });
    }

    const masterXml = await readBsx();
    if (!masterXml) {
        return jsonResponse(412, { error: 'No master inventory.bsx in blob store. Seed it first via /api/seedInventory.' });
    }

    const masterDoc = parseBsx(masterXml);
    let incomingDoc;
    try {
        incomingDoc = parseBsx(xml);
    } catch (e) {
        return jsonResponse(400, { error: `Failed to parse incoming BSX: ${e.message}` });
    }

    const summary = mergeInventory(masterDoc, incomingDoc, mode);
    const newXml = serializeBsx(masterDoc);
    await writeBsx(newXml);

    await appendInventorySnapshot({
        date: todayInTZ(),
        timestamp: new Date().toISOString(),
        source: `merge_${mode}`,
        ...inventorySummary(masterDoc),
    });

    return jsonResponse(200, {
        ok: true,
        mode,
        addedKeys: summary.added.length,
        updatedKeys: summary.updated.length,
        unchangedKeys: summary.unchanged.length,
        bytesWritten: newXml.length,
        details: summary,
    });
};
