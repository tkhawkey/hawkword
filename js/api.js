import { API_BASE, API_READY } from './config.js';
import { load, save, puzzleKey } from './store.js';

export class ApiError extends Error {
  constructor(msg, code = '') { super(msg); this.code = code; }
}

// The proxy is private: it only answers requests carrying this device's saved key.
export const getKey = () => load('key', '');
export const setKey = (k) => save('key', k);

async function getJSON(path) {
  if (!API_READY) throw new ApiError('The puzzle proxy is not set up yet — see README.md.');
  const key = getKey();
  let res;
  try {
    res = await fetch(API_BASE + path, key ? { headers: { 'X-Hawkword-Key': key } } : {});
  } catch {
    throw new ApiError('Could not reach the puzzle proxy. Check your connection.');
  }
  if (res.status === 401) throw new ApiError(key ? 'That key wasn’t accepted.' : 'Enter your key to load puzzles.', 'auth');
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error === 'puzzle not found' ? 'That puzzle does not exist.' : `Couldn’t load puzzles (${body.error || res.status}).`);
  return body;
}

/** Latest puzzle in every series. Falls back to the last good copy when offline. */
export async function today() {
  try {
    const body = await getJSON('/api/guardian/today');
    save('today', body);
    return { ...body, stale: false };
  } catch (e) {
    if (e.code === 'auth') throw e;
    const cached = load('today');
    if (cached) return { ...cached, stale: true };
    throw e;
  }
}

export async function list(series, page = 1) {
  const key = `list:${series}:${page}`;
  try {
    const body = await getJSON(`/api/guardian/list?series=${encodeURIComponent(series)}&page=${page}`);
    save(key, body);
    return body;
  } catch (e) {
    if (e.code === 'auth') throw e;
    const cached = load(key);
    if (cached) return { ...cached, stale: true };
    throw e;
  }
}

/** A puzzle's data. Cached on the device so a started puzzle opens offline. */
export async function puzzle(series, id) {
  const key = puzzleKey(series, id);
  const cached = load(key);
  // A finished puzzle with its solution never changes; anything else is refreshed
  // (prize solutions are published a week or so later).
  if (cached && cached.solutionAvailable !== false) return cached;
  try {
    const body = await getJSON(`/api/guardian/puzzle?series=${encodeURIComponent(series)}&id=${encodeURIComponent(id)}`);
    const data = body.data || body;
    data.series = series;
    save(key, data);
    return data;
  } catch (e) {
    if (e.code === 'auth') throw e;
    if (cached) return cached;
    throw e;
  }
}
