/**
 * Hawkword puzzle proxy — a Cloudflare Worker.
 *
 * Browsers can't read theguardian.com directly (no CORS headers), so this
 * small worker fetches the public crossword pages, pulls out the puzzle
 * data the page already embeds, and returns it as JSON. Nothing is stored.
 *
 *   GET /api/guardian/today                      latest puzzle in every series
 *   GET /api/guardian/list?series=cryptic&page=1 recent puzzles in one series
 *   GET /api/guardian/puzzle?series=cryptic&id=30162
 *
 * The dev server (dev-server.ps1) implements the same three endpoints so the
 * app behaves identically locally.
 */

const SERIES = ['cryptic', 'quick', 'quiptic', 'speedy', 'prize', 'everyman', 'quick-cryptic', 'sunday-quick'];
const GU = 'https://www.theguardian.com';

// Only these sites may call the worker. Add your own domain if you host elsewhere.
const ALLOWED_ORIGINS = [/^https:\/\/tkhawkey\.github\.io$/, /^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.some((re) => re.test(origin)) ? origin : 'https://tkhawkey.github.io',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'X-Hawkword-Key',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    // Private: every request must carry the secret key (set with `wrangler secret put ACCESS_KEY`).
    if (!env.ACCESS_KEY || !(await sameSecret(request.headers.get('X-Hawkword-Key') || '', env.ACCESS_KEY))) {
      return new Response(JSON.stringify({ error: 'key required' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: 'GET' });
    const hit = await cache.match(cacheKey);
    if (hit) return withHeaders(hit, cors);

    let body, maxAge;
    try {
      if (url.pathname === '/api/guardian/today') {
        const lists = await Promise.all(SERIES.map((s) => listSeries(s, 1).catch(() => [])));
        body = { items: lists.map((l) => l[0]).filter(Boolean) };
        maxAge = 600;
      } else if (url.pathname === '/api/guardian/list') {
        const series = checkSeries(url.searchParams.get('series'));
        const page = Math.max(1, Math.min(200, parseInt(url.searchParams.get('page') || '1', 10) || 1));
        body = { series, page, items: await listSeries(series, page) };
        maxAge = 600;
      } else if (url.pathname === '/api/guardian/puzzle') {
        const series = checkSeries(url.searchParams.get('series'));
        const id = url.searchParams.get('id');
        if (!/^\d{1,6}$/.test(id || '')) throw new HttpError(400, 'bad id');
        body = await puzzle(series, id);
        // prize solutions appear later, so don't hold those for long
        maxAge = body.solutionAvailable === false ? 900 : 86400;
      } else {
        throw new HttpError(404, 'not found');
      }
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 502;
      return new Response(JSON.stringify({ error: String(e.message || e) }), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const res = new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${maxAge}` },
    });
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return withHeaders(res, cors);
  },
};

class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

// Compare hashes so the check takes the same time whatever was sent.
async function sameSecret(given, expected) {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([given, expected].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  return crypto.subtle.timingSafeEqual(a, b);
}

function checkSeries(s) {
  if (!SERIES.includes(s)) throw new HttpError(400, 'unknown series');
  return s;
}

function withHeaders(res, extra) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(extra)) r.headers.set(k, v);
  return r;
}

async function get(path) {
  const r = await fetch(GU + path, { headers: { 'User-Agent': 'Mozilla/5.0 (personal crossword reader)' }, cf: { cacheTtl: 300 } });
  if (r.status === 404) throw new HttpError(404, 'puzzle not found');
  if (!r.ok) throw new Error(`guardian returned ${r.status}`);
  return r.text();
}

/** Puzzle cards from a series page: [{series, id, title, date}] newest first. */
async function listSeries(series, page) {
  const html = await get(`/crosswords/series/${series}${page > 1 ? `?page=${page}` : ''}`);
  const re = new RegExp(`href="/crosswords/${series}/(\\d+)"[^>]*?aria-label="([^"]*)"[\\s\\S]{0,1500}?dateTime="([^"]+)"`, 'g');
  const seen = new Set();
  const items = [];
  for (const m of html.matchAll(re)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    items.push({ series, id: Number(m[1]), title: decode(m[2]), date: m[3] });
  }
  return items.sort((a, b) => b.id - a.id);
}

/** The puzzle object the Guardian page embeds for its own crossword player. */
async function puzzle(series, id) {
  const html = await get(`/crosswords/${series}/${id}`);
  const m = html.match(/name="CrosswordComponent"[^>]*?props="([^"]*)"/);
  if (!m) throw new Error('no crossword data on page');
  const props = JSON.parse(decode(m[1]));
  const data = props.data || props;
  data.series = series;
  return data;
}

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|quot|amp|lt|gt|apos|nbsp);/gi, (_, e) => {
    const k = e.toLowerCase();
    if (k[0] === '#') return String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
    return { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ' }[k];
  });
}
