/**
 * Weekend ID helpers (YYYYWW, ISO-year + ISO-week)
 */

export const getCurrentWeekendId = () => {
  const friday = getWeekendFriday(new Date());
  return weekendIdFromDate(friday);
};

const weekendIdFromDate = (date) => {
  const { isoYear, isoWeek } = getISOWeekParts(date);
  return `${isoYear}${String(isoWeek).padStart(2, '0')}`;
};

const getISOWeekParts = (date) => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7)); // Thursday of this ISO week
  const isoYear = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const isoWeek = 1 + Math.round(
      ((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7
  );
  return { isoYear, isoWeek };
};

/**
 * Friday for the “current” weekend.
 * - Fri → that same Friday
 * - Sat → yesterday (Friday)
 * - Sun → two days ago (Friday)
 * - Mon–Thu → the previous Friday
 */
const getWeekendFriday = (now) => {
  const day = now.getDay(); // 0=Sun..6=Sat
  const delta =
      day === 5 ? 0 :     // Fri
          day === 6 ? 1 :     // Sat
              day === 0 ? 2 :     // Sun
                  day + 2;            // Mon(1)→3, Tue(2)→4, Wed(3)→5, Thu(4)→6
  const fri = new Date(now);
  fri.setDate(now.getDate() - delta);
  return fri;
};

/** Format: "2025, Week 28" */
export const formatWeekendId = (weekendId) => {
  if (!weekendId) return 'N/A';
  const s = String(weekendId);
  const year = s.slice(0, 4);
  const week = s.slice(4);
  return `Week ${parseInt(week, 10)}, ${year}`;
};

/** Parse { year, week } from YYYYWW */
export const parseWeekendId = (weekendId) => {
  if (!weekendId) return null;
  const s = String(weekendId);
  return { year: parseInt(s.slice(0, 4), 10), week: parseInt(s.slice(4), 10) };
};

/** Friday date for a given YYYYWW (returns a real Date) */
export const getFridayFromWeekendId = (weekendId) => {
  const parts = parseWeekendId(weekendId);
  if (!parts) return null;
  const { year, week } = parts;

  // Monday of ISO week 1 (UTC)
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));

  // Friday = Monday + (week-1)*7 + 4 (UTC)
  const fri = new Date(mondayWeek1);
  fri.setUTCDate(mondayWeek1.getUTCDate() + (week - 1) * 7 + 4);

  // ⛳️ anchor at noon UTC so local time never rolls back to Thursday
  fri.setUTCHours(12, 0, 0, 0);

  return fri;
};


/** Previous weekend ID (handles year boundaries via date math) */
export const getPreviousWeekendId = (weekendId) => {
  const fri = getFridayFromWeekendId(weekendId);
  if (!fri) return null;
  const prevFri = new Date(fri);
  prevFri.setUTCDate(prevFri.getUTCDate() - 7);
  return weekendIdFromDate(prevFri);
};

/** Next weekend ID (handles year boundaries via date math) */
export const getNextWeekendId = (weekendId) => {
  const fri = getFridayFromWeekendId(weekendId);
  if (!fri) return null;
  const nextFri = new Date(fri);
  nextFri.setUTCDate(nextFri.getUTCDate() + 7);
  return weekendIdFromDate(nextFri);
};

// Accepts "YYYY-MM-DD" and returns your 6-digit weekendId.
// Supports either "YYYYWW" or "WWYYYY" as your canonical format—pick one and stick to it.
// Below I’ll produce "YYYYWW".
export function weekendIdFromDateString(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${dateStr}`);

  // Get ISO week number
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // Thursday in current week decides the year per ISO 8601
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);

  const yyyy = String(date.getUTCFullYear());
  const ww = String(week).padStart(2, '0');

  return `${yyyy}${ww}`; // canonical weekendId = YYYYWW
}
