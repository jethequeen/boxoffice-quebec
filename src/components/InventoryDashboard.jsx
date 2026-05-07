import { useEffect, useMemo, useState } from 'react';
import {
    LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
    BarChart, Bar,
} from 'recharts';
import { getInventorySnapshot } from '../utils/api';
import './InventoryDashboard.css';

const fmtMoney = (n) => {
    const v = Number(n || 0);
    return v.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 2 });
};

const fmtMoneyShort = (n) => {
    const v = Number(n || 0);
    if (v >= 1_000_000) return `${(v / 1_000_000).toLocaleString('fr-CA', { maximumFractionDigits: 1 })} m$`;
    if (v >= 1_000)     return `${(v / 1_000).toLocaleString('fr-CA', { maximumFractionDigits: 1 })} k$`;
    return v.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
};

const fmtInt = (n) => Number(n || 0).toLocaleString('fr-CA');

function Kpi({ label, value, sub }) {
    return (
        <div className="kpi">
            <div className="kpi__label">{label}</div>
            <div className="kpi__value">{value}</div>
            {sub != null && <div className="kpi__sub">{sub}</div>}
        </div>
    );
}

function pickRange(entries, days) {
    if (!entries?.length) return [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffKey = cutoff.toISOString().slice(0, 10);
    return entries.filter((e) => e.key >= cutoffKey);
}

export default function InventoryDashboard() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState(null);
    const [range, setRange] = useState(30);

    useEffect(() => {
        let cancel = false;
        (async () => {
            try {
                setLoading(true);
                setErr(null);
                const d = await getInventorySnapshot();
                if (!cancel) setData(d);
            } catch (e) {
                if (!cancel) setErr(e.message || 'Erreur de chargement');
            } finally {
                if (!cancel) setLoading(false);
            }
        })();
        return () => { cancel = true; };
    }, []);

    const dailySeries = useMemo(() => pickRange(data?.sales?.daily || [], range), [data, range]);

    const totals = useMemo(() => {
        const sum = (rows) => rows.reduce((acc, r) => ({
            parts: acc.parts + (r.parts || 0),
            lots: acc.lots + (r.lots || 0),
            total: acc.total + (r.total || 0),
            payout: acc.payout + (r.payout || 0),
            fees: acc.fees + (r.fees || 0),
        }), { parts: 0, lots: 0, total: 0, payout: 0, fees: 0 });
        const last = (data?.sales?.daily || []).slice(-1)[0];
        const week = pickRange(data?.sales?.daily || [], 7);
        const month = pickRange(data?.sales?.daily || [], 30);
        const year = pickRange(data?.sales?.daily || [], 365);
        return { last, week: sum(week), month: sum(month), year: sum(year) };
    }, [data]);

    if (loading) return <div className="inv-page-loading">Chargement de l'inventaire…</div>;
    if (err) return <div className="inv-error">⚠ {err}</div>;
    if (!data) return null;

    const inv = data.inventory;
    const sales = data.sales;

    return (
        <div className="inv-dash">
            <header className="inv-header">
                <h1>Inventaire CFB</h1>
                <p className="inv-subtitle">
                    {fmtInt(inv.totalLots)} lots · {fmtInt(inv.totalParts)} pièces ·
                    valeur estimée {fmtMoney(inv.totalValue)}
                </p>
            </header>

            <section className="inv-kpis">
                <Kpi
                    label="Aujourd'hui"
                    value={totals.last ? fmtMoney(totals.last.payout) : '—'}
                    sub={totals.last ? `${fmtInt(totals.last.parts)} pièces · ${fmtInt(totals.last.lots)} lots` : 'Pas encore de données'}
                />
                <Kpi
                    label="7 derniers jours"
                    value={fmtMoney(totals.week.payout)}
                    sub={`${fmtInt(totals.week.parts)} pièces · ${fmtInt(totals.week.lots)} lots`}
                />
                <Kpi
                    label="30 derniers jours"
                    value={fmtMoney(totals.month.payout)}
                    sub={`${fmtInt(totals.month.parts)} pièces · ${fmtInt(totals.month.lots)} lots`}
                />
                <Kpi
                    label="365 derniers jours"
                    value={fmtMoney(totals.year.payout)}
                    sub={`${fmtInt(totals.year.parts)} pièces · ${fmtInt(totals.year.lots)} lots`}
                />
            </section>

            <section className="inv-card">
                <div className="inv-card__head">
                    <h2>Ventes quotidiennes</h2>
                    <div className="inv-range-tabs">
                        {[7, 30, 90, 365].map((d) => (
                            <button
                                key={d}
                                className={`inv-tab ${range === d ? 'inv-tab--active' : ''}`}
                                onClick={() => setRange(d)}
                            >
                                {d}j
                            </button>
                        ))}
                    </div>
                </div>
                <div className="inv-chart">
                    <ResponsiveContainer width="100%" height={260}>
                        <LineChart data={dailySeries} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                            <XAxis dataKey="key" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtMoneyShort} />
                            <Tooltip
                                formatter={(v, key) => key === 'payout' ? fmtMoney(v) : fmtInt(v)}
                                labelStyle={{ fontWeight: 700 }}
                            />
                            <Line type="monotone" dataKey="payout" stroke="#4F46E5" strokeWidth={2} dot={false} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </section>

            <section className="inv-grid-2">
                <div className="inv-card">
                    <div className="inv-card__head"><h2>Top vendeurs (pièces)</h2></div>
                    <ol className="inv-list">
                        {(sales.topSellers || []).slice(0, 10).map((s) => (
                            <li key={`${s.itemId}|${s.colorName}|${s.condition}`} className="inv-list__row">
                                <div className="inv-list__name">
                                    <span className="inv-list__title">{s.name}</span>
                                    <span className="inv-list__meta">
                                        {s.colorName} · {s.condition === 'U' ? 'Used' : 'New'} · {fmtInt(s.qtyOnHand)} en stock
                                    </span>
                                </div>
                                <div className="inv-list__num">{fmtInt(s.partsSold)}</div>
                            </li>
                        ))}
                        {!sales.topSellers?.length && <li className="inv-empty">Pas encore de ventes enregistrées.</li>}
                    </ol>
                </div>

                <div className="inv-card">
                    <div className="inv-card__head"><h2>Lots de plus grande valeur</h2></div>
                    <ol className="inv-list">
                        {(inv.topLots || []).slice(0, 10).map((l) => (
                            <li key={l.lotId} className="inv-list__row">
                                <div className="inv-list__name">
                                    <span className="inv-list__title">{l.name}</span>
                                    <span className="inv-list__meta">{l.color} · qté {fmtInt(l.qty)}</span>
                                </div>
                                <div className="inv-list__num">{fmtMoney(l.value)}</div>
                            </li>
                        ))}
                    </ol>
                </div>
            </section>

            <section className="inv-card">
                <div className="inv-card__head"><h2>Mensuel</h2></div>
                <div className="inv-chart">
                    <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={sales.monthly || []} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                            <XAxis dataKey="key" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtMoneyShort} />
                            <Tooltip formatter={(v) => fmtMoney(v)} />
                            <Bar dataKey="payout" fill="#10B981" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </section>

            <section className="inv-grid-2">
                <div className="inv-card">
                    <div className="inv-card__head"><h2>Top catégories (valeur)</h2></div>
                    <ol className="inv-list">
                        {(inv.topCategories || []).slice(0, 8).map((c) => (
                            <li key={c.category} className="inv-list__row">
                                <div className="inv-list__name">
                                    <span className="inv-list__title">{c.category}</span>
                                    <span className="inv-list__meta">{fmtInt(c.lots)} lots · {fmtInt(c.parts)} pièces</span>
                                </div>
                                <div className="inv-list__num">{fmtMoney(c.value)}</div>
                            </li>
                        ))}
                    </ol>
                </div>
                <div className="inv-card">
                    <div className="inv-card__head"><h2>Top couleurs (valeur)</h2></div>
                    <ol className="inv-list">
                        {(inv.topColors || []).slice(0, 8).map((c) => (
                            <li key={c.color} className="inv-list__row">
                                <div className="inv-list__name">
                                    <span className="inv-list__title">{c.color}</span>
                                    <span className="inv-list__meta">{fmtInt(c.lots)} lots · {fmtInt(c.parts)} pièces</span>
                                </div>
                                <div className="inv-list__num">{fmtMoney(c.value)}</div>
                            </li>
                        ))}
                    </ol>
                </div>
            </section>
        </div>
    );
}
