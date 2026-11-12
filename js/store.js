// Small localStorage wrapper. Storage can be unavailable (private windows, blocked
// site data), so every call is guarded and the app keeps working without it.

const PREFIX = 'hawkword:';

export function load(key, fallback = null) {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const progressKey = (series, id) => `progress:${series}:${id}`;
export const puzzleKey = (series, id) => `puzzle:${series}:${id}`;
