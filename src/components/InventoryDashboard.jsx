import { useEffect, useMemo, useRef, useState } from 'react';
import {
    LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
    BarChart, Bar,
} from 'recharts';
import { getInventorySnapshot } from '../utils/api';
import './InventoryDashboard.css';

const TOKEN_STORAGE_KEY = 'cfb_ingest_token';

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

function UploadBsx({ onUploaded }) {
    const fileRef = useRef(null);
    const [token, setToken] = useState(() => {
        try { return localStorage.getItem(TOKEN_STORAGE_KEY) || ''; } catch { return ''; }
    });
    const [file, setFile] = useState(null);
    const [mode, setMode] = useState('min');
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);
    const [err, setErr] = useState(null);
    const [open, setOpen] = useState(false);

    const persistToken = (v) => {
        setToken(v);
        try {
            if (v) localStorage.setItem(TOKEN_STORAGE_KEY, v);
            else localStorage.removeItem(TOKEN_STORAGE_KEY);
        } catch { /* ignore */ }
    };

    const submit = async () => {
        if (!file) return;
        setBusy(true);
        setResult(null);
        setErr(null);
        try {
            const xml = await file.text();
            if (!xml.includes('<BrickStoreXML')) {
                throw new Error('Fichier invalide : la racine <BrickStoreXML> est introuvable.');
            }
            const res = await fetch(`/.netlify/functions/mergeInventory?mode=${mode}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/xml',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: xml,
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
            setResult(data);
            setFile(null);
            if (fileRef.current) fileRef.current.value = '';
            onUploaded?.();
        } catch (e) {
            setErr(e.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="inv-card inv-upload">
            <div className="inv-card__head">
                <h2>Mise à jour de l'inventaire maître</h2>
                <button type="button" className="inv-tab" onClick={() => setOpen((v) => !v)}>
                    {open ? 'Fermer' : 'Téléverser un .bsx'}
                </button>
            </div>
            {open && (
                <div className="inv-upload__body">
                    <p className="inv-upload__hint">
                        Téléverse un <code>.bsx</code> pour <strong>fusionner</strong> ses lots dans l'inventaire maître.
                        Le mode dicte quoi faire quand un lot existe déjà (même <code>ItemID</code> + couleur + état).
                    </p>

                    <fieldset className="inv-upload__modes" disabled={busy}>
                        <label className={`inv-upload__mode ${mode === 'min' ? 'inv-upload__mode--active' : ''}`}>
                            <input
                                type="radio"
                                name="mergeMode"
                                value="min"
                                checked={mode === 'min'}
                                onChange={() => setMode('min')}
                            />
                            <div>
                                <div className="inv-upload__mode-title">
                                    Migration <span className="inv-upload__mode-tag">en cours</span>
                                </div>
                                <div className="inv-upload__mode-desc">
                                    J'envoie de nouveaux lots BrickStore vers CFB. Sur collision : on garde la <strong>quantité minimale</strong>
                                    (jamais d'inflation pendant la migration).
                                </div>
                            </div>
                        </label>

                        <label className={`inv-upload__mode ${mode === 'add' ? 'inv-upload__mode--active' : ''}`}>
                            <input
                                type="radio"
                                name="mergeMode"
                                value="add"
                                checked={mode === 'add'}
                                onChange={() => setMode('add')}
                            />
                            <div>
                                <div className="inv-upload__mode-title">
                                    Part-out <span className="inv-upload__mode-tag inv-upload__mode-tag--later">après migration</span>
                                </div>
                                <div className="inv-upload__mode-desc">
                                    J'ai décortiqué un set : ajoute ces lots au maître. Sur collision : on <strong>additionne</strong> les quantités.
                                </div>
                            </div>
                        </label>
                    </fieldset>

                    <div className="inv-upload__row">
                        <input
                            ref={fileRef}
                            type="file"
                            accept=".bsx,.xml,application/xml,text/xml"
                            onChange={(e) => setFile(e.target.files?.[0] || null)}
                            disabled={busy}
                        />
                    </div>
                    <div className="inv-upload__row">
                        <input
                            type="password"
                            placeholder="Ingest token (laisse vide si non requis)"
                            value={token}
                            onChange={(e) => persistToken(e.target.value)}
                            disabled={busy}
                            className="inv-upload__token"
                        />
                    </div>
                    <div className="inv-upload__row">
                        <button
                            type="button"
                            className="inv-upload__submit"
                            onClick={submit}
                            disabled={!file || busy}
                        >
                            {busy ? 'Fusion en cours…' : (mode === 'min' ? 'Fusionner (migration)' : 'Fusionner (part-out)')}
                        </button>
                    </div>
                    {result && (
                        <div className="inv-upload__ok">
                            ✓ Fusion réussie · {fmtInt(result.addedKeys)} nouveaux lots ·
                            {' '}{fmtInt(result.updatedKeys)} ajustés ·
                            {' '}{fmtInt(result.unchangedKeys)} inchangés
                        </div>
                    )}
                    {err && <div className="inv-upload__err">⚠ {err}</div>}
                </div>
            )}
        </section>
    );
}

function pickRange(entries, days) {
    if (!entries?.length) return [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffKey = cutoff.toISOString().slice(0, 10);
    return entries.filter((e) => e.key >= cutoffKey);
}

function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function pickInvSnapshotsInRange(snapshots, days) {
    if (!snapshots?.length) return [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffKey = cutoff.toISOString().slice(0, 10);
    return snapshots.filter((s) => s.date >= cutoffKey);
}

// Latest snapshot per calendar day, sorted ascending — keeps the inventory chart
// readable when multiple writes hit the same day (daily ingest + a manual merge).
function dailyInvSeries(snapshots) {
    if (!snapshots?.length) return [];
    const byDate = new Map();
    for (const s of snapshots) {
        const cur = byDate.get(s.date);
        if (!cur || (s.timestamp || '') > (cur.timestamp || '')) {
            byDate.set(s.date, s);
        }
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export default function InventoryDashboard() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState(null);
    const [range, setRange] = useState(30);
    const [reloadTick, setReloadTick] = useState(0);
    const [tab, setTab] = useState('sales');

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
    }, [reloadTick]);

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

    const derived = useMemo(() => {
        const daily = data?.sales?.daily || [];
        const month30 = pickRange(daily, 30);

        // Average daily payout — use min(30, days_since_first_entry) for a fairer denominator
        // when we have less than 30 days of history.
        const firstDate = daily[0]?.key;
        let denom = 30;
        if (firstDate) {
            const ms = (Date.now() - new Date(firstDate + 'T00:00:00Z').getTime()) / 86400000;
            denom = Math.max(1, Math.min(30, Math.ceil(ms) + 1));
        }
        const sum30 = month30.reduce((a, r) => a + (r.payout || 0), 0);
        const avgDaily = sum30 / denom;

        // Platforms vs manuals over the 30d window
        const split = month30.reduce((acc, r) => {
            for (const [section, vals] of Object.entries(r.bySection || {})) {
                const isPlatform = /platform/i.test(section);
                const target = isPlatform ? acc.platforms : acc.manuals;
                target.parts += Number(vals.parts || 0);
                target.payout += Number(vals.payout || 0);
                target.total += Number(vals.total || 0);
            }
            return acc;
        }, {
            platforms: { parts: 0, payout: 0, total: 0 },
            manuals: { parts: 0, payout: 0, total: 0 },
        });

        // Sales ratio: 30d payout / median inventory value over the same window
        const invSnaps30 = pickInvSnapshotsInRange(data?.inventoryHistory || [], 30);
        const medianInvValue = median(invSnaps30.map((s) => Number(s.totalValue || 0)).filter((v) => v > 0));
        const salesRatio = medianInvValue ? sum30 / medianInvValue : null;

        return { avgDaily, split, sum30, salesRatio, medianInvValue, invSnapCount: invSnaps30.length };
    }, [data]);

    const invSeries = useMemo(() => dailyInvSeries(data?.inventoryHistory || []), [data]);

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

            <UploadBsx onUploaded={() => setReloadTick((n) => n + 1)} />

            <nav className="inv-tabs-nav">
                <button
                    type="button"
                    className={`inv-tabs-nav__btn ${tab === 'sales' ? 'inv-tabs-nav__btn--active' : ''}`}
                    onClick={() => setTab('sales')}
                >
                    Ventes
                </button>
                <button
                    type="button"
                    className={`inv-tabs-nav__btn ${tab === 'inventory' ? 'inv-tabs-nav__btn--active' : ''}`}
                    onClick={() => setTab('inventory')}
                >
                    Inventaire
                </button>
            </nav>

            {tab === 'sales' && (
                <>
                    <section className="inv-kpis">
                        <Kpi
                            label="Aujourd'hui"
                            value={totals.last ? fmtMoney(totals.last.payout) : '—'}
                            sub={totals.last ? `${fmtInt(totals.last.parts)} pièces · ${fmtInt(totals.last.lots)} lots` : null}
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

                    <section className="inv-kpis">
                        <Kpi
                            label="Moyenne quotidienne (30j)"
                            value={fmtMoney(derived.avgDaily)}
                        />
                        <Kpi
                            label="Ratio ventes / inventaire (30j)"
                            value={
                                derived.salesRatio == null
                                    ? '—'
                                    : `${(derived.salesRatio * 100).toLocaleString('fr-CA', { maximumFractionDigits: 2 })} %`
                            }
                            sub={
                                derived.medianInvValue
                                    ? `Médiane inventaire : ${fmtMoney(derived.medianInvValue)} (${derived.invSnapCount} snapshots)`
                                    : null
                            }
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
                </>
            )}

            {tab === 'inventory' && (
                <>
                    <section className="inv-kpis">
                        <Kpi
                            label="Lots actifs"
                            value={fmtInt(inv.totalLots)}
                        />
                        <Kpi
                            label="Pièces totales"
                            value={fmtInt(inv.totalParts)}
                        />
                        <Kpi
                            label="Valeur estimée"
                            value={fmtMoney(inv.totalValue)}
                        />
                        <Kpi
                            label="Snapshots enregistrés"
                            value={fmtInt(invSeries.length)}
                            sub={invSeries[0] ? `Depuis ${invSeries[0].date}` : null}
                        />
                    </section>

                    <section className="inv-card">
                        <div className="inv-card__head"><h2>Valeur de l'inventaire</h2></div>
                        {invSeries.length === 0 ? (
                            <div className="inv-empty">Pas encore d'historique. Le premier snapshot sera enregistré au prochain ingest ou à la prochaine fusion.</div>
                        ) : (
                            <div className="inv-chart">
                                <ResponsiveContainer width="100%" height={240}>
                                    <LineChart data={invSeries} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                                        <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtMoneyShort} />
                                        <Tooltip formatter={(v) => fmtMoney(v)} labelStyle={{ fontWeight: 700 }} />
                                        <Line type="monotone" dataKey="totalValue" stroke="#4F46E5" strokeWidth={2} dot={{ r: 3 }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </section>

                    <section className="inv-card">
                        <div className="inv-card__head"><h2>Pièces en stock</h2></div>
                        {invSeries.length === 0 ? (
                            <div className="inv-empty">Pas encore d'historique.</div>
                        ) : (
                            <div className="inv-chart">
                                <ResponsiveContainer width="100%" height={220}>
                                    <LineChart data={invSeries} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                                        <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtInt} />
                                        <Tooltip formatter={(v) => fmtInt(v)} labelStyle={{ fontWeight: 700 }} />
                                        <Line type="monotone" dataKey="totalParts" stroke="#10B981" strokeWidth={2} dot={{ r: 3 }} />
                                        <Line type="monotone" dataKey="totalLots" stroke="#F59E0B" strokeWidth={2} dot={{ r: 3 }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </section>
                </>
            )}
        </div>
    );
}
