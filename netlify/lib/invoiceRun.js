/**
 * Orchestration for the monthly invoice run — shared by the scheduled function
 * (monthlyInvoice-background.js) and the on-demand endpoint (runInvoiceNow.js) so
 * the two behave identically.
 *
 * Reads the sales-history blob, fetches the invoice-day USD→CAD rate (for the UFB
 * conversion), builds both invoice models, renders their PDFs, and emails them to
 * the configured recipient with the PDFs attached. `dryRun` does everything except
 * send the email (and still returns the computed amounts + PDF byte sizes).
 */

import { readSalesHistory } from './blobs.js';
import { getUsdCadRate } from './fx.js';
import { buildInvoices, monthRange } from './invoice.js';
import { renderInvoicePdf } from './invoicePdf.js';
import { sendInvoiceEmail } from './email.js';
import { INVOICE_EMAIL_TO, isDraftConfig } from './invoiceConfig.js';

const cad = (n) =>
    new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(Number(n) || 0);

/** One-line summary of an invoice for the email body / log. */
const summarize = (inv) => ({
    number: inv.number,
    store: inv.store,
    parts: inv.sales.parts,
    grossCad: inv.sales.grossCad,
    grossUsd: inv.conversion?.grossUsd ?? null,
    effectiveRate: inv.conversion?.effectiveRate ?? null,
    total: inv.amounts.total,
});

function emailHtml({ label, period, invoices, draft }) {
    const row = (inv) => `
        <tr>
          <td style="padding:6px 12px;border-bottom:1px solid #eee">${inv.number}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #eee">${inv.store}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right">${inv.sales.parts}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right">${cad(inv.sales.grossCad)}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right"><strong>${cad(inv.amounts.total)}</strong></td>
        </tr>`;
    const draftWarn = draft
        ? `<p style="background:#fff3cd;border:1px solid #ffe08a;padding:10px 14px;border-radius:6px;color:#7a5b00">
             ⚠️ <strong>Brouillon</strong> — les coordonnées légales / numéros TPS-TVQ ne sont pas encore
             configurés (variables INVOICE_*). Les PDF portent la mention « BROUILLON ». À finaliser avant envoi au client.
           </p>`
        : '';
    return `
      <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:640px;margin:auto;color:#1a1a1a">
        <h2>Factures — ${label}</h2>
        <p>Période couverte : <strong>${label}</strong> (du ${period.start} au ${period.end}). Deux factures ci-jointes, adressées à Canada First Bricks, en CAD.</p>
        ${draftWarn}
        <table style="border-collapse:collapse;width:100%;font-size:14px;margin:16px 0">
          <thead>
            <tr style="text-align:left;color:#666;font-size:12px">
              <th style="padding:6px 12px">No</th><th style="padding:6px 12px">Ventes</th>
              <th style="padding:6px 12px;text-align:right">Pièces</th>
              <th style="padding:6px 12px;text-align:right">Ventes brutes</th>
              <th style="padding:6px 12px;text-align:right">Total (taxes incl.)</th>
            </tr>
          </thead>
          <tbody>${row(invoices.CFB)}${row(invoices.UFB)}</tbody>
        </table>
        ${invoices.UFB.conversion ? `<p style="color:#666;font-size:13px">
           Facture UFB : ${cad(invoices.UFB.conversion.grossUsd).replace('CA','')} converti de l’USD au taux
           Banque du Canada ${invoices.UFB.conversion.bocRate}
           ${invoices.UFB.conversion.bocRateDate ? `(${invoices.UFB.conversion.bocRateDate})` : ''}
           moins ${(invoices.UFB.conversion.spread * 100).toFixed(2)} % = ${invoices.UFB.conversion.effectiveRate}.
         </p>` : ''}
      </div>`;
}

/**
 * Generate both invoices for an inclusive [start, end] range, render their PDFs, and
 * email them (unless dryRun).
 *
 * @param {object}  opts
 * @param {string}  opts.start      'YYYY-MM-DD' first day covered (inclusive)
 * @param {string}  opts.end        'YYYY-MM-DD' last day covered (inclusive)
 * @param {string}  opts.issueDate  'YYYY-MM-DD' the invoices are dated (drives the FX rate)
 * @param {string}  [opts.to]       recipient override (defaults to INVOICE_EMAIL_TO)
 * @param {boolean} [opts.dryRun]   compute + render but do not email
 */
export async function runInvoices({ start, end, issueDate, to, dryRun = false }) {
    const log = { start, end, issueDate, dryRun, draft: isDraftConfig() };

    const history = await readSalesHistory();

    // The UFB invoice converts USD sales at the invoice-day rate. Fetch it up front
    // so a missing rate aborts before we build a half-invoice.
    const fx = await getUsdCadRate(issueDate);
    log.fx = fx;

    const invoices = buildInvoices({ history, start, end, issueDate, fx });
    log.invoices = { CFB: summarize(invoices.CFB), UFB: summarize(invoices.UFB) };

    // Render both PDFs (needed for dry-run byte-size reporting too).
    const attachments = [];
    for (const kind of ['CFB', 'UFB']) {
        const pdf = await renderInvoicePdf(invoices[kind]);
        attachments.push({ filename: `${invoices[kind].number}.pdf`, content: pdf });
    }
    log.pdfBytes = Object.fromEntries(attachments.map((a) => [a.filename, a.content.length]));

    const recipient = to || INVOICE_EMAIL_TO;
    if (!recipient) throw new Error('No invoice recipient (set INVOICE_EMAIL_TO or ALERT_EMAIL_TO)');
    log.recipient = recipient;

    if (dryRun) {
        log.emailed = false;
        return log;
    }

    const period = invoices.CFB.period;
    const label = period.label;
    await sendInvoiceEmail({
        to: recipient,
        subject: `Factures ${label} — CFB & UFB${log.draft ? ' (BROUILLON)' : ''}`,
        html: emailHtml({ label, period, invoices, draft: log.draft }),
        attachments,
    });
    log.emailed = true;
    return log;
}

/** Convenience wrapper: invoice a whole calendar month 'YYYY-MM'. */
export async function runMonthlyInvoices({ ym, issueDate, to, dryRun = false }) {
    const { start, end } = monthRange(ym);
    return runInvoices({ start, end, issueDate, to, dryRun });
}
