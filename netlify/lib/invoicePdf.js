/**
 * Render an invoice model (from invoice.js buildInvoice) to a PDF Buffer with
 * pdfkit. Uses the built-in Helvetica standard fonts (WinAnsi — full French accent
 * support), so no font files ship with the function. Output is a single A4-ish page.
 *
 * Returns Promise<Buffer> so callers can attach it to a Resend email (base64).
 */

import PDFDocument from 'pdfkit';

const cad = (n) =>
    new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(Number(n) || 0);
const usd = (n) =>
    new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'USD' }).format(Number(n) || 0);
const pct = (r) => `${(Number(r) * 100).toFixed(3).replace(/\.?0+$/, '').replace('.', ',')} %`;
const frDate = (ymd) =>
    new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
        .format(new Date(`${ymd}T00:00:00Z`));

const INK = '#1a1a1a';
const MUTED = '#666666';
const RULE = '#cccccc';
const ACCENT = '#2b7a2b';

/** @returns {Promise<Buffer>} */
export function renderInvoicePdf(inv) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const chunks = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const { page } = doc;
        const left = doc.page.margins.left;
        const right = page.width - doc.page.margins.right;
        const contentWidth = right - left;

        // ---- Draft watermark ------------------------------------------------
        if (inv.draft) {
            doc.save();
            doc.rotate(-30, { origin: [page.width / 2, page.height / 2] });
            doc.fontSize(90).fillColor('#f0d0d0').font('Helvetica-Bold')
                .text('BROUILLON', 0, page.height / 2 - 60, { width: page.width, align: 'center' });
            doc.restore();
        }

        // ---- Issuer header --------------------------------------------------
        doc.fillColor(INK).font('Helvetica-Bold').fontSize(18).text(inv.issuer.name, left, 50);
        doc.font('Helvetica').fontSize(9).fillColor(MUTED);
        if (inv.issuer.address) doc.text(inv.issuer.address, { width: contentWidth * 0.6 });
        if (inv.issuer.email) doc.text(inv.issuer.email);
        doc.text(`No TPS : ${inv.issuer.gst}`);
        doc.text(`No TVQ : ${inv.issuer.qst}`);

        // ---- Invoice title block (right) -----------------------------------
        doc.font('Helvetica-Bold').fontSize(22).fillColor(ACCENT)
            .text('FACTURE', left, 50, { width: contentWidth, align: 'right' });
        doc.font('Helvetica').fontSize(10).fillColor(INK);
        doc.text(`No ${inv.number}`, { width: contentWidth, align: 'right' });
        doc.text(`Date : ${frDate(inv.issueDate)}`, { width: contentWidth, align: 'right' });
        doc.text(`Période : ${inv.period.label}`, { width: contentWidth, align: 'right' });

        // ---- Bill-to --------------------------------------------------------
        let y = 165;
        doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('FACTURER À', left, y);
        doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(inv.client.name, left, y + 14);
        doc.font('Helvetica').fontSize(9).fillColor(MUTED);
        if (inv.client.address) doc.text(inv.client.address, { width: contentWidth * 0.5 });
        doc.fillColor(INK).fontSize(9)
            .text(`Ventes réalisées chez : ${inv.store}`, left, doc.y + 4);
        doc.text(`Du ${frDate(inv.period.start)} au ${frDate(inv.period.end)}`);

        // ---- Line-item table ------------------------------------------------
        y = 260;
        const col = { desc: left, qty: left + contentWidth * 0.58, amt: right };
        doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED);
        doc.text('DESCRIPTION', col.desc, y);
        doc.text('DÉTAIL', col.qty, y, { width: contentWidth * 0.2, align: 'right' });
        doc.text('MONTANT (CAD)', col.qty + contentWidth * 0.2, y, { width: right - (col.qty + contentWidth * 0.2), align: 'right' });
        y += 14;
        doc.moveTo(left, y).lineTo(right, y).strokeColor(RULE).lineWidth(1).stroke();
        y += 10;

        // Gross-sales row (context for the commission)
        const grossDetail = inv.conversion
            ? usd(inv.conversion.grossUsd)
            : `${inv.sales.parts} pièces`;
        doc.font('Helvetica').fontSize(10).fillColor(INK);
        doc.text('Ventes brutes de la période', col.desc, y, { width: contentWidth * 0.55 });
        doc.text(grossDetail, col.qty, y, { width: contentWidth * 0.2, align: 'right' });
        doc.text(cad(inv.sales.grossCad), col.qty + contentWidth * 0.2, y, { width: right - (col.qty + contentWidth * 0.2), align: 'right' });
        y = doc.y + 6;

        // FX explanation row (UFB only)
        if (inv.conversion) {
            doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(MUTED);
            const c = inv.conversion;
            doc.text(
                `Conversion USD vers CAD : taux Banque du Canada ${c.bocRate}`
                + (c.bocRateDate ? ` (${c.bocRateDate})` : '')
                + ` moins ${pct(c.spread)} = ${c.effectiveRate}`,
                col.desc, y, { width: contentWidth },
            );
            y = doc.y + 8;
        }

        // Commission row
        doc.font('Helvetica').fontSize(10).fillColor(INK);
        doc.text(
            `Commission de gestion (${pct(inv.commissionRate)} des ventes brutes, taxes incluses)`,
            col.desc, y, { width: contentWidth * 0.55 },
        );
        doc.text(`${inv.sales.parts} pièces`, col.qty, y, { width: contentWidth * 0.2, align: 'right' });
        doc.text(cad(inv.amounts.total), col.qty + contentWidth * 0.2, y, { width: right - (col.qty + contentWidth * 0.2), align: 'right' });
        y = doc.y + 14;

        doc.moveTo(left, y).lineTo(right, y).strokeColor(RULE).lineWidth(1).stroke();
        y += 12;

        // ---- Totals (right-aligned block) -----------------------------------
        const labelX = left + contentWidth * 0.5;
        const labelW = contentWidth * 0.28;
        const valX = labelX + labelW;
        const valW = right - valX;
        const totalLine = (label, value, opts = {}) => {
            doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.bold ? 12 : 10)
                .fillColor(opts.bold ? INK : MUTED);
            doc.text(label, labelX, y, { width: labelW, align: 'right' });
            doc.fillColor(INK).text(value, valX, y, { width: valW, align: 'right' });
            y = doc.y + (opts.bold ? 2 : 4);
        };
        totalLine('Sous-total', cad(inv.amounts.subtotal));
        totalLine(`TPS (${pct(inv.taxRates.tps)})`, cad(inv.amounts.tps));
        totalLine(`TVQ (${pct(inv.taxRates.tvq)})`, cad(inv.amounts.tvq));
        y += 4;
        doc.moveTo(labelX, y).lineTo(right, y).strokeColor(RULE).lineWidth(1).stroke();
        y += 8;
        totalLine('TOTAL', cad(inv.amounts.total), { bold: true });

        // ---- Footer ---------------------------------------------------------
        doc.font('Helvetica').fontSize(8).fillColor(MUTED)
            .text(
                'Le montant de la commission inclut la TPS et la TVQ, ventilées ci-dessus. '
                + (inv.conversion
                    ? 'Les ventes sont réalisées en USD chez USA First Bricks et refacturées en CAD à Canada First Bricks.'
                    : 'Ventes réalisées en CAD chez Canada First Bricks.'),
                left, page.height - 90, { width: contentWidth, align: 'center' },
            );

        doc.end();
    });
}
