import { useEffect, useMemo, useRef, useState } from 'react';
import {
    LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
    BarChart, Bar, Legend,
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
                        Fusionne les lots d'un <code>.bsx</code> dans l'inventaire maître. Le mode gère les collisions
                        (même <code>ItemID</code> + couleur + état).
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

function RunIngest() {
    const [token, setToken] = useState(() => {
        try { return localStorage.getItem(TOKEN_STORAGE_KEY) || ''; } catch { return ''; }
    });
    const [date, setDate] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 1);   // default: yesterday
        return d.toISOString().slice(0, 10);
    });
    const [source, setSource] = useState('');   // '' = both CA + US
    const [replace, setReplace] = useState(false);
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
        if (!date) return;
        setBusy(true);
        setResult(null);
        setErr(null);
        try {
            const params = new URLSearchParams({ date });
            if (source) params.set('source', source);
            if (replace) params.set('replace', '1');
            const res = await fetch(`/.netlify/functions/runIngestNow?${params.toString()}`, {
                method: 'POST',
                headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
            setResult(data);
        } catch (e) {
            setErr(e.message);
        } finally {
            setBusy(false);
        }
    };

    const alertSent = result?.alerts?.some((a) => a.sent);
    const sourceErrors = (result?.sources || []).filter((s) => s.error);
    const posted = result?.sheets?.step === 'sheets_posted';

    return (
        <section className="inv-card inv-upload">
            <div className="inv-card__head">
                <h2>Ingérer une journée</h2>
                <button type="button" className="inv-tab" onClick={() => setOpen((v) => !v)}>
                    {open ? 'Fermer' : 'Ouvrir'}
                </button>
            </div>
            {open && (
                <div className="inv-upload__body">
                    <p className="inv-upload__hint">
                        Relance l'ingestion CFB d'une journée (décrémente l'inventaire, poste la ligne quotidienne).
                    </p>
                    <div className="inv-upload__row">
                        <label>
                            Journée&nbsp;:{' '}
                            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} />
                        </label>
                    </div>
                    <div className="inv-upload__row">
                        <label>
                            Source&nbsp;:{' '}
                            <select value={source} onChange={(e) => setSource(e.target.value)} disabled={busy}>
                                <option value="">Les deux (CA + US)</option>
                                <option value="CA">CA seulement</option>
                                <option value="US">US seulement</option>
                            </select>
                        </label>
                    </div>
                    <div className="inv-upload__row">
                        <label>
                            <input
                                type="checkbox"
                                checked={replace}
                                onChange={(e) => setReplace(e.target.checked)}
                                disabled={busy}
                            />
                            {' '}Remplacer une journée déjà enregistrée (corriger un faux zéro laissé par un token expiré)
                        </label>
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
                            disabled={!date || busy}
                        >
                            {busy ? 'Ingestion en cours…' : (replace ? 'Remplacer cette journée' : 'Ingérer cette journée')}
                        </button>
                    </div>
                    {result && (
                        <div className="inv-upload__ok">
                            {alertSent && (
                                <div>🔒 Session CFB expirée détectée — courriel d'alerte envoyé. Vérifie ta boîte pour réinitialiser le token.</div>
                            )}
                            {!alertSent && posted && (
                                <div>
                                    ✓ Journée {result.date} ingérée · {fmtInt(result.sheets.combined.parts)} pièces ·
                                    {' '}payout {fmtMoney(result.sheets.combined.payout)}
                                </div>
                            )}
                            {!alertSent && !posted && <div>✓ Terminé pour {result.date} (rien à poster).</div>}
                            {sourceErrors.length > 0 && (
                                <ul>
                                    {sourceErrors.map((s) => <li key={s.source}>{s.source} : {s.error}</li>)}
                                </ul>
                            )}
                        </div>
                    )}
                    {err && <div className="inv-upload__err">⚠ {err}</div>}
                </div>
            )}
        </section>
    );
}

const ymdLocal = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

// Default period = the whole previous calendar month (what the monthly cron bills).
const defaultInvoiceRange = () => {
    const now = new Date();
    const firstThis = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastPrev = new Date(firstThis.getTime() - 86400000);
    const firstPrev = new Date(lastPrev.getFullYear(), lastPrev.getMonth(), 1);
    return { start: ymdLocal(firstPrev), end: ymdLocal(lastPrev) };
};

function InvoiceGenerator() {
    const [token, setToken] = useState(() => {
        try { return localStorage.getItem(TOKEN_STORAGE_KEY) || ''; } catch { return ''; }
    });
    const initial = defaultInvoiceRange();
    const [start, setStart] = useState(initial.start);
    const [end, setEnd] = useState(initial.end);
    const [to, setTo] = useState('');
    const [spreadPct, setSpreadPct] = useState('');   // conversion fee %, e.g. "1" = 1%
    const [genCfb, setGenCfb] = useState(true);
    const [genUfb, setGenUfb] = useState(true);
    const [dryRun, setDryRun] = useState(false);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);
    const [err, setErr] = useState(null);

    const persistToken = (v) => {
        setToken(v);
        try {
            if (v) localStorage.setItem(TOKEN_STORAGE_KEY, v);
            else localStorage.removeItem(TOKEN_STORAGE_KEY);
        } catch { /* ignore */ }
    };

    const submit = async () => {
        if (!start || !end) return;
        if (start > end) { setErr('La date de début est après la date de fin.'); return; }
        const kinds = [genCfb && 'CFB', genUfb && 'UFB'].filter(Boolean);
        if (!kinds.length) { setErr('Choisis au moins une facture (CFB ou UFB).'); return; }
        setBusy(true);
        setResult(null);
        setErr(null);
        try {
            const params = new URLSearchParams({ start, end });
            params.set('kinds', kinds.join(','));
            if (to) params.set('to', to);
            if (spreadPct !== '') params.set('spread', String(Number(spreadPct) / 100));
            if (dryRun) params.set('dryRun', '1');
            const res = await fetch(`/.netlify/functions/runInvoiceNow?${params.toString()}`, {
                method: 'POST',
                headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
            setResult(data);
        } catch (e) {
            setErr(e.message);
        } finally {
            setBusy(false);
        }
    };

    const invoices = result?.invoices ? [result.invoices.CFB, result.invoices.UFB] : [];

    return (
        <section className="inv-card inv-upload">
            <div className="inv-card__head">
                <h2>Générer les factures</h2>
            </div>
            <div className="inv-upload__body">
                <div className="inv-upload__row">
                    <label>
                        Du&nbsp;:{' '}
                        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} disabled={busy} />
                    </label>
                    {'  '}
                    <label>
                        Au&nbsp;:{' '}
                        <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} disabled={busy} />
                    </label>
                </div>
                <div className="inv-upload__row">
                    Factures&nbsp;:{' '}
                    <label>
                        <input type="checkbox" checked={genCfb} onChange={(e) => setGenCfb(e.target.checked)} disabled={busy} />
                        {' '}CFB (Canada)
                    </label>
                    {'   '}
                    <label>
                        <input type="checkbox" checked={genUfb} onChange={(e) => setGenUfb(e.target.checked)} disabled={busy} />
                        {' '}UFB (USA)
                    </label>
                </div>
                <div className="inv-upload__row">
                    <label>
                        Envoyer à (optionnel)&nbsp;:{' '}
                        <input
                            type="email"
                            placeholder="par défaut : ton courriel configuré"
                            value={to}
                            onChange={(e) => setTo(e.target.value)}
                            disabled={busy}
                            style={{ minWidth: 260 }}
                        />
                    </label>
                </div>
                <div className="inv-upload__row">
                    <label>
                        Frais de conversion % (optionnel, UFB)&nbsp;:{' '}
                        <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="défaut : 1 %"
                            value={spreadPct}
                            onChange={(e) => setSpreadPct(e.target.value)}
                            disabled={busy}
                            style={{ minWidth: 160 }}
                        />
                    </label>
                </div>
                <div className="inv-upload__row">
                    <label>
                        <input
                            type="checkbox"
                            checked={dryRun}
                            onChange={(e) => setDryRun(e.target.checked)}
                            disabled={busy}
                        />
                        {' '}Aperçu seulement (calcule et génère les PDF sans envoyer le courriel)
                    </label>
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
                        disabled={!start || !end || busy}
                    >
                        {busy ? 'Génération en cours…' : (dryRun ? 'Générer l\'aperçu' : 'Générer et envoyer')}
                    </button>
                </div>

                {result && (
                    <div className="inv-upload__ok">
                        {result.draft && (
                            <div style={{ color: '#7a5b00', marginBottom: 8 }}>
                                ⚠ Coordonnées légales incomplètes — les PDF portent la mention « BROUILLON ».
                            </div>
                        )}
                        <div style={{ marginBottom: 8 }}>
                            {result.emailed
                                ? `✓ Factures envoyées à ${result.recipient}`
                                : '✓ Aperçu généré (courriel non envoyé)'}
                            {result.fx?.rate && (
                                <span> · taux BoC {result.fx.rate}
                                    {result.fx.rateDate ? ` (${result.fx.rateDate})` : ''}</span>
                            )}
                        </div>
                        <table className="inv-invoice-table">
                            <thead>
                                <tr>
                                    <th>No</th><th>Ventes</th>
                                    <th style={{ textAlign: 'right' }}>Pièces</th>
                                    <th style={{ textAlign: 'right' }}>Ventes brutes</th>
                                    <th style={{ textAlign: 'right' }}>Total (taxes incl.)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {invoices.map((inv) => (
                                    <tr key={inv.number}>
                                        <td>{inv.number}</td>
                                        <td>{inv.store}</td>
                                        <td style={{ textAlign: 'right' }}>{fmtInt(inv.parts)}</td>
                                        <td style={{ textAlign: 'right' }}>
                                            {fmtMoney(inv.grossCad)}
                                            {inv.grossUsd != null && (
                                                <span style={{ color: '#888' }}> ({fmtInt(inv.grossUsd)} USD)</span>
                                            )}
                                        </td>
                                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtMoney(inv.total)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                {err && <div className="inv-upload__err">⚠ {err}</div>}
            </div>
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

// Probe both CFB sessions; an expired one triggers the reset-email flow server-side.
function CookieCheck() {
    const [token, setToken] = useState(() => {
        try { return localStorage.getItem(TOKEN_STORAGE_KEY) || ''; } catch { return ''; }
    });
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

    const test = async () => {
        setBusy(true);
        setResult(null);
        setErr(null);
        try {
            const res = await fetch('/.netlify/functions/checkCookies', {
                method: 'POST',
                headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
            setResult(data);
        } catch (e) {
            setErr(e.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="inv-card inv-upload">
            <div className="inv-card__head">
                <h2>Tester les sessions CFB</h2>
                <button type="button" className="inv-tab" onClick={() => setOpen((v) => !v)}>
                    {open ? 'Fermer' : 'Ouvrir'}
                </button>
            </div>
            {open && (
                <div className="inv-upload__body">
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
                        <button type="button" className="inv-upload__submit" onClick={test} disabled={busy}>
                            {busy ? 'Test en cours…' : 'Tester les cookies (CA + US)'}
                        </button>
                    </div>
                    {result && (
                        <div className="inv-upload__ok">
                            {result.results.map((r) => (
                                <div key={r.source}>
                                    {r.ok ? '✓' : '⚠'} {r.source} :{' '}
                                    {r.ok ? 'session valide' : (r.authExpired ? 'session expirée' : 'erreur')}
                                    {r.resetEmailSent && ' — courriel de réinitialisation envoyé'}
                                    {!r.ok && !r.authExpired && r.error ? ` (${r.error})` : ''}
                                </div>
                            ))}
                        </div>
                    )}
                    {err && <div className="inv-upload__err">⚠ {err}</div>}
                </div>
            )}
        </section>
    );
}

// Look up a single day's sales, split CFB (Canada) vs UFB (USA). Reads the daily
// buckets already loaded — no extra request. US money is stored in CAD.
function DaySales({ daily }) {
    const latest = daily.length ? daily[daily.length - 1].key : '';
    const [date, setDate] = useState(latest);
    const day = daily.find((d) => d.key === date) || null;
    const ca = day?.bySource?.CA || null;
    const us = day?.bySource?.US || null;

    const col = (s) => (
        <>
            <td className="num">{s ? fmtInt(s.parts) : '—'}</td>
            <td className="num">{s ? fmtMoney(s.total) : '—'}</td>
            <td className="num">{s ? fmtMoney(s.payout) : '—'}</td>
        </>
    );

    return (
        <section className="inv-card">
            <div className="inv-card__head">
                <h2>Ventes d'une journée</h2>
                <input
                    type="date"
                    value={date}
                    max={latest || undefined}
                    onChange={(e) => setDate(e.target.value)}
                />
            </div>
            {!day ? (
                <div className="inv-empty">Aucune vente enregistrée le {date || '—'}.</div>
            ) : (
                <table className="inv-day-table">
                    <thead>
                        <tr>
                            <th>Source</th>
                            <th className="num">Pièces</th>
                            <th className="num">Ventes brutes</th>
                            <th className="num">Payout</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr><td>CFB (Canada)</td>{col(ca)}</tr>
                        <tr><td>UFB (USA)</td>{col(us)}</tr>
                        <tr className="inv-day-table__total">
                            <td>Total</td>
                            <td className="num">{fmtInt(day.parts)}</td>
                            <td className="num">{fmtMoney(day.total)}</td>
                            <td className="num">{fmtMoney(day.payout)}</td>
                        </tr>
                    </tbody>
                </table>
            )}
        </section>
    );
}

export default function InventoryDashboard() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState(null);
    const [range, setRange] = useState(30);
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');
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

    const dailySeries = useMemo(() => {
        const all = data?.sales?.daily || [];
        if (range === 'custom') {
            if (!customStart || !customEnd) return all;
            return all.filter((e) => e.key >= customStart && e.key <= customEnd);
        }
        return pickRange(all, range);
    }, [data, range, customStart, customEnd]);

    // Flatten per-source gross sales for the daily chart (CFB = CA, UFB = US).
    const chartData = useMemo(
        () => dailySeries.map((d) => ({
            key: d.key,
            cfb: d.bySource?.CA?.total || 0,
            ufb: d.bySource?.US?.total || 0,
        })),
        [dailySeries],
    );

    // Aggregate the currently-displayed range, split by source (CFB = CA, UFB = US).
    const windowStats = useMemo(() => {
        const z = () => ({ parts: 0, total: 0, payout: 0, fees: 0 });
        const acc = { ...z(), CA: z(), US: z() };
        for (const d of dailySeries) {
            acc.parts += d.parts || 0; acc.total += d.total || 0;
            acc.payout += d.payout || 0; acc.fees += d.fees || 0;
            for (const src of ['CA', 'US']) {
                const s = d.bySource?.[src];
                if (!s) continue;
                acc[src].parts += s.parts || 0; acc[src].total += s.total || 0;
                acc[src].payout += s.payout || 0; acc[src].fees += s.fees || 0;
            }
        }
        return acc;
    }, [dailySeries]);

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
            <RunIngest />
            <CookieCheck />

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
                <button
                    type="button"
                    className={`inv-tabs-nav__btn ${tab === 'invoice' ? 'inv-tabs-nav__btn--active' : ''}`}
                    onClick={() => setTab('invoice')}
                >
                    Factures
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

                    <DaySales daily={sales.daily || []} />

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
                                <button
                                    className={`inv-tab ${range === 'custom' ? 'inv-tab--active' : ''}`}
                                    onClick={() => setRange('custom')}
                                >
                                    Intervalle
                                </button>
                            </div>
                        </div>

                        {range === 'custom' && (
                            <div className="inv-range-custom">
                                <label>Du{' '}
                                    <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
                                </label>
                                <label>Au{' '}
                                    <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
                                </label>
                            </div>
                        )}

                        <div className="inv-substats">
                            <div><span>Pièces</span><strong>{fmtInt(windowStats.parts)}</strong></div>
                            <div><span>Ventes brutes</span><strong>{fmtMoney(windowStats.total)}</strong></div>
                            <div><span>Payout</span><strong>{fmtMoney(windowStats.payout)}</strong></div>
                            <div><span>Frais</span><strong>{fmtMoney(windowStats.fees)}</strong></div>
                            <div>
                                <span>CFB (Canada)</span>
                                <strong>{fmtMoney(windowStats.CA.payout)}</strong>
                                <small>{fmtInt(windowStats.CA.parts)} pièces</small>
                            </div>
                            <div>
                                <span>UFB (USA)</span>
                                <strong>{fmtMoney(windowStats.US.payout)}</strong>
                                <small>{fmtInt(windowStats.US.parts)} pièces</small>
                            </div>
                        </div>

                        <div className="inv-chart">
                            <ResponsiveContainer width="100%" height={280}>
                                <LineChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                    <XAxis dataKey="key" tick={{ fontSize: 11 }} />
                                    <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtMoneyShort} />
                                    <Tooltip formatter={(v) => fmtMoney(v)} labelStyle={{ fontWeight: 700 }} />
                                    <Legend />
                                    <Line type="monotone" dataKey="cfb" name="CFB (Canada)" stroke="#10B981" strokeWidth={2} dot={false} />
                                    <Line type="monotone" dataKey="ufb" name="UFB (USA)" stroke="#4F46E5" strokeWidth={2} dot={false} />
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
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </section>

                    <section className="inv-card">
                        <div className="inv-card__head"><h2>Lots en stock</h2></div>
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
                                        <Line type="monotone" dataKey="totalLots" stroke="#F59E0B" strokeWidth={2} dot={{ r: 3 }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </section>
                </>
            )}

            {tab === 'invoice' && <InvoiceGenerator />}
        </div>
    );
}
