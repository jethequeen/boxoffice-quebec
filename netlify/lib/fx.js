/**
 * USD→CAD conversion for US-origin CFB reports.
 *
 * The US portal (usmocs) denominates totals/payouts in USD while the CA portal
 * (mocs) uses CAD. We treat both origins identically for bookkeeping, so US money
 * must be converted to CAD before it is summed with CA — otherwise we mix
 * currencies in the sheet, the sales-history blob, and the dashboard.
 *
 * The rate comes from the Bank of Canada Valet API (series FXUSDCAD): the daily
 * official noon rate, no API key required. We query a short window ending on the
 * report date and take the most recent published observation on/before it — the
 * series has no value on weekends/holidays, so a lookback skips those gaps.
 */

const VALET_SERIES = 'FXUSDCAD';
const LOOKBACK_DAYS = 10;

const ymd = (d) => d.toISOString().slice(0, 10);

/**
 * Fetch the USD→CAD rate for `date` (YYYY-MM-DD) or the most recent business day
 * before it. Returns { rate, rateDate, source }. Throws if the API is unreachable
 * or returns no usable observation — callers must decide how to handle a missing
 * rate rather than silently posting mixed currencies.
 */
export async function getUsdCadRate(date) {
    const end = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : ymd(new Date());
    const start = ymd(new Date(new Date(end + 'T00:00:00Z').getTime() - LOOKBACK_DAYS * 86400000));
    const url = `https://www.bankofcanada.ca/valet/observations/${VALET_SERIES}/json`
        + `?start_date=${start}&end_date=${end}`;

    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`BoC Valet ${res.status} — ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    const obs = Array.isArray(data?.observations) ? data.observations : [];

    // Observations come oldest→newest; walk back to the latest numeric value.
    for (let i = obs.length - 1; i >= 0; i--) {
        const v = Number(obs[i]?.[VALET_SERIES]?.v);
        if (Number.isFinite(v) && v > 0) {
            return { rate: v, rateDate: obs[i].d, source: 'boc' };
        }
    }
    throw new Error(`BoC Valet returned no usable ${VALET_SERIES} observation for ${start}..${end}`);
}

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/**
 * Scale the monetary fields of an aggregateRows() result by `rate`, leaving unit
 * counts (parts, lots, per-section parts) untouched. Returns a new object — the
 * input is not mutated.
 */
export function toCadTotals(totals, rate) {
    const r = Number(rate);
    if (!Number.isFinite(r) || r <= 0) throw new Error(`Invalid USD→CAD rate: ${rate}`);
    const bySection = {};
    for (const [section, vals] of Object.entries(totals.bySection || {})) {
        bySection[section] = {
            parts: vals.parts,
            total: round2(vals.total * r),
            payout: round2(vals.payout * r),
        };
    }
    return {
        ...totals,
        total: round2(totals.total * r),
        payout: round2(totals.payout * r),
        fees: round2(totals.fees * r),
        bySection,
    };
}
