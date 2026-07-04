import { loadReportForm, CfbAuthError } from '../lib/cfb.js';
import {
    readCfbCookies,
    writeCfbCookie,
    readPendingBackfill,
} from '../lib/blobs.js';
import { verify } from '../lib/signing.js';

/**
 * CFB token-reset page. Reached from the "session expired" alert email via a
 * signed, expiring magic link (see lib/email.js).
 *
 *   GET  /api/cfbToken?token=…  → renders a form to paste the fresh session cookie.
 *   POST /api/cfbToken          → verifies the link, validates the pasted cookie
 *                                 against CFB, saves it (blob, no redeploy), and
 *                                 backfills the days that were missed during the
 *                                 outage — then reports what happened.
 *
 * The cookie is validated by writing it, then hitting CFB once: a fresh cookie
 * loads the report form, an expired one throws CfbAuthError and we roll back.
 */

const html = (statusCode, body) => ({
    statusCode,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
        + `<title>CFB — Reset token</title>`
        + `<style>body{font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:620px;margin:40px auto;padding:0 16px;color:#1a1a1a}`
        + `textarea{width:100%;min-height:120px;font-family:ui-monospace,monospace;font-size:13px;padding:10px;box-sizing:border-box}`
        + `button{background:#2b7a2b;color:#fff;border:0;padding:12px 20px;border-radius:6px;font-weight:600;font-size:15px;cursor:pointer}`
        + `.err{color:#b00020}.ok{color:#2b7a2b}code{background:#f2f2f2;padding:1px 5px;border-radius:4px}</style>`
        + body,
});

const parseBody = (event) => {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
    const ct = (event.headers?.['content-type'] || event.headers?.['Content-Type'] || '').toLowerCase();
    if (ct.includes('application/json')) {
        try { return JSON.parse(raw); } catch { return {}; }
    }
    return Object.fromEntries(new URLSearchParams(raw));
};

const formPage = (token, source, notice = '') => html(200, `
    <h2>Reset du token CFB${source ? ` — ${source}` : ''}</h2>
    ${notice}
    <p>Colle ci-dessous le nouveau cookie de session (l’entête <code>Cookie</code> complet
       depuis ton navigateur sur mocs.canadafirstbricks.com).</p>
    <form method="POST" action="/api/cfbToken">
      <input type="hidden" name="token" value="${token}">
      <textarea name="cookie" placeholder="_session_id=…; autre=…" required></textarea>
      <p><button type="submit">Soumettre le nouveau token &amp; backfiller</button></p>
    </form>`);

// Kick off the sequential backfill in a background function (15-min budget) — a
// multi-day drain would blow this synchronous function's timeout, and the ingests
// must run one at a time to avoid racing on inventory.bsx. Returns the days queued.
async function triggerBackfill(source) {
    const pending = (await readPendingBackfill()).filter((p) => p.source === source);
    if (pending.length === 0) return pending;

    const base = (process.env.URL || 'https://boxofficequebec.netlify.app').replace(/\/$/, '');
    const authHeader = process.env.INGEST_TOKEN ? { Authorization: `Bearer ${process.env.INGEST_TOKEN}` } : {};
    // Background functions return 202 immediately, then keep running.
    await fetch(`${base}/.netlify/functions/backfill-background?source=${source}`, {
        method: 'POST',
        headers: authHeader,
    });
    return pending;
}

export const handler = async (event) => {
    const method = event.httpMethod;

    if (method === 'GET') {
        const token = event.queryStringParameters?.token || '';
        try {
            const { source } = verify(token);
            return formPage(token, source);
        } catch (e) {
            return html(403, `<h2 class="err">Lien invalide ou expiré</h2><p>${e.message}. Relance l’ingestion pour recevoir un nouveau courriel.</p>`);
        }
    }

    if (method !== 'POST') return html(405, '<h2>Method not allowed</h2>');

    const { token, cookie } = parseBody(event);
    let source;
    try {
        ({ source } = verify(token));
    } catch (e) {
        return html(403, `<h2 class="err">Lien invalide ou expiré</h2><p>${e.message}.</p>`);
    }
    if (!cookie || !cookie.trim()) {
        return formPage(token, source, '<p class="err">Le cookie est vide.</p>');
    }

    // Save, then validate against CFB. Roll back if the new cookie is still rejected.
    const previous = (await readCfbCookies())[source];
    await writeCfbCookie(source, cookie.trim());
    try {
        await loadReportForm(source);
    } catch (e) {
        if (e instanceof CfbAuthError || e.authExpired) {
            // Restore the prior cookie; if there was none, blank it so the env var
            // fallback applies again (never leave a known-bad cookie in the blob).
            await writeCfbCookie(source, previous || '');
            return formPage(token, source, '<p class="err">Ce cookie mène encore à la page de login — non enregistré. Réessaie avec un cookie frais.</p>');
        }
        // Non-auth error (e.g. CFB down): keep the cookie, skip backfill, warn.
        return html(200, `<h2 class="ok">Token enregistré</h2>
            <p>Impossible de vérifier/backfiller pour l’instant (<code>${e.message}</code>).
               Le token est sauvegardé&nbsp;; relance le backfill plus tard via <code>runIngestNow</code>.</p>`);
    }

    let queued = [];
    try {
        queued = await triggerBackfill(source);
    } catch (e) {
        return html(200, `<h2 class="ok">✅ Token ${source} mis à jour</h2>
            <p>Le token est enregistré, mais le lancement du backfill a échoué (<code>${e.message}</code>).
               Relance-le via <code>runIngestNow</code> pour les journées manquées.</p>`);
    }

    const queuedList = queued.length
        ? `<p>Backfill lancé en arrière-plan pour&nbsp;:</p><ul>${queued.map((d) => `<li>${d.date}</li>`).join('')}</ul>
           <p style="color:#666;font-size:13px">Vérifie l’ancienne feuille / le dashboard d’ici quelques minutes.</p>`
        : '<p>Aucune journée en attente de backfill.</p>';

    return html(200, `
        <h2 class="ok">✅ Token ${source} mis à jour</h2>
        ${queuedList}`);
};
