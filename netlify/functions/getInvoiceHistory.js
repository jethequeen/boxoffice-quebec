import { readInvoiceHistory } from '../lib/blobs.js';
import { jsonResponse } from '../lib/http.js';

// Invoices carry tax IDs / client info, so the ledger is gated by INGEST_TOKEN
// (unlike the open sales dashboard).
const auth = (event) => {
    const expected = process.env.INGEST_TOKEN;
    if (!expected) return true;
    const got = event.headers?.authorization || event.headers?.Authorization || '';
    return got === `Bearer ${expected}`;
};

export const handler = async (event) => {
    if (!auth(event)) return jsonResponse(401, { error: 'unauthorized' });
    try {
        const history = await readInvoiceHistory();
        // Newest first.
        history.sort((a, b) => String(b.generatedAt || '').localeCompare(String(a.generatedAt || '')));
        return jsonResponse(200, { history });
    } catch (e) {
        console.error('[getInvoiceHistory]', e);
        return jsonResponse(500, { error: e.message });
    }
};
