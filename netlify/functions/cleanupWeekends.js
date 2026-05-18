import {
    readSalesHistory,
    writeSalesHistory,
    readInventoryHistory,
    writeInventoryHistory,
} from '../lib/blobs.js';
import { jsonResponse } from '../lib/http.js';

const isWeekendYmd = (s) => {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return false;
    const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
    return day === 0 || day === 6;
};

const auth = (event) => {
    const expected = process.env.INGEST_TOKEN;
    if (!expected) return true;
    const got = event.headers?.authorization || event.headers?.Authorization || '';
    return got === `Bearer ${expected}`;
};

const summarize = (entries) =>
    entries.map((e) => ({ date: e?.date, payout: e?.payout, total: e?.total }));

export const handler = async (event) => {
    if (!auth(event)) return jsonResponse(401, { error: 'unauthorized' });

    // Default-safe: must pass ?apply=1 to actually write.
    const qs = event.queryStringParameters || {};
    const apply = qs.apply === '1';

    const [sales, inventory] = await Promise.all([
        readSalesHistory(),
        readInventoryHistory(),
    ]);

    const salesKeep = sales.filter((e) => !isWeekendYmd(e?.date));
    const salesRemoved = sales.filter((e) => isWeekendYmd(e?.date));
    const invKeep = inventory.filter((e) => !isWeekendYmd(e?.date));
    const invRemoved = inventory.filter((e) => isWeekendYmd(e?.date));

    const report = {
        apply,
        sales: {
            before: sales.length,
            after: salesKeep.length,
            removed: salesRemoved.length,
            removedDates: summarize(salesRemoved),
        },
        inventory: {
            before: inventory.length,
            after: invKeep.length,
            removed: invRemoved.length,
            removedDates: invRemoved.map((e) => ({ date: e?.date, source: e?.source })),
        },
    };

    if (!apply) {
        report.note = 'Dry run. Pass ?apply=1 to write the filtered blobs.';
        return jsonResponse(200, report);
    }

    await Promise.all([
        salesRemoved.length ? writeSalesHistory(salesKeep) : null,
        invRemoved.length ? writeInventoryHistory(invKeep) : null,
    ]);

    return jsonResponse(200, report);
};
