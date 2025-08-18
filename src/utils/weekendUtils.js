/**
 * Weekend ID helpers (YYYYWW, ISO-year + ISO-week)
 */

export const getCurrentWeekendId = () => {
  const lastFriday = getLastFriday(new Date());
  return weekendIdFromDate(lastFriday);
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

/** Last Friday, with your “late weekend window” rule */
const getLastFriday = (date) => {
  const now = new Date(date);
  const day = now.getDay(); // 0..6, Sun=0
  const hour = now.getHours();

  const base = new Date(now);
  const daysToSubtract = day >= 5 ? day - 5 : day + 2; // back to Friday
  base.setDate(now.getDate() - daysToSubtract);

  const isLateWeekendWindow = (day === 5 || day === 6 || day === 0) || (day === 1 && hour < 15);
  if (isLateWeekendWindow) base.setDate(base.getDate() - 7);

  return base;
};

/** Format: "Week 28, 2025" */
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

/** Friday date for a given YYYYWW */
export const getFridayFromWeekendId = (weekendId) => {
  const parts = parseWeekendId(weekendId);
  if (!parts) return null;
  const { year, week } = parts;

  // Monday of ISO week 1
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));

  // Friday of requested week (Mon + (week-1)*7 + 4)
  const fri = new Date(mondayWeek1);
  fri.setUTCDate(mondayWeek1.getUTCDate() + (week - 1) * 7 + 4);
  return new Date(fri.getTime());
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
