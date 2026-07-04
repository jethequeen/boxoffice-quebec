import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Tiny signed-token helper for the CFB token-reset magic link.
 *
 * The alert email links to a public page that lets whoever opens it overwrite the
 * CFB session cookie — so the link must be unforgeable and short-lived. We sign a
 * small JSON payload (source + expiry) with HMAC-SHA256 using CFB_TOKEN_SIGNING_SECRET
 * and append it to the URL. Both the form GET and the submit POST verify it before
 * doing anything.
 *
 * Format: base64url(JSON payload) + "." + base64url(HMAC). Self-contained, no state.
 */

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64url = (s) => Buffer.from(s, 'base64url');

function secret() {
    const s = process.env.CFB_TOKEN_SIGNING_SECRET;
    if (!s) throw new Error('CFB_TOKEN_SIGNING_SECRET env var is required');
    return s;
}

function hmac(payloadB64) {
    return createHmac('sha256', secret()).update(payloadB64).digest();
}

/** Sign a payload. `ttlMs` defaults to 48h — long enough to react to an alert. */
export function sign(payload, ttlMs = 48 * 3600 * 1000) {
    const body = { ...payload, exp: Date.now() + ttlMs };
    const payloadB64 = b64url(JSON.stringify(body));
    return `${payloadB64}.${b64url(hmac(payloadB64))}`;
}

/**
 * Verify a token. Returns the payload object if the signature is valid and the
 * token has not expired; throws otherwise. Constant-time signature compare.
 */
export function verify(token) {
    const [payloadB64, sigB64] = String(token || '').split('.');
    if (!payloadB64 || !sigB64) throw new Error('malformed token');

    const expected = hmac(payloadB64);
    const got = fromB64url(sigB64);
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
        throw new Error('bad signature');
    }

    const payload = JSON.parse(fromB64url(payloadB64).toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) throw new Error('token expired');
    return payload;
}
