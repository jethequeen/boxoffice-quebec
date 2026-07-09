import { sign } from './signing.js';

/**
 * Transactional email via the Resend HTTP API (no SDK — a single fetch).
 * Requires RESEND_API_KEY and ALERT_EMAIL_FROM (a Resend-verified sender). `to`
 * defaults to ALERT_EMAIL_TO when omitted.
 *
 * `attachments` is an optional array of { filename, content } where `content` is a
 * Buffer or a base64 string — Resend takes attachments as base64 in the JSON body.
 */
async function sendEmail({ subject, html, to, attachments } = {}) {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.ALERT_EMAIL_FROM;
    const recipient = to || process.env.ALERT_EMAIL_TO;
    if (!apiKey || !from || !recipient) {
        throw new Error('Email not configured (RESEND_API_KEY / ALERT_EMAIL_FROM / recipient)');
    }

    const payload = { from, to: recipient, subject, html };
    if (Array.isArray(attachments) && attachments.length) {
        payload.attachments = attachments.map((a) => ({
            filename: a.filename,
            content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : a.content,
        }));
    }

    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`Resend ${res.status} — ${body.slice(0, 200)}`);
    return { ok: true };
}

/**
 * Email the monthly invoices with their PDFs attached. `attachments` is an array of
 * { filename, content:Buffer }. Recipient defaults to ALERT_EMAIL_TO when `to` is
 * falsy (the invoiceConfig resolves the intended recipient before calling).
 */
export async function sendInvoiceEmail({ to, subject, html, attachments }) {
    return sendEmail({ to, subject, html, attachments });
}

const siteUrl = () =>
    (process.env.PUBLIC_SITE_URL || process.env.URL || 'https://boxofficequebec.netlify.app').replace(/\/$/, '');

/**
 * Alert that a CFB session expired, with a signed magic link to the token-reset
 * page. `missed` is the list of {date, source} pairs queued for backfill.
 */
export async function sendAuthExpiredEmail({ source, missed = [] }) {
    const token = sign({ source });
    const link = `${siteUrl()}/api/cfbToken?token=${encodeURIComponent(token)}`;
    const missedList = missed.length
        ? `<ul>${missed.map((m) => `<li>${m.date} (${m.source})</li>`).join('')}</ul>`
        : '<p><em>Aucune journée en attente pour l’instant.</em></p>';

    const html = `
        <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:560px;margin:auto">
          <h2>🔒 Token CFB expiré — source ${source}</h2>
          <p>L’ingestion a rencontré la page de login&nbsp;: le cookie de session
             <strong>${source}</strong> (mocs.canadafirstbricks.com) est expiré.</p>
          <p>Journées en attente de backfill&nbsp;:</p>
          ${missedList}
          <p style="margin:28px 0">
            <a href="${link}"
               style="background:#2b7a2b;color:#fff;padding:12px 20px;border-radius:6px;
                      text-decoration:none;font-weight:600;display:inline-block">
              Soumettre le nouveau token &amp; backfiller
            </a>
          </p>
          <p style="color:#666;font-size:13px">Ce lien expire dans 48&nbsp;heures.
             Si le bouton ne fonctionne pas, copie&nbsp;: <br>${link}</p>
        </div>`;

    return sendEmail({ subject: `🔒 Token CFB expiré (${source}) — action requise`, html });
}
