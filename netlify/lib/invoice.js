/**
 * Pure invoice math for the commission invoices billed to CFB.
 *
 * No I/O here — callers pass the sales-history array (from readSalesHistory()) and,
 * for the UFB invoice, the invoice-day USD→CAD rate (from getUsdCadRate()). This
 * keeps the money logic unit-testable without blobs, the network, or PDFs.
 *
 * Invoices cover an arbitrary [start, end] date range (inclusive). A range that
 * happens to be one whole calendar month is numbered like the monthly cron's
 * (e.g. CFB-2026-06); any other range uses a start_end key (CFB-2026-06-01_2026-06-15).
 *
 * See invoiceConfig.js for the business assumptions (25% tax-included commission,
 * 1% FX spread, Quebec TPS/TVQ rates).
 */

import {
    TAX_RATES,
    COMMISSION_RATE,
    FX_SPREAD,
    ISSUER,
    CLIENT,
    INVOICE_KINDS,
    isDraftConfig,
} from './invoiceConfig.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

const frPart = (ymd, opts) =>
    new Intl.DateTimeFormat('fr-CA', { timeZone: 'UTC', ...opts }).format(new Date(`${ymd}T00:00:00Z`));

/** Natural French label for a range: "1 au 15 juin 2026", "1 juin au 5 juillet 2026", … */
function frRangeLabel(start, end) {
    const full = { day: 'numeric', month: 'long', year: 'numeric' };
    const sameYear = start.slice(0, 4) === end.slice(0, 4);
    const sameMonth = sameYear && start.slice(0, 7) === end.slice(0, 7);
    if (sameMonth) return `${frPart(start, { day: 'numeric' })} au ${frPart(end, full)}`;
    if (sameYear) return `${frPart(start, { day: 'numeric', month: 'long' })} au ${frPart(end, full)}`;
    return `${frPart(start, full)} au ${frPart(end, full)}`;
}

/** 'YYYY-MM' of the calendar month before the given YYYY-MM-DD date. */
export function previousMonthYm(refYmd) {
    const [y, m] = String(refYmd).split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1, 1));
    d.setUTCMonth(d.getUTCMonth() - 1);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** First/last day (inclusive) and a French label for a 'YYYY-MM'. */
export function monthBounds(ym) {
    const [y, m] = String(ym).split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const label = new Intl.DateTimeFormat('fr-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' })
        .format(new Date(Date.UTC(y, m - 1, 1)));
    return {
        start: `${ym}-01`,
        end: `${ym}-${String(last).padStart(2, '0')}`,
        label,
    };
}

/** Whole-calendar-month [start, end] for a 'YYYY-MM'. */
export function monthRange(ym) {
    const b = monthBounds(ym);
    return { start: b.start, end: b.end };
}

/**
 * Period metadata for an inclusive [start, end] range: a French label and a `key`
 * used in the invoice number. A range that is exactly one calendar month collapses
 * to that month's label/key so a UI-generated monthly invoice matches the cron's.
 */
export function periodForRange(start, end) {
    if (!isYmd(start) || !isYmd(end)) throw new Error(`Invalid date range: ${start}..${end} (expected YYYY-MM-DD)`);
    if (start > end) throw new Error(`Invalid date range: start ${start} is after end ${end}`);

    const ym = start.slice(0, 7);
    const mb = monthBounds(ym);
    if (mb.start === start && mb.end === end) {
        return { start, end, label: mb.label, key: ym };
    }
    return { start, end, label: frRangeLabel(start, end), key: `${start}_${end}` };
}

/**
 * Recover a US entry's gross sales in its NATIVE currency (USD). US entries are
 * stored already converted to CAD at the ingest-day rate, with that rate kept in
 * `fx.rate` — so USD = CAD_total / rate. Newer entries may carry the pre-conversion
 * amount directly (origCurrency/origTotal); prefer that when present (exact, no
 * round-trip error). CA entries are already native CAD.
 */
export function nativeGross(entry) {
    if (entry?.origCurrency === 'USD' && entry?.origTotal != null) return round2(entry.origTotal);
    if ((entry?.source || 'CA') === 'US' && entry?.fx?.rate) return round2(entry.total / entry.fx.rate);
    return round2(entry?.total);
}

/**
 * Sum one source's sales over an inclusive [start, end] range. Returns
 * native-currency gross (USD for US, CAD for CA), piece count, and contributing days.
 */
export function collectSales(history, { source, start, end }) {
    const rows = (Array.isArray(history) ? history : [])
        .filter((e) => (e?.source || 'CA') === source && e?.date >= start && e?.date <= end);

    let parts = 0;
    let grossNative = 0;
    const days = new Set();
    for (const e of rows) {
        parts += Number(e.parts) || 0;
        grossNative += nativeGross(e);
        if (e.date) days.add(e.date);
    }
    return {
        parts,
        grossNative: round2(grossNative),
        days: [...days].sort(),
        entryCount: rows.length,
    };
}

/**
 * Back GST/QST out of a TAX-INCLUDED grand total. The 25% commission already
 * contains the taxes, so: subtotal = total / (1 + tps + tvq); each tax = subtotal *
 * its rate. Rounded so subtotal + tps + tvq === total to the cent.
 */
export function extractTaxIncluded(grandTotal, rates = TAX_RATES) {
    const total = round2(grandTotal);
    const subtotal = round2(total / (1 + rates.tps + rates.tvq));
    const tps = round2(subtotal * rates.tps);
    // Absorb any rounding drift into TVQ so the parts always re-sum to `total`.
    const tvq = round2(total - subtotal - tps);
    return { subtotal, tps, tvq, total };
}

/**
 * Build one invoice model (kind 'CFB' or 'UFB') for the inclusive range [start, end].
 *
 * @param {object[]} history   sales-history array
 * @param {string}   kind      'CFB' | 'UFB'
 * @param {string}   start     'YYYY-MM-DD' first day covered (inclusive)
 * @param {string}   end       'YYYY-MM-DD' last day covered (inclusive)
 * @param {string}   issueDate 'YYYY-MM-DD' the invoice is dated/issued
 * @param {object}   [fx]      { rate, rateDate } BoC USD→CAD — REQUIRED for 'UFB'
 * @returns invoice model consumed by invoicePdf.js
 */
export function buildInvoice({ history, kind, start, end, issueDate, fx }) {
    const spec = INVOICE_KINDS[kind];
    if (!spec) throw new Error(`Unknown invoice kind: ${kind}`);

    const period = periodForRange(start, end);
    const sales = collectSales(history, { source: spec.source, start, end });

    // Gross sales expressed in CAD (the invoice's settlement currency).
    let grossCad;
    let conversion = null;
    if (spec.native === 'USD') {
        if (!fx?.rate) throw new Error(`UFB invoice needs a USD→CAD rate (fx.rate)`);
        const effectiveRate = round2(fx.rate * (1 - FX_SPREAD) * 1e6) / 1e6; // keep 6 dp on the rate
        grossCad = round2(sales.grossNative * effectiveRate);
        conversion = {
            fromCurrency: 'USD',
            grossUsd: sales.grossNative,
            bocRate: fx.rate,
            bocRateDate: fx.rateDate || null,
            spread: FX_SPREAD,
            effectiveRate,
        };
    } else {
        grossCad = sales.grossNative;
    }

    const commissionTotal = round2(grossCad * COMMISSION_RATE);
    const amounts = extractTaxIncluded(commissionTotal, TAX_RATES);

    return {
        kind,
        number: `${spec.numberPrefix}-${period.key}`,
        issueDate,
        currency: 'CAD',
        draft: isDraftConfig(),
        period,
        store: spec.store,
        issuer: { ...ISSUER },
        client: { ...CLIENT },
        commissionRate: COMMISSION_RATE,
        taxRates: { ...TAX_RATES },
        sales: {
            parts: sales.parts,
            days: sales.days,
            grossCad,
        },
        conversion,      // null for CFB, {grossUsd, bocRate, spread, effectiveRate} for UFB
        amounts,         // { subtotal, tps, tvq, total }
    };
}

/** Build both invoices for an inclusive [start, end] range. `fx` is required for UFB. */
export function buildInvoices({ history, start, end, issueDate, fx }) {
    return {
        CFB: buildInvoice({ history, kind: 'CFB', start, end, issueDate }),
        UFB: buildInvoice({ history, kind: 'UFB', start, end, issueDate, fx }),
    };
}

/** Build both invoices for a whole calendar month 'YYYY-MM'. */
export function buildMonthlyInvoices({ history, ym, issueDate, fx }) {
    const { start, end } = monthRange(ym);
    return buildInvoices({ history, start, end, issueDate, fx });
}
