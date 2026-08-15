import { readInventoryHistory } from '../lib/blobs.js';
import { jsonResponse } from '../lib/http.js';

/**
 * Inventory snapshot history for the "Inventaire" tab charts. Loaded lazily (when
 * that tab opens) so the initial dashboard load stays light. Downsampled to the
 * latest snapshot PER DAY here — several writes can hit the same day (daily ingest +
 * a manual merge), and the charts only plot one point per day anyway.
 */
export const handler = async () => {
    try {
        const raw = await readInventoryHistory();
        const byDate = new Map();
        for (const s of raw) {
            if (!s?.date) continue;
            const cur = byDate.get(s.date);
            if (!cur || (s.timestamp || '') > (cur.timestamp || '')) byDate.set(s.date, s);
        }
        const history = [...byDate.values()]
            .map((s) => ({
                date: s.date,
                totalValue: s.totalValue,
                totalParts: s.totalParts,
                totalLots: s.totalLots,
                timestamp: s.timestamp,
            }))
            .sort((a, b) => a.date.localeCompare(b.date));

        return jsonResponse(200, { history });
    } catch (e) {
        console.error('[getInventoryHistory]', e);
        return jsonResponse(500, { error: e.message });
    }
};
