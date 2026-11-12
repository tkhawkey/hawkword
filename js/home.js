// Home (today's puzzles) and series archive screens.

import * as api from './api.js';
import { SERIES } from './config.js';
import { load, progressKey } from './store.js';
import { h, formatDate, formatTime, sameDay } from './ui.js';

function progressBadge(series, id) {
  const p = load(progressKey(series, id));
  if (!p) return null;
  if (p.done) return h('span', { class: 'badge done' }, `Solved · ${formatTime(p.t || 0)}`);
  if (p.f) return h('span', { class: 'badge started' }, `${Math.round((100 * p.f) / (p.n || 1))}% filled`);
  return null;
}

function loading(main, text) {
  main.replaceChildren(h('div', { class: 'state' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', {}, text)));
}

export function errorState(main, err, retry) {
  if (err.code === 'auth') return keyPrompt(main, err, retry);
  main.replaceChildren(h('div', { class: 'state' },
    h('p', { class: 'state-title' }, 'Puzzles didn’t load'),
    h('p', {}, err.message || String(err)),
    retry ? h('button', { class: 'btn', type: 'button', onclick: retry }, 'Try again') : null));
}

function keyPrompt(main, err, retry) {
  const input = h('input', {
    id: 'keyInput', type: 'password', autocomplete: 'current-password', spellcheck: 'false',
    placeholder: 'Your Hawkword key', required: true,
  });
  const form = h('form', { class: 'key-form' },
    h('label', { for: 'keyInput' }, 'Key'),
    h('div', { class: 'key-row' }, input, h('button', { class: 'btn solve', type: 'submit' }, 'Unlock')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    api.setKey(input.value.trim());
    retry();
  });
  main.replaceChildren(h('div', { class: 'state' },
    h('p', { class: 'state-title' }, 'This Hawkword is private'),
    h('p', {}, err.message + ' You only need to do this once on each device.'),
    form));
  input.focus();
}

export async function renderHome(main, isCurrent) {
  loading(main, 'Fetching today’s puzzles…');
  let body;
  try {
    body = await api.today();
  } catch (e) {
    if (isCurrent()) errorState(main, e, () => renderHome(main, isCurrent));
    return;
  }
  if (!isCurrent()) return;

  const now = new Date();
  const order = Object.keys(SERIES);
  const items = body.items
    .filter((it) => SERIES[it.series] && !SERIES[it.series].archived)
    .sort((a, b) => (sameDay(b.date, now) - sameDay(a.date, now)) || (new Date(b.date) - new Date(a.date)) || (order.indexOf(a.series) - order.indexOf(b.series)));

  const todays = items.filter((it) => sameDay(it.date, now));
  const recent = items.filter((it) => !sameDay(it.date, now));

  const card = (it) => h('a', { class: 'card', href: `#/p/${it.series}/${it.id}` },
    h('span', { class: 'card-series' }, SERIES[it.series].name),
    h('span', { class: 'card-title' }, `No ${it.id.toLocaleString('en-GB')}`),
    h('span', { class: 'card-date' }, formatDate(it.date)),
    progressBadge(it.series, it.id));

  main.replaceChildren(h('section', { class: 'home' },
    h('header', { class: 'home-head' },
      h('p', { class: 'eyebrow' }, now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })),
      h('h1', {}, todays.length ? 'Today’s crosswords' : 'Latest crosswords'),
      body.stale ? h('p', { class: 'note' }, 'Offline: showing the last list that loaded.') : null),
    todays.length ? h('div', { class: 'cards' }, todays.map(card)) : null,
    recent.length ? h('h2', { class: 'section-title' }, todays.length ? 'Latest in other series' : 'Most recent') : null,
    recent.length ? h('div', { class: 'cards' }, recent.map(card)) : null,
    h('h2', { class: 'section-title' }, 'Archives'),
    h('div', { class: 'series-links' }, Object.entries(SERIES).map(([key, s]) =>
      h('a', { class: 'chip', href: `#/series/${key}` }, s.name, h('span', { class: 'chip-sub' }, s.days)))),
    h('p', { class: 'credit' }, 'Puzzles from ', h('a', { href: 'https://www.theguardian.com/crosswords', target: '_blank', rel: 'noopener' }, 'the Guardian'), '. For personal use.',
      api.getKey() ? h('button', { class: 'linkish', type: 'button', onclick: () => {
        if (confirm('Forget the key on this device? You’ll need to enter it again.')) { api.setKey(''); renderHome(main, isCurrent); }
      } }, 'Forget key on this device') : null)));
}

export async function renderSeries(main, series, isCurrent) {
  const s = SERIES[series];
  if (!s) { location.hash = '#/'; return; }
  loading(main, `Fetching ${s.name} puzzles…`);

  const list = h('div', { class: 'archive' });
  const more = h('button', { class: 'btn', type: 'button' }, 'Older puzzles');
  let page = 0;

  const row = (it) => h('a', { class: 'row', href: `#/p/${series}/${it.id}` },
    h('span', { class: 'row-title' }, `No ${it.id.toLocaleString('en-GB')}`),
    h('span', { class: 'row-date' }, formatDate(it.date)),
    progressBadge(series, it.id) || h('span'));

  async function next() {
    more.disabled = true;
    more.textContent = 'Loading…';
    try {
      const body = await api.list(series, page + 1);
      if (!isCurrent()) return;
      page++;
      list.append(...body.items.map(row));
      more.hidden = body.items.length === 0;
    } catch (e) {
      if (page === 0) { errorState(main, e, () => renderSeries(main, series, isCurrent)); return; }
    }
    more.disabled = false;
    more.textContent = 'Older puzzles';
  }

  const jump = h('form', { class: 'jump' },
    h('label', { for: 'jumpId' }, 'Go to number'),
    h('input', { id: 'jumpId', inputmode: 'numeric', pattern: '[0-9]*', placeholder: 'e.g. 29000' }),
    h('button', { class: 'btn', type: 'submit' }, 'Open'));
  jump.addEventListener('submit', (e) => {
    e.preventDefault();
    const n = jump.querySelector('input').value.replace(/\D/g, '');
    if (n) location.hash = `#/p/${series}/${n}`;
  });

  await next();
  if (!isCurrent() || page === 0) return;
  main.replaceChildren(h('section', { class: 'series' },
    h('a', { class: 'crumb', href: '#/' }, 'Today'),
    h('h1', {}, `${s.name} archive`),
    h('p', { class: 'meta' }, `Published ${s.days}`),
    jump, list, more));
  more.addEventListener('click', next);
}
