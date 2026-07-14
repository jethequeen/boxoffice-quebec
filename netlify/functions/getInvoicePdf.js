import { readInvoicePdfBase64 } from '../lib/blobs.js';
import { jsonResponse } from '../lib/http.js';

const auth = (event) => {
    const expected = process.env.INGEST_TOKEN;
    if (!expected) return true;
    const got = event.headers?.authorization || event.headers?.Authorization || '';
    return got === `Bearer ${expected}`;
};

/**
 * Return a previously-emitted invoice PDF for re-download. `?number=UFB-2026-06`.
 * The body is base64 with isBase64Encoded so Netlify serves it as a real PDF.
 */
export const handler = async (event) => {
    if (!auth(event)) return jsonResponse(401, { error: 'unauthorized' });

    const number = (event.queryStringParameters || {}).number || '';
    if (!/^[A-Za-z0-9_-]+$/.test(number)) {
        return jsonResponse(400, { error: 'Invalid or missing "number"' });
    }

    try {
        const b64 = await readInvoicePdfBase64(number);
        if (!b64) return jsonResponse(404, { error: `No stored PDF for ${number}` });
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${number}.pdf"`,
                'Access-Control-Allow-Origin': '*',
            },
            body: b64,
            isBase64Encoded: true,
        };
    } catch (e) {
        console.error('[getInvoicePdf]', e);
        return jsonResponse(500, { error: e.message });
    }
};
