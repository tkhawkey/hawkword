// Where the puzzle proxy lives.
// Locally, dev-server.ps1 serves the API on the same address as the app, so this stays ''.
// Once the Cloudflare Worker is deployed, paste its address here (no trailing slash),
// e.g. 'https://hawkword-proxy.yourname.workers.dev'.
export const WORKER_URL = 'https://hawkword-proxy.thomas-hawkey.workers.dev';

const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
export const API_BASE = local ? '' : WORKER_URL;
export const API_READY = local || !!WORKER_URL;

// Hawktionary: opened beside the puzzle. It routes on '#/module?key=value':
//   #/dictionary?q=word     #/solve?c=clue&p=pattern
export const HAWKTIONARY_URL = 'https://tkhawkey.github.io/hawktionary/';

export const SERIES = {
  cryptic: { name: 'Cryptic', days: 'Mon–Fri' },
  prize: { name: 'Prize', days: 'Saturday' },
  quick: { name: 'Quick', days: 'Mon–Sat' },
  quiptic: { name: 'Quiptic', days: 'Monday' },
  'quick-cryptic': { name: 'Quick cryptic', days: 'Saturday' },
  'sunday-quick': { name: 'Sunday quick', days: 'Sunday' },
  // Observer puzzles: they left the Guardian site when the Observer was sold in 2025,
  // so these are archive-only.
  everyman: { name: 'Everyman', days: 'Archive to Apr 2025', archived: true },
  speedy: { name: 'Speedy', days: 'Archive to Apr 2025', archived: true },
};
