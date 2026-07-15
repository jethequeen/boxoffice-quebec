/**
 * Orchestration for the invoice run — shared by the on-demand endpoint
 * (runInvoiceNow.js) and the UI. Builds the requested invoice models from the payouts
 * (entered manually from the report emails, or fetched live), renders their PDFs, and
 * emails them with the PDFs attached. `dryRun` does everything except send the email.
 */

import { readSalesHistory, appendInvoiceRecord, writeInvoicePdf } from './blobs.js';
import { buildInvoice } from './invoice.js';
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
    client: inv.client.name,
    parts: inv.sales.parts,
    netNative: inv.sales.netNative,
    currencyNative: inv.currencyNative,
    rate: inv.conversion?.rate ?? null,
    total: inv.amounts.total,
});

function emailHtml({ label, period, invoiceList, draft }) {
    const ufb = invoiceList.find((i) => i.kind === 'UFB');
    const clients = [...new Set(invoiceList.map((i) => i.client.name))].join(' et ');
    const nativeMoney = (inv) => new Intl.NumberFormat('fr-CA', {
        style: 'currency', currency: inv.currencyNative === 'USD' ? 'USD' : 'CAD',
    }).format(Number(inv.sales.netNative) || 0);
    const row = (inv) => `
        <tr>
          <td style="padding:6px 12px;border-bottom:1px solid #eee">${inv.number}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #eee">${inv.client.name}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right">${inv.sales.parts ?? '—'}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right">${nativeMoney(inv)}</td>
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
              <th style="padding:6px 12px;text-align:right">Montant net (payout)</th>
              <th style="padding:6px 12px;text-align:right">Total facturé</th>
            </tr>
          </thead>
          <tbody>${invoiceList.map(row).join('')}</tbody>
        </table>
        ${ufb?.conversion ? `<p style="color:#666;font-size:13px">
           Facture UFB : payout de ${nativeMoney(ufb)} converti au taux ${ufb.conversion.rate}.
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
 * @param {string}  [opts.dataSource] 'manual' (default — amounts come from `salesBySource`,
 *                                    entered from the report emails), 'live' (fetch the
 *                                    CFB reports for the range) or 'history' (sales blob)
 * @param {object}  [opts.salesBySource] manual payouts, e.g.
 *                                    { CA:{netNative, grossNative?, parts?}, US:{…} }
 * @param {number}  [opts.rate]       final USD→CAD rate from Manon (REQUIRED for UFB)
 * @param {string[]}[opts.kinds]      which invoices to produce — subset of ['CFB','UFB'].
 */
export async function runInvoices({
    start, end, issueDate, to, dryRun = false, dataSource = 'manual', salesBySource = null, rate, kinds = ['CFB', 'UFB'],
}) {
    const wanted = ['CFB', 'UFB'].filter((k) => kinds.includes(k));
    if (!wanted.length) throw new Error(`No valid invoice kinds in ${JSON.stringify(kinds)}`);

    const log = { start, end, issueDate, dryRun, dataSource, kinds: wanted, draft: isDraftConfig() };
    if (Number.isFinite(rate)) log.rate = rate;

    // Source the payouts. Default 'manual' — the caller passes them (entered from the
    // report emails). 'live'/'history' still available to derive them from CFB.
    const sources = wanted.map((k) => KIND_SOURCE[k]);
    let history = null;
    let sbs = salesBySource;
    if (dataSource === 'history') {
        history = await readSalesHistory();
    } else if (dataSource === 'live') {
        sbs = await fetchInvoiceSales({ start, end, sources, log });
    }

    const invoices = wanted.map((kind) => buildInvoice({
        history, sales: sbs?.[KIND_SOURCE[kind]], kind, start, end, issueDate, rate,
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

    // Archive each emitted invoice (metadata + PDF) so it shows in the history and
    // can be re-downloaded. A storage hiccup must not fail a run whose email already
    // went out, so this is best-effort.
    try {
        const pdfByNumber = Object.fromEntries(attachments.map((a) => [a.filename.replace(/\.pdf$/, ''), a.content]));
        const generatedAt = new Date().toISOString();
        for (const inv of invoices) {
            await writeInvoicePdf(inv.number, pdfByNumber[inv.number]);
            await appendInvoiceRecord({
                number: inv.number,
                kind: inv.kind,
                period: { start: period.start, end: period.end, label, key: period.key },
                issueDate: inv.issueDate,
                client: inv.client.name,
                store: inv.store,
                parts: inv.sales.parts,
                netNative: inv.sales.netNative,
                currencyNative: inv.currencyNative,
                total: inv.amounts.total,
                taxable: inv.taxable,
                rate: inv.conversion?.rate ?? null,
                draft: log.draft,
                recipient,
                generatedAt,
            });
        }
        log.archived = invoices.map((inv) => inv.number);
    } catch (e) {
        log.archiveError = e.message;
        console.error('[runInvoices] archive failed', e);
    }
    return log;
}
