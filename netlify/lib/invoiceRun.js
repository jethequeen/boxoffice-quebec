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
import { buildInvoice, monthRange } from './invoice.js';
import { fetchInvoiceSales } from './invoiceData.js';
import { renderInvoicePdf } from './invoicePdf.js';
import { sendInvoiceEmail } from './email.js';
import { INVOICE_EMAIL_TO, isDraftConfig } from './invoiceConfig.js';

const cad = (n) =>
    new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(Number(n) || 0);

// Which sales-history source backs each invoice kind.
const KIND_SOURCE = { CFB: 'CA', UFB: 'US' };

/** One-line summary of an invoice for the email body / log. */
const summarize = (inv) => ({
    number: inv.number,
    store: inv.store,
    parts: inv.sales.parts,
    grossCad: inv.sales.grossCad,
    grossUsd: inv.conversion?.grossUsd ?? null,
    commissionKept: inv.commissionKept,
    total: inv.amounts.total,
});

function emailHtml({ label, period, invoiceList, draft }) {
    const ufb = invoiceList.find((i) => i.kind === 'UFB');
    const clients = [...new Set(invoiceList.map((i) => i.client.name))].join(' et ');
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
        <p>Période couverte : <strong>${label}</strong> (du ${period.start} au ${period.end}). ${invoiceList.length > 1 ? 'Factures ci-jointes' : 'Facture ci-jointe'}, en CAD — ${clients}.</p>
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
          <tbody>${invoiceList.map(row).join('')}</tbody>
        </table>
        ${ufb?.conversion ? `<p style="color:#666;font-size:13px">
           Facture UFB : ventes US converties au taux Banque du Canada
           ${ufb.conversion.bocRate}${ufb.conversion.bocRateDate ? ` (${ufb.conversion.bocRateDate})` : ''},
           moins la commission de ${(ufb.commissionRate * 100).toFixed(0)} % puis
           ${(ufb.conversion.feeRate * 100).toFixed(2)} % de frais de conversion.
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
 * @param {string}  [opts.to]         recipient override (defaults to INVOICE_EMAIL_TO)
 * @param {boolean} [opts.dryRun]     compute + render but do not email
 * @param {string}  [opts.dataSource] 'live' (fetch the CFB reports for the range —
 *                                    default, most accurate) or 'history' (sum the
 *                                    sales-history blob — offline fallback)
 * @param {number}  [opts.spread]     UFB conversion-fee spread as a fraction (e.g.
 *                                    0.01 = 1%), the % Manon provides. Omitted →
 *                                    the config default (FX_SPREAD).
 * @param {string[]}[opts.kinds]      which invoices to produce — subset of
 *                                    ['CFB','UFB']. Default both. The monthly cron
 *                                    passes ['CFB'] only (UFB waits for Manon's %).
 */
export async function runInvoices({
    start, end, issueDate, to, dryRun = false, dataSource = 'live', spread, kinds = ['CFB', 'UFB'],
}) {
    const wanted = ['CFB', 'UFB'].filter((k) => kinds.includes(k));
    if (!wanted.length) throw new Error(`No valid invoice kinds in ${JSON.stringify(kinds)}`);

    const log = { start, end, issueDate, dryRun, dataSource, kinds: wanted, draft: isDraftConfig() };
    if (Number.isFinite(spread)) log.spread = spread;

    // The UFB invoice converts USD sales at the invoice-day Bank-of-Canada rate —
    // only needed when UFB is requested. Fetch up front so a missing rate aborts early.
    const fx = wanted.includes('UFB') ? await getUsdCadRate(issueDate) : null;
    if (fx) log.fx = fx;

    // Source the sales either live from the vendor reports (accurate, covers the
    // exact range, US in native USD) or from the accumulated sales-history blob.
    // Only the sources backing the requested kinds are fetched.
    const sources = wanted.map((k) => KIND_SOURCE[k]);
    let salesBySource = null;
    let history = null;
    if (dataSource === 'history') {
        history = await readSalesHistory();
    } else {
        salesBySource = await fetchInvoiceSales({ start, end, sources, log });
    }

    const invoices = wanted.map((kind) => buildInvoice({
        history, sales: salesBySource?.[KIND_SOURCE[kind]], kind, start, end, issueDate, fx, spread,
    }));
    log.invoices = Object.fromEntries(invoices.map((inv) => [inv.kind, summarize(inv)]));

    // Render each requested PDF (needed for dry-run byte-size reporting too).
    const attachments = [];
    for (const inv of invoices) {
        const pdf = await renderInvoicePdf(inv);
        attachments.push({ filename: `${inv.number}.pdf`, content: pdf });
    }
    log.pdfBytes = Object.fromEntries(attachments.map((a) => [a.filename, a.content.length]));

    const recipient = to || INVOICE_EMAIL_TO;
    if (!recipient) throw new Error('No invoice recipient (set INVOICE_EMAIL_TO or ALERT_EMAIL_TO)');
    log.recipient = recipient;

    if (dryRun) {
        log.emailed = false;
        return log;
    }

    const period = invoices[0].period;
    const label = period.label;
    await sendInvoiceEmail({
        to: recipient,
        subject: `Factures ${label} — ${wanted.join(' & ')}${log.draft ? ' (BROUILLON)' : ''}`,
        html: emailHtml({ label, period, invoiceList: invoices, draft: log.draft }),
        attachments,
    });
    log.emailed = true;
    return log;
}

/** Convenience wrapper: invoice a whole calendar month 'YYYY-MM'. */
export async function runMonthlyInvoices({ ym, issueDate, to, dryRun = false, spread, kinds }) {
    const { start, end } = monthRange(ym);
    return runInvoices({ start, end, issueDate, to, dryRun, spread, kinds });
}
