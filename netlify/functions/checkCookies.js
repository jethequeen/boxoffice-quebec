import { SOURCES, checkSession } from '../lib/cfb.js';
import { readPendingBackfill } from '../lib/blobs.js';
import { sendAuthExpiredEmail } from '../lib/email.js';
import { jsonResponse } from '../lib/http.js';

// Reuses the INGEST_TOKEN bearer scheme (same operator secret as the other tools).
const auth = (event) => {
    const expected = process.env.INGEST_TOKEN;
    if (!expected) return true;
    const got = event.headers?.authorization || event.headers?.Authorization || '';
    return got === `Bearer ${expected}`;
};

/**
 * Probe both CFB sessions (CA + US). For any expired one, fire the existing
 * token-reset flow: email a signed magic link to the reset page. Returns per-source
 * status so a "Test cookies" button can show the result.
 *
 * Query: ?reset=0 to only report status without sending any reset email.
 */
export const handler = async (event) => {
    if (!auth(event)) return jsonResponse(401, { error: 'unauthorized' });

    const sendReset = (event.queryStringParameters || {}).reset !== '0';
    const results = [];

    for (const source of Object.keys(SOURCES)) {
        const res = await checkSession(source);
        if (!res.ok && res.authExpired && sendReset) {
            try {
                const missed = (await readPendingBackfill()).filter((p) => p.source === source);
                await sendAuthExpiredEmail({ source, missed });
                res.resetEmailSent = true;
            } catch (e) {
                res.resetEmailSent = false;
                res.resetEmailError = e.message;
            }
        }
        results.push(res);
    }

    const allOk = results.every((r) => r.ok);
    return jsonResponse(200, { allOk, results });
};
