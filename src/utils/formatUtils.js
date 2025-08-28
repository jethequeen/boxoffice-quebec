export const formatCurrency = (amount) => {
    if (!amount) return '-'
    return new Intl.NumberFormat('fr-CA', {
        style: 'currency',
        currency: 'CAD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(amount)
}

// Coerce anything to a finite number or return null
export const toNum = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

// Format percentage with 0 decimals or '-' if missing
export const pct0 = (v) => {
    const n = toNum(v);
    return n == null ? '-' : `${n.toFixed(0)}%`;
};