/**
 * Render an invoice model (from invoice.js buildInvoice) to a PDF Buffer with
 * pdfkit. Uses the built-in Helvetica standard fonts (WinAnsi — full French accent
 * support), so no font files ship with the function. Output is a single A4-ish page.
 *
 * Layout separates the COMMISSION CALCULATION (gross sales + FX detail, shown as a
 * muted basis) from the BILLING lines (commission → subtotal → taxes → total), so it
 * is unambiguous that only the commission — not the gross sales — is being charged.
 *
 * Returns Promise<Buffer> so callers can attach it to a Resend email (base64).
 */

import PDFDocument from 'pdfkit';

const cad = (n) =>
    new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(Number(n) || 0);
const usd = (n) =>
    new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'USD' }).format(Number(n) || 0);
const int = (n) => new Intl.NumberFormat('fr-CA').format(Number(n) || 0);
const rate = (x) => String(x).replace('.', ',');   // exchange rates: French decimal comma
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

        // Column geometry shared by the calc + billing rows.
        const amtW = contentWidth * 0.24;
        const amtX = right - amtW;
        const detW = contentWidth * 0.18;
        const detX = amtX - detW;
        const labelW = detX - left;

        // A single row: label (left), optional detail (middle, right-aligned),
        // amount (right). `muted` renders the whole row grey (used for the basis).
        const row = (label, detail, amount, opts = {}) => {
            const color = opts.muted ? MUTED : INK;
            const font = opts.bold ? 'Helvetica-Bold' : 'Helvetica';
            doc.font(font).fontSize(opts.size || 10).fillColor(color);
            doc.text(label, left, y, { width: labelW });
            const rowTop = y;                       // labels can wrap; anchor detail/amount to the top
            if (detail) doc.fillColor(MUTED).font('Helvetica').fontSize(opts.size || 10)
                .text(detail, detX, rowTop, { width: detW, align: 'right' });
            doc.font(font).fontSize(opts.size || 10).fillColor(opts.bold ? INK : color)
                .text(amount, amtX, rowTop, { width: amtW, align: 'right' });
            y = doc.y + 7;
        };
        const rule = (x0 = left, x1 = right, gap = 8) => {
            doc.moveTo(x0, y).lineTo(x1, y).strokeColor(RULE).lineWidth(1).stroke();
            y += gap;
        };

        // ---- Calcul du montant facturé (payout → [× taux pour UFB]) ----------
        // Native-currency formatter for the payout/gross rows (USD for UFB, CAD for CFB).
        const money = inv.currencyNative === 'USD' ? usd : cad;
        const partsDetail = inv.sales.parts != null ? `${int(inv.sales.parts)} pièces` : '';
        const hasGross = inv.sales.grossNative != null;
        const showCalc = inv.conversion || hasGross;

        if (showCalc) {
            doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('CALCUL DU MONTANT FACTURÉ', left, y = 248);
            y += 18;

            if (hasGross) {
                row('Ventes brutes de la période', partsDetail, money(inv.sales.grossNative), { muted: true });
                row('Commission de la plateforme', '', `-${money(inv.commissionNative)}`, { muted: true });
                row('Montant net (payout)', '', money(inv.sales.netNative), { muted: true });
            } else {
                row('Montant net (payout)', partsDetail, money(inv.sales.netNative), { muted: true });
            }
            if (inv.conversion) {
                row('Taux de conversion appliqué', '', rate(inv.conversion.rate), { muted: true });
                row('Montant facturé (CAD)', '', cad(inv.amounts.total), { muted: true, bold: true });
            }
            y += 4;
            rule(left, right, 16);
        } else {
            y = 248;
        }

        // ---- Facturation (we sell the pieces to CFB, net of its commission) --
        doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('FACTURATION', left, y);
        y += 18;
        row('Pièces de LEGO', '', cad(inv.amounts.subtotal));
        rule(left, right, 10);

        // Totals block, right-aligned under the amount column.
        const totalLine = (label, value, opts = {}) => {
            doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.bold ? 12 : 10)
                .fillColor(opts.bold ? INK : MUTED);
            doc.text(label, detX - contentWidth * 0.1, y, { width: detW + contentWidth * 0.1, align: 'right' });
            doc.fillColor(INK).text(value, amtX, y, { width: amtW, align: 'right' });
            y = doc.y + (opts.bold ? 2 : 5);
        };
        // Taxable client (CFB) → show the TPS/TVQ breakdown. UFB is an export sale
        // to USA First Bricks → zero-rated, so no tax lines at all.
        if (inv.taxable) {
            totalLine('Sous-total', cad(inv.amounts.subtotal));
            totalLine(`TPS (${pct(inv.taxRates.tps)})`, cad(inv.amounts.tps));
            totalLine(`TVQ (${pct(inv.taxRates.tvq)})`, cad(inv.amounts.tvq));
            y += 4;
            doc.moveTo(detX - contentWidth * 0.1, y).lineTo(right, y).strokeColor(RULE).lineWidth(1).stroke();
            y += 8;
        }
        totalLine('TOTAL', cad(inv.amounts.total), { bold: true });

        // ---- Footer ---------------------------------------------------------
        const footer = inv.taxable
            ? `Toutes les sommes sont en dollars canadiens (CAD). Vente de pièces à ${inv.client.name} — TPS et TVQ en sus.`
            : `Toutes les sommes sont en dollars canadiens (CAD). Vente de pièces à ${inv.client.name} — exportation hors Canada, exonérée de TPS/TVQ.`;
        doc.font('Helvetica').fontSize(8).fillColor(MUTED)
            .text(footer, left, page.height - 80, { width: contentWidth, align: 'center' });

        doc.end();
    });
}
