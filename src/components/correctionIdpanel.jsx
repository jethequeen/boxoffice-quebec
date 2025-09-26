import { useState } from "react";
import { apiCall } from "../utils/api";
import { getMovieDetails, correctMovieID } from '../utils/api';


export default function CorrectionIdpanel({ tempId, onSuccess }) {
    const [newId, setNewId] = useState("");
    const [loading, setLoading] = useState(false);
    const [preview, setPreview] = useState(null);
    const [error, setError] = useState(null);
    const numeric = v => /^\d+$/.test(v.trim());

    async function handlePreview() {
        setError(null);
        setPreview(null);
        if (!numeric(newId)) { setError("L’ID doit être numérique."); return; }
        if (String(newId) === String(tempId)) { setError("L’ID doit être différent de l’actuel."); return; }
        try {
            setLoading(true);
            const data = await getMovieDetails(newId);
            setPreview({
                id: newId,
                title: data?.movie?.fr_title || data?.movie?.title || "(titre inconnu)",
                year: data?.movie?.release_date ? new Date(data.movie.release_date).getFullYear() : "",
                poster: data?.movie?.poster_path ? `https://image.tmdb.org/t/p/w154${data.movie.poster_path}` : null
            });
        } catch (e) {
            setError("Impossible de prévisualiser ce film.");
        } finally {
            setLoading(false);
        }
    }

    async function handleSubmit() {
        setError(null);
        if (!numeric(newId)) { setError("L’ID doit être numérique."); return; }
        try {
            setLoading(true);
            const res = await apiCall("correctMovieID", { method: "POST", body: { tempId: Number(tempId), newId: Number(newId) }});
            // Feedback rapide + redirection
            onSuccess?.(Number(res?.newId || newId));
        } catch (e) {
            setError("La correction a échoué. Vérifie l’ID ou réessaie.");
        } finally {
            setLoading(false);
        }
    }


    return (
        <div className="idfix">
            <p className="idfix__hint">
                Cet enregistrement utilise un <strong>ID temporaire</strong> ({tempId}). Entrez l’ID TMDb (ou l’ID réel) pour le corriger dans la base.
            </p>

            <div className="idfix__row">
                <input
                    className="idfix__input"
                    placeholder="Nouvel ID (ex. 299536)"
                    value={newId}
                    onChange={e => setNewId(e.target.value)}
                    inputMode="numeric"
                />
                <button className="btn" onClick={handlePreview} disabled={loading}>Prévisualiser</button>
                <button className="btn btn--primary" onClick={handleSubmit} disabled={loading || !numeric(newId)}>Corriger</button>
            </div>

            {error && <div className="idfix__error">{error}</div>}

            {preview && (
                <div className="idfix__preview">
                    {preview.poster && <img src={preview.poster} alt="" />}
                    <div className="idfix__meta">
                        <div className="idfix__title">{preview.title}</div>
                        <div className="idfix__subtitle">ID cible : {preview.id}{preview.year ? ` • ${preview.year}` : ""}</div>
                    </div>
                </div>
            )}

            <ul className="idfix__notes">
                <li>Une fois confirmé, l’ID temporaire sera relié au nouvel ID (toutes les tables impactées devront être migrées côté serveur).</li>
                <li>Action **irréversible** sans script de rollback; garde une trace des corrections.</li>
            </ul>
        </div>
    );
}
