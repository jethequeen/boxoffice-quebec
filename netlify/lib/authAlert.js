import { addPendingBackfill, readPendingBackfill } from './blobs.js';
import { sendAuthExpiredEmail } from './email.js';
import { CfbAuthError } from './cfb.js';

/**
 * Shared handling for expired-CFB-session errors across the ingest entry points
 * (daily cron, weekly cron, manual runIngestNow). Keeps the queue-and-alert
 * behaviour identical everywhere instead of copy-pasted three times.
 */

export const isAuthError = (e) => e instanceof CfbAuthError || e?.authExpired === true;

/**
 * If `e` is an expired-session error, queue the missed day for backfill and return
 * true (so the caller can collect the source for a single post-loop alert). Any
 * other error returns false and is left for the caller to handle/log.
 */
export async function queueAuthFailure(e, { date, source }) {
    if (!isAuthError(e)) return false;
    await addPendingBackfill(date, source);
    return true;
}

/**
 * Send one alert email per distinct source, each carrying that source's queued
 * backfill days and a signed magic link to the reset page. Records the outcome on
 * `log.alerts`; never throws (a mail failure must not fail the ingest).
 */
export async function alertAuthFailures(sources, log) {
    for (const source of new Set(sources)) {
        try {
            const missed = (await readPendingBackfill()).filter((p) => p.source === source);
            await sendAuthExpiredEmail({ source, missed });
            (log.alerts ||= []).push({ source, sent: true });
        } catch (err) {
            (log.alerts ||= []).push({ source, sent: false, error: err.message });
            console.error(`[authAlert:${source}] alert failed`, err);
        }
    }
}
