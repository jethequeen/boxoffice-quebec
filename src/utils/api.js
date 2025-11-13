// src/utils/api.js

// ---- Config ----
// Prefer a single override for local dev if you run Vite separately from `netlify dev`.
// If you run `netlify dev`, you can leave VITE_API_BASE undefined (same origin).
const API_BASE =
    import.meta.env.VITE_API_BASE   // e.g. "http://localhost:8888"
    || window.location.origin;      // prod/preview or netlify dev proxy

// ---- Helpers ----
const withTimeout = (ms = 15000) => {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, cancel: () => clearTimeout(id) };
};

const buildUrl = (endpoint, query) => {
  const u = new URL(`/.netlify/functions/${endpoint}`, API_BASE);
  if (query && typeof query === 'object') {
    Object.entries(query).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      if (Array.isArray(v)) v.forEach(val => u.searchParams.append(k, String(val)));
      else u.searchParams.set(k, String(v));
    });
  }
  return u.toString();
};

const handleResponse = async (res) => {
  let data;
  try {
    data = await res.json();
  } catch {
    // Fallback if server didn’t send JSON
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }
  if (!res.ok) {
    const msg = data?.error || data?.message || `HTTP ${res.status}`;
    const e = new Error(msg);
    e.details = data;
    throw e;
  }
  return data;
};

// ---- Core caller ----
export const apiCall = async (endpoint, { method = 'GET', query, body, headers, timeoutMs } = {}) => {
  const url = buildUrl(endpoint, query);
  const { signal, cancel } = withTimeout(timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      signal,
      headers: { 'Content-Type': 'application/json', ...(headers || {}) },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    return await handleResponse(res);
  } finally {
    cancel();
  }
};

// ---- Specific API functions ----
// GET with query params
export const getBoxOfficeData = (limit = 10, weekendId) =>
    apiCall('getBoxOfficeData', { query: { limit, weekendId } });

export const getMovieStats = (type = 'summary') =>
    apiCall('getMovieStats', { query: { type } });

export const getDirectorStats = (type = 'top_grossing') =>
    apiCall('getDirectorStats', { query: { type } });

export const getWeekendInfo = (weekendId) =>
    apiCall('getWeekendInfo', { query: { weekendId } });

export const testDatabase = () =>
    apiCall('testDatabase');

export const getPrincipalStudios = (movieIds = []) =>
    apiCall('getPrincipalStudios', { method: 'POST', body: { movieIds } });

export const getMovieDetails = (movieId) =>
    apiCall('getMovieDetails', { query: { movieId } });

export const getPreviousWeekend = (currentWeekendId) =>
    apiCall('getPreviousWeekend', { query: { currentWeekendId } });

export const getWeekCounts = (weekendId) =>
    apiCall('getWeekCounts', { query: { weekendId } });

export const getWeekendBoxOffice = (weekendId) =>
    apiCall('getWeekendBoxOffice', { query: { weekendId } });

export const getYearSummary = (year, scope = 'all') =>
    apiCall('getYearSummary', { query: { year, scope } });

export const correctMovieID = (tempId, newId) =>
    apiCall('correctMovieID', {
      method: 'POST',
      body: { tempId: Number(tempId), newId: Number(newId) },
    });

export const getMovieShowings = (movieId, date, theatreId, timeRange, company, lat, lon, limit) =>
    apiCall('getMovieShowings', { query: { movieId, date, theatreId, timeRange, company, lat, lon, limit } });