// The solving screen: grid, current clue bar, clue lists, check / reveal, timer, autosave.

import { buildPuzzle, parentOf, answerCells, answerPattern, clueFragment, lookupForm, htmlToText } from './puzzle.js';
import { load, save, progressKey } from './store.js';
import { SERIES } from './config.js';
import * as dict from './dictionary.js';
import { h, toast, formatDate, formatTime } from './ui.js';

export function renderSolver(main, data, series, id) {
  const pz = buildPuzzle(data);
  const N = pz.cols * pz.rows;
  const key = progressKey(series, id);
  const saved = load(key, {});
  const total = pz.cells.filter(Boolean).length;

  const letters = Array.from({ length: N }, (_, i) => {
    const ch = saved.l?.[i];
    return ch && ch !== '.' ? ch : '';
  });
  const revealed = new Set(saved.r || []);
  const wrong = new Set();
  let secs = saved.t || 0;
  let done = !!saved.done;
  let paused = false;
  let warnedFull = false;

  // cursor
  const first = pz.clueOrder[0];
  let cur = first.cells[0];
  let dir = first.direction;

  // ---------- DOM ----------
  const cellEls = new Array(N);
  const board = h('div', { class: 'board', role: 'grid', 'aria-label': 'Crossword grid', style: `--cols:${pz.cols};--rows:${pz.rows}` });
  for (let i = 0; i < N; i++) {
    const c = pz.cells[i];
    if (!c) { board.append(h('div', { class: 'block', 'aria-hidden': 'true' })); continue; }
    const el = h('div', { class: 'cell', 'data-i': i, role: 'gridcell' },
      c.number ? h('span', { class: 'num' }, String(c.number)) : null,
      h('span', { class: 'ch' }));
    cellEls[i] = el;
    board.append(el);
  }
  markSeparators();

  const kbd = h('input', {
    class: 'kbd', type: 'text', value: ' ', autocomplete: 'off', autocapitalize: 'characters',
    autocorrect: 'off', spellcheck: 'false', 'aria-label': 'Type answer letters', enterkeyhint: 'next',
  });

  const cbLabel = h('span', { class: 'cb-label' });
  const cbText = h('p', { class: 'cb-text', title: 'Tap a word to look it up. Select several words to look up a phrase.' });
  const cbSolve = h('button', { class: 'btn solve', type: 'button', title: 'Send this clue and your letters to Hawktionary’s Solve tab (S)' },
    h('span', {}, 'Solve'), arrowIcon());
  const clueBar = h('div', { class: 'cluebar' },
    h('button', { class: 'icon-btn cb-nav', type: 'button', 'aria-label': 'Previous clue', onclick: () => stepClue(-1) }, chevron('left')),
    h('div', { class: 'cb-main' }, cbLabel, cbText),
    cbSolve,
    h('button', { class: 'icon-btn cb-nav', type: 'button', 'aria-label': 'Next clue', onclick: () => stepClue(1) }, chevron('right')));

  const listEls = new Map();
  const clueList = (title, items) => h('section', { class: 'clue-col' },
    h('h2', {}, title),
    h('ol', {}, items.map((e) => {
      const li = h('li', { 'data-id': e.id },
        h('span', { class: 'cl-num' }, e.label),
        h('span', { class: 'cl-text' }, clueFragment(e.clueHtml, { words: false })));
      li.addEventListener('click', () => selectEntry(e.id));
      listEls.set(e.id, li);
      return li;
    })));
  const clues = h('div', { class: 'clues' }, clueList('Across', pz.across), clueList('Down', pz.down));

  const timerBtn = h('button', { class: 'btn ghost timer', type: 'button', title: 'Pause timer' });
  const menu = (label, items) => {
    const d = h('details', { class: 'menu' },
      h('summary', { class: 'btn ghost' }, label),
      h('div', { class: 'menu-list' }, items.map(([text, fn]) => h('button', { type: 'button', onclick: () => { d.open = false; fn(); focusGrid(); } }, text))));
    return d;
  };
  const tools = h('div', { class: 'tools' },
    timerBtn,
    pz.hasSolution ? menu('Check', [['Letter', () => check([cur])], ['Word', () => check(wordCells())], ['Grid', () => check(allCells())]]) : null,
    pz.hasSolution ? menu('Reveal', [['Letter', () => reveal([cur])], ['Word', () => reveal(wordCells())], ['Grid', () => confirm('Reveal the whole grid?') && reveal(allCells())]]) : null,
    menu('Clear', [['Word', () => clear(wordCells())], ['Wrong letters', () => clearWrong()], ['Grid', () => confirm('Clear every letter?') && clear(allCells())]]));

  const seriesName = SERIES[series]?.name || series;
  const banner = h('div', { class: 'banner', hidden: true });
  const head = h('div', { class: 'puz-head' },
    h('div', { class: 'puz-title' },
      h('a', { class: 'crumb', href: `#/series/${series}` }, `${seriesName} archive`),
      h('h1', {}, pz.name || `${seriesName} No ${id}`),
      h('p', { class: 'meta' }, [pz.setter, pz.date && formatDate(pz.date)].filter(Boolean).join(' · '))),
    tools);

  const notes = [];
  if (!pz.hasSolution) {
    notes.push(h('p', { class: 'note' }, `Prize puzzle: check and reveal arrive with the solution${pz.solutionDate ? ` on ${formatDate(pz.solutionDate)}` : ''}.`));
  }
  if (pz.instructions) notes.push(h('p', { class: 'note' }, htmlToText(pz.instructions)));

  const root = h('section', { class: 'solver' },
    head, banner, ...notes,
    h('div', { class: 'puz-body' },
      h('div', { class: 'board-col' }, clueBar, h('div', { class: 'board-wrap' }, board, kbd)),
      clues));
  main.replaceChildren(root);

  // ---------- helpers ----------
  const entryAt = (i, d) => pz.cells[i]?.[d] || null;
  const currentEntry = () => entryAt(cur, dir) || entryAt(cur, dir === 'across' ? 'down' : 'across');
  const wordCells = () => answerCells(pz, currentEntry());
  const allCells = () => pz.cells.filter(Boolean).map((c) => c.i);

  function markSeparators() {
    for (const e of pz.entries.values()) {
      const side = e.direction === 'across' ? 'r' : 'b';
      for (const at of e.commas) if (e.cells[at - 1] != null) cellEls[e.cells[at - 1]]?.classList.add(`sep-${side}`);
      for (const at of e.hyphens) if (e.cells[at - 1] != null) cellEls[e.cells[at - 1]]?.classList.add(`hyp-${side}`);
    }
  }

  function focusGrid() {
    if (!kbd.matches(':focus')) kbd.focus({ preventScroll: true });
  }

  // ---------- rendering ----------
  let lastParent = null;
  function paint() {
    const id = currentEntry();
    const word = new Set(answerCells(pz, id));
    for (let i = 0; i < N; i++) {
      const el = cellEls[i];
      if (!el) continue;
      el.lastChild.textContent = letters[i];
      el.classList.toggle('active', i === cur);
      el.classList.toggle('inword', word.has(i));
      el.classList.toggle('wrong', wrong.has(i));
      el.classList.toggle('revealed', revealed.has(i));
    }
    // position the hidden input over the active cell so the phone keyboard doesn't jump the page
    const a = cellEls[cur];
    kbd.style.left = `${a.offsetLeft}px`;
    kbd.style.top = `${a.offsetTop}px`;
    kbd.style.width = `${a.offsetWidth}px`;
    kbd.style.height = `${a.offsetHeight}px`;

    const parent = parentOf(pz, id);
    if (parent !== lastParent) {
      lastParent = parent;
      cbLabel.textContent = `${parent.label} ${parent.direction}`;
      cbText.replaceChildren(clueFragment(parent.clueHtml));
      for (const li of listEls.values()) li.classList.remove('current');
      for (const gid of parent.group) listEls.get(gid)?.classList.add('current');
      const li = listEls.get(parent.id);
      if (li && matchMedia('(min-width: 900px)').matches) li.scrollIntoView({ block: 'nearest' });
    }
    for (const e of pz.clueOrder) {
      const filled = answerCells(pz, e.id).every((i) => letters[i]);
      for (const gid of e.group) listEls.get(gid)?.classList.toggle('filled', filled);
    }
    timerBtn.textContent = done ? `✓ ${formatTime(secs)}` : paused ? `Paused ${formatTime(secs)}` : formatTime(secs);
    banner.hidden = !done;
    if (done) {
      banner.textContent = `Solved in ${formatTime(secs)}${revealed.size ? ` · ${revealed.size} letter${revealed.size === 1 ? '' : 's'} revealed` : ''}`;
    }
  }

  // ---------- persistence ----------
  let saveTimer = 0;
  function persist(now = false) {
    clearTimeout(saveTimer);
    const write = () => save(key, {
      l: letters.map((c) => c || '.').join(''),
      r: [...revealed],
      t: secs,
      done,
      f: letters.filter(Boolean).length,
      n: total,
      at: Date.now(),
    });
    if (now) write(); else saveTimer = setTimeout(write, 400);
  }

  function afterChange() {
    const full = allCells().every((i) => letters[i]);
    if (full && pz.hasSolution && !done) {
      if (allCells().every((i) => letters[i] === pz.cells[i].solution)) {
        done = true;
        toast(revealed.size ? 'Grid complete.' : 'Solved! Well done.');
      } else if (!warnedFull) {
        warnedFull = true;
        toast('Grid full, but something isn’t right yet.');
      }
    } else if (!full) {
      warnedFull = false;
    }
    persist();
    paint();
  }

  // ---------- selection & typing ----------
  function select(i, d) {
    cur = i;
    if (d && entryAt(i, d)) dir = d;
    else if (!entryAt(i, dir)) dir = dir === 'across' ? 'down' : 'across';
    paint();
  }

  function selectEntry(id) {
    const cells = answerCells(pz, id);
    const target = cells.find((i) => !letters[i]) ?? cells[0];
    cur = target;
    dir = directionAt(id, target);
    paint();
    focusGrid();
  }

  // direction of the grid entry (within a linked answer) that holds cell i
  function directionAt(id, i) {
    for (const gid of parentOf(pz, id).group) {
      const e = pz.entries.get(gid);
      if (e?.cells.includes(i)) return e.direction;
    }
    return dir;
  }

  function stepWithinWord(delta) {
    const id = currentEntry();
    const cells = answerCells(pz, id);
    const k = cells.indexOf(cur);
    const next = cells[k + delta];
    if (next == null) return false;
    cur = next;
    dir = directionAt(id, next);
    return true;
  }

  function stepClue(delta) {
    const order = pz.clueOrder;
    const k = order.indexOf(parentOf(pz, currentEntry()));
    const next = order[(k + delta + order.length) % order.length];
    selectEntry(next.id);
  }

  function type(ch) {
    if (done) return;
    letters[cur] = ch;
    wrong.delete(cur);
    revealed.delete(cur);
    stepWithinWord(1);
    afterChange();
  }

  function backspace() {
    if (done) return;
    if (letters[cur]) {
      letters[cur] = '';
    } else if (stepWithinWord(-1)) {
      letters[cur] = '';
    }
    wrong.delete(cur);
    afterChange();
  }

  function move(dx, dy) {
    const want = dx ? 'across' : 'down';
    if (dir !== want && entryAt(cur, want)) { dir = want; paint(); return; }
    let x = pz.cells[cur].x;
    let y = pz.cells[cur].y;
    for (;;) {
      x += dx; y += dy;
      if (x < 0 || y < 0 || x >= pz.cols || y >= pz.rows) return;
      const i = y * pz.cols + x;
      if (pz.cells[i]) { select(i, want); return; }
    }
  }

  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t !== kbd && t.closest?.('input, textarea, select, [contenteditable]')) return;
    if (t !== kbd && t.closest?.('a, button, summary')) {
      if (e.key === 'Enter' || e.key === ' ') return; // let buttons work
    }
    const k = e.key;
    if (/^[a-z]$/i.test(k)) { type(k.toUpperCase()); }
    else if (k === 'Backspace') { backspace(); }
    else if (k === 'Delete') { if (!done) { letters[cur] = ''; wrong.delete(cur); afterChange(); } }
    else if (k === 'ArrowLeft') move(-1, 0);
    else if (k === 'ArrowRight') move(1, 0);
    else if (k === 'ArrowUp') move(0, -1);
    else if (k === 'ArrowDown') move(0, 1);
    else if (k === 'Tab') stepClue(e.shiftKey ? -1 : 1);
    else if (k === 'Enter' || k === ' ') { const o = dir === 'across' ? 'down' : 'across'; if (entryAt(cur, o)) { dir = o; paint(); } }
    else if (k === '?' ) { sendToSolve(); }
    else return;
    e.preventDefault();
  }

  // Phone keyboards often send keydown "Unidentified"; read what landed in the input instead.
  kbd.addEventListener('input', (e) => {
    if (e.inputType?.startsWith('delete')) backspace();
    else {
      // can be several letters at once (autocomplete, paste, swipe typing)
      for (const ch of kbd.value.toUpperCase().replace(/[^A-Z]/g, '')) type(ch);
    }
    kbd.value = ' ';
  });

  board.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.cell');
    if (!el) return;
    e.preventDefault();
    const i = Number(el.dataset.i);
    if (i === cur) {
      const o = dir === 'across' ? 'down' : 'across';
      if (entryAt(i, o)) dir = o;
      paint();
    } else {
      select(i);
    }
    focusGrid();
  });

  // ---------- clue words → Hawktionary ----------
  function selectedPhrase() {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !cbText.contains(sel.anchorNode)) return '';
    return sel.toString().replace(/\s*\([\d\s,.'’-]+\)\s*$/, '').replace(/[^\p{L}\p{M}'’\- ]+/gu, ' ').replace(/\s+/g, ' ').trim();
  }

  cbText.addEventListener('pointerup', (e) => {
    setTimeout(() => {
      const phrase = selectedPhrase();
      if (phrase && /\s/.test(phrase)) { dict.lookup(phrase.toLowerCase()); return; }
      const w = e.target.closest('.w');
      if (w) {
        for (const el of cbText.querySelectorAll('.w.picked')) el.classList.remove('picked');
        w.classList.add('picked');
        dict.lookup(lookupForm(w.textContent));
      }
    }, 0);
  });

  function sendToSolve() {
    const id = currentEntry();
    const parent = parentOf(pz, id);
    dict.solve(parent.clueText, answerPattern(pz, id, letters));
  }
  cbSolve.addEventListener('click', sendToSolve);

  // ---------- check / reveal / clear ----------
  function check(cells) {
    let bad = 0;
    for (const i of cells) {
      if (letters[i] && letters[i] !== pz.cells[i].solution) { wrong.add(i); bad++; }
    }
    toast(bad ? `${bad} letter${bad === 1 ? '' : 's'} wrong` : 'No mistakes so far');
    paint();
  }

  function reveal(cells) {
    for (const i of cells) {
      if (letters[i] !== pz.cells[i].solution) {
        letters[i] = pz.cells[i].solution;
        revealed.add(i);
      }
      wrong.delete(i);
    }
    afterChange();
  }

  function clear(cells) {
    for (const i of cells) { letters[i] = ''; wrong.delete(i); revealed.delete(i); }
    if (done) done = false;
    afterChange();
  }

  function clearWrong() {
    if (!pz.hasSolution) return;
    clear(allCells().filter((i) => letters[i] && letters[i] !== pz.cells[i].solution));
  }

  // ---------- timer ----------
  timerBtn.addEventListener('click', () => { if (!done) { paused = !paused; timerBtn.title = paused ? 'Resume timer' : 'Pause timer'; paint(); } });
  const tick = setInterval(() => {
    if (done || paused || document.visibilityState !== 'visible') return;
    secs++;
    timerBtn.textContent = formatTime(secs);
    if (secs % 15 === 0) persist();
  }, 1000);

  const onHide = () => { if (document.visibilityState === 'hidden') persist(true); };
  const onResize = () => paint();
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onHide);
  addEventListener('resize', onResize);

  paint();
  if (matchMedia('(pointer: fine)').matches) focusGrid();

  return () => {
    persist(true);
    clearInterval(tick);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onHide);
    removeEventListener('resize', onResize);
  };
}

function chevron(side) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = side === 'left'
    ? '<path d="M12.5 4.5L7 10l5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
    : '<path d="M7.5 4.5L13 10l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
  return svg;
}

function arrowIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<path d="M4 10h11M11 5.5L15.5 10 11 14.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
  return svg;
}
