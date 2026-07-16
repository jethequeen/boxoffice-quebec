/**
 * Pure invoice math — we bill the PAYOUT stated by the vendor reports.
 *
 * No I/O here — callers pass the payouts (entered from the report emails, or derived
 * from history/live fetch) and, for UFB, Manon's final USD→CAD rate. This keeps the
 * money logic unit-testable without blobs, the network, or PDFs.
 *
 * The payout is BEFORE taxes: CFB (Canadian client) gets TPS/TVQ added on top;
 * UFB (export to USA First Bricks) is zero-rated. Invoices cover an arbitrary
 * [start, end] range (inclusive); a whole calendar month is numbered CFB-2026-06,
 * any other range CFB-2026-06-01_2026-06-15.
 */

import {
    TAX_RATES,
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

/** Same recovery as nativeGross, but for the PAYOUT (the amount actually owed). */
export function nativeNet(entry) {
    if (entry?.origCurrency === 'USD' && entry?.origPayout != null) return round2(entry.origPayout);
    if ((entry?.source || 'CA') === 'US' && entry?.fx?.rate) return round2(entry.payout / entry.fx.rate);
    return round2(entry?.payout);
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
    let netNative = 0;
    const days = new Set();
    for (const e of rows) {
        parts += Number(e.parts) || 0;
        grossNative += nativeGross(e);
        netNative += nativeNet(e);
        if (e.date) days.add(e.date);
    }
    return {
        parts,
        grossNative: round2(grossNative),
        netNative: round2(netNative),
        days: [...days].sort(),
        entryCount: rows.length,
    };
}

/**
 * Add GST/QST ON TOP of a tax-excluded subtotal. The payout in CFB's system is
 * BEFORE taxes (confirmed by Manon 2026-07: payout 2406.49 → +TPS +TVQ = 2766.86),
 * so the invoice charges payout + TPS(5%) + TVQ(9.975%).
 */
export function addTaxes(subtotal, rates = TAX_RATES) {
    const s = round2(subtotal);
    const tps = round2(s * rates.tps);
    const tvq = round2(s * rates.tvq);
    return { subtotal: s, tps, tvq, total: round2(s + tps + tvq) };
}

/**
 * Build one invoice model (kind 'CFB' or 'UFB') for the inclusive range [start, end].
 *
 * We bill the PAYOUT — the amount the vendor report says CFB owes the vendor, already
 * net of the platform commission and BEFORE taxes. No commission/fee is re-derived.
 *   CFB (CAD): billed = payout + TPS + TVQ (taxes ADDED — Canadian client).
 *   UFB (USD): billed = payout × `rate` (the final rate Manon provides, already −1%),
 *              no taxes (export to USA First Bricks).
 *
 * @param {object}  sales      { netNative (payout, REQUIRED), grossNative?, parts? }.
 *                             Falls back to collectSales(history) when omitted.
 * @param {number}  [rate]     final USD→CAD rate — REQUIRED for 'UFB'.
 * @returns invoice model consumed by invoicePdf.js
 */
export function buildInvoice({ history, sales, kind, start, end, issueDate, rate }) {
    const spec = INVOICE_KINDS[kind];
    if (!spec) throw new Error(`Unknown invoice kind: ${kind}`);

    const period = periodForRange(start, end);
    const collected = sales || collectSales(history, { source: spec.source, start, end });

    const parts = collected.parts ?? null;
    const netNative = round2(collected.netNative);                          // payout (amount owed)
    const grossNative = collected.grossNative != null ? round2(collected.grossNative) : null;
    // Shown only when a gross is supplied. It is the platform's actual cut, NOT a
    // fixed 25% — the report's gross can include inventory write-offs.
    const commissionNative = grossNative != null ? round2(grossNative - netNative) : null;

    let billedTotal;
    let conversion = null;
    if (spec.native === 'USD') {
        const r = Number(rate);
        if (!(r > 0)) throw new Error('La facture UFB requiert le taux de conversion (fourni par Manon).');
        billedTotal = round2(netNative * r);
        conversion = { fromCurrency: 'USD', netUsd: netNative, rate: r, grossUsd: grossNative };
    } else {
        billedTotal = netNative;
    }

    // CFB (Canadian client) is taxable → the payout is BEFORE taxes, so TPS/TVQ are
    // ADDED on top. UFB (export to USA First Bricks) → zero-rated, no tax at all.
    const taxable = spec.taxable !== false;
    const amounts = taxable
        ? addTaxes(billedTotal, TAX_RATES)
        : { subtotal: billedTotal, tps: 0, tvq: 0, total: billedTotal };

    return {
        kind,
        number: `${spec.numberPrefix}-${period.key}`,
        issueDate,
        currency: 'CAD',
        currencyNative: spec.native,        // 'USD' (UFB) or 'CAD' (CFB)
        draft: isDraftConfig(),
        period,
        store: spec.store,
        issuer: { ...ISSUER },
        client: { ...(spec.client || CLIENT) },
        taxable,
        taxRates: { ...TAX_RATES },
        sales: {
            parts,
            days: collected.days || [],
            grossNative,                    // gross sale value, native currency (optional display)
            netNative,                      // payout — the billed base, native currency
        },
        commissionNative,                   // gross − payout (shown only if gross supplied)
        conversion,                         // null for CFB; { netUsd, rate, grossUsd } for UFB
        amounts,                            // { subtotal, tps, tvq, total } — total = billed
    };
}

