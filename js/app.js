// Router: #/  ·  #/series/<series>  ·  #/p/<series>/<id>

import * as api from './api.js';
import * as dict from './dictionary.js';
import { renderHome, renderSeries, errorState } from './home.js';
import { renderSolver } from './solver.js';
import { SERIES } from './config.js';
import { h } from './ui.js';

const main = document.getElementById('main');
let cleanup = null;
let routeId = 0;

async function route() {
  const id = ++routeId;
  const isCurrent = () => id === routeId;
  cleanup?.();
  cleanup = null;
  document.body.dataset.view = '';
  scrollTo(0, 0);

  const path = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);

  if (path[0] === 'series' && path[1]) {
    document.title = `${SERIES[path[1]]?.name || 'Series'} · Hawkword`;
    return renderSeries(main, path[1], isCurrent);
  }

  if (path[0] === 'p' && SERIES[path[1]] && /^\d+$/.test(path[2] || '')) {
    const [, series, num] = path;
    document.body.dataset.view = 'solve';
    main.replaceChildren(h('div', { class: 'state' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', {}, 'Opening puzzle…')));
    try {
      const data = await api.puzzle(series, num);
      if (!isCurrent()) return;
      document.title = `${data.name || 'Crossword'} · Hawkword`;
      cleanup = renderSolver(main, data, series, num);
    } catch (e) {
      if (isCurrent()) errorState(main, e, route);
    }
    return;
  }

  document.title = 'Hawkword';
  return renderHome(main, isCurrent);
}

dict.init();
addEventListener('hashchange', route);
addEventListener('pagehide', () => cleanup?.());
route();
