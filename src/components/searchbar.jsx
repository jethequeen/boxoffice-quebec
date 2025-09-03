import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './searchBar.css';

export default function SearchBar() {
    const [q, setQ] = useState('');
    const [results, setResults] = useState({ movies: [], people: [] });
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const [flat, setFlat] = useState([]);
    const [activeIdx, setActiveIdx] = useState(-1);
    const boxRef = useRef(null);
    const navigate = useNavigate();
    const abortRef = useRef();

// 1) Flatten safely
    useEffect(() => {
        const movies = Array.isArray(results?.movies) ? results.movies : [];
        const people = Array.isArray(results?.people) ? results.people : [];
        const f = [];
        movies.forEach(x => f.push({ ...x, type: 'movie' }));
        people.forEach(x => f.push({ ...x, type: 'person' }));
        setFlat(f);
        setActiveIdx(f.length ? 0 : -1);
    }, [results]);

    useEffect(() => {
        if (q.trim().length < 2) {
            setResults({ movies: [], people: [] });
            setOpen(false);
            if (abortRef.current) abortRef.current.abort();
            return;
        }
        const t = setTimeout(async () => {
            try {
                setLoading(true);
                if (abortRef.current) abortRef.current.abort();
                const ctl = new AbortController();
                abortRef.current = ctl;

                const res = await fetch(`/.netlify/functions/search?q=${encodeURIComponent(q.trim())}`, { signal: ctl.signal });

                if (!res.ok) {
                    console.error('search http error', res.status);
                    setResults({ movies: [], people: [] });
                    setOpen(false);                 // ✅ don’t flash the panel on errors
                    return;
                }

                const data = await res.json().catch(() => null);
                const movies = Array.isArray(data?.movies) ? data.movies : [];
                const people = Array.isArray(data?.people) ? data.people : [];

                setResults({ movies, people });
                setOpen(true);                    // ✅ only open when we have a response
            } catch (e) {
                if (e.name !== 'AbortError') console.error('search failed:', e);
                setResults({ movies: [], people: [] });
                setOpen(false);
            } finally {
                setLoading(false);
            }
        }, 200);
        return () => clearTimeout(t);
    }, [q]);


    useEffect(() => {
        const onClick = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, []);

    const goto = (item) => {
        setOpen(false);
        if (item.type === 'movie') navigate(`/movies/${item.id}`);
        else navigate(`/crew/${item.id}`); // person
    };

    const onKeyDown = (e) => {
        if (!open || !flat.length) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => (i + 1) % flat.length); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => (i - 1 + flat.length) % flat.length); }
        else if (e.key === 'Enter') { e.preventDefault(); if (activeIdx >= 0) goto(flat[activeIdx]); }
        else if (e.key === 'Escape') setOpen(false);
    };

    const Group = ({ title, items, type }) => {
        if (!items?.length) return null;
        return (
            <div className="sr-group">
                <div className="sr-group-title">{title}</div>
                {items.map((it) => {
                    const globalIdx = flat.findIndex(f => f.type === type && f.id === it.id);
                    const active = globalIdx === activeIdx;
                    return (
                        <button
                            key={`${type}-${it.id}`}
                            className={`sr-item ${active ? 'active' : ''}`}
                            onMouseEnter={() => setActiveIdx(globalIdx)}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => goto({ ...it, type })}
                            title={it.label}
                        >
                            <div className="sr-item-main">
                                <span className="sr-label">{it.label}</span>
                                {/* Movies: show director; People: show role */}
                                {type === 'movie' && it.extra && <span className="sr-extra">· {it.extra}</span>}
                                {type === 'person' && it.role && <span className="sr-extra">· {it.role}</span>}
                            </div>
                        </button>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="searchbar" ref={boxRef}>
            <span className="search-icon" aria-hidden>🔎</span>
            <input
                className="search-input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onFocus={() => q.trim().length >= 2 && setOpen(true)}
                onKeyDown={onKeyDown}
                placeholder="Rechercher films et personnes…"
                aria-label="Recherche"
                autoComplete="off"
            />
            {loading && <span className="search-spinner" aria-hidden />}

            {open && (
                <div className="search-results" role="listbox">
                    <Group title="Films"   items={results.movies} type="movie" />
                    <Group title="Personnes" items={results.people} type="person" />
                    {!loading && !flat.length && <div className="sr-empty">Aucun résultat</div>}
                </div>
            )}
        </div>
    );
}
