// Anagram helper: a modal for the current clue.
//
//  - The answer pattern shows letters already in the grid.
//  - Type the letters you think are being anagrammed: they sit in a circle and
//    fill the empty squares of the pattern (in grey).
//  - Shuffle jumbles them. Letters already in the grid, or typed in the answer,
//    are used up from the circle.
//  - Type the answer to see it in the pattern, then put it in the grid.

import { h } from './ui.js';
import { clueFragment } from './puzzle.js';

let uid = 0;

export function openAnagram({ label, clueHtml, slots, breaks, pencilMode, onPlace, onSolve, onClose }) {
  const n = slots.length;
  const breakAt = new Map(breaks.map((b) => [b.at, b.kind]));
  let items = [];        // fodder letters in circle order: {id, ch}
  let answer = '';

  // ---------- DOM ----------
  const ring = h('div', { class: 'ag-ring', 'aria-hidden': 'true' });
  const ringCount = h('div', { class: 'ag-count' });
  ring.append(ringCount);

  const boxes = [];
  const pattern = h('div', { class: 'ag-pattern', 'aria-label': 'Answer pattern' });
  slots.forEach((_, k) => {
    if (breakAt.get(k) === ' ') pattern.append(h('span', { class: 'ag-gap' }));
    if (breakAt.get(k) === '-') pattern.append(h('span', { class: 'ag-hyphen' }, '-'));
    const b = h('span', { class: 'ag-box' });
    boxes.push(b);
    pattern.append(b);
  });

  const fodderIn = h('input', {
    id: 'agFodder', class: 'ag-input', type: 'text', autocomplete: 'off', autocapitalize: 'characters',
    autocorrect: 'off', spellcheck: 'false', placeholder: 'Letters to rearrange',
  });
  const answerIn = h('input', {
    id: 'agAnswer', class: 'ag-input', type: 'text', autocomplete: 'off', autocapitalize: 'characters',
    autocorrect: 'off', spellcheck: 'false', placeholder: patternHint(),
  });
  const status = h('p', { class: 'ag-status', 'aria-live': 'polite' });

  const shuffleBtn = h('button', { class: 'btn', type: 'button' }, 'Shuffle');
  const pencilChk = h('input', { type: 'checkbox', id: 'agPencil' });
  pencilChk.checked = !!pencilMode;
  const placeBtn = h('button', { class: 'btn solve', type: 'submit', disabled: true }, 'Put in grid');
  const solveBtn = h('button', { class: 'btn ghost', type: 'button', title: 'Open Hawktionary’s Solve tab with these letters' }, 'Find in Hawktionary');

  const form = h('form', { class: 'ag-form', method: 'dialog' },
    h('div', { class: 'ag-field' },
      h('label', { for: 'agFodder' }, 'Anagram letters'),
      h('div', { class: 'ag-row' }, fodderIn, shuffleBtn)),
    h('div', { class: 'ag-field' },
      h('label', { for: 'agAnswer' }, 'Answer'),
      h('div', { class: 'ag-row' }, answerIn, placeBtn)),
    h('div', { class: 'ag-foot' },
      h('label', { class: 'ag-check', for: 'agPencil' }, pencilChk, 'In pencil'),
      solveBtn));

  const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close' });
  closeBtn.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

  const dlg = h('dialog', { class: 'anagram', 'aria-labelledby': 'agTitle' },
    h('div', { class: 'ag-head' },
      h('div', {},
        h('p', { class: 'ag-label', id: 'agTitle' }, `Anagram · ${label}`),
        h('p', { class: 'ag-clue' }, clueFragment(clueHtml, { words: false }))),
      closeBtn),
    ring, pattern, status, form);
  document.body.append(dlg);

  // ---------- behaviour ----------
  const lettersOf = (s) => s.toUpperCase().replace(/[^A-Z]/g, '');

  function patternHint() {
    let s = '';
    slots.forEach((ch, k) => { s += (breakAt.get(k) || '') + (ch || '?'); });
    return s;
  }

  function setFodder(str) {
    const want = lettersOf(str);
    // keep existing ids where letters still match, so the circle animates sensibly
    const pool = [...items];
    items = [...want].map((ch) => {
      const k = pool.findIndex((it) => it.ch === ch);
      return k >= 0 ? pool.splice(k, 1)[0] : { id: ++uid, ch };
    });
    render();
  }

  function shuffle() {
    if (items.length < 2) return;
    const before = items.map((it) => it.id).join();
    for (let tries = 0; tries < 5; tries++) {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
      if (items.map((it) => it.id).join() !== before) break;
    }
    render();
  }

  function render() {
    const typed = lettersOf(answer).slice(0, n);
    // what each square shows before the leftover fodder fills the gaps
    const shown = slots.map((ch, k) => typed[k] || ch || '');

    // use up circle letters that are already showing in the pattern
    const used = new Set();
    for (const ch of shown) {
      if (!ch) continue;
      const it = items.find((x) => x.ch === ch && !used.has(x.id));
      if (it) used.add(it.id);
    }
    const leftover = items.filter((it) => !used.has(it.id));

    let li = 0;
    boxes.forEach((b, k) => {
      let ch = shown[k];
      let kind = typed[k] ? 'typed' : slots[k] ? 'fixed' : '';
      if (typed[k] && slots[k] && typed[k] !== slots[k]) kind = 'clash';
      if (!ch && li < leftover.length) { ch = leftover[li++].ch; kind = 'ghost'; }
      b.textContent = ch;
      b.className = `ag-box${kind ? ' ' + kind : ''}`;
    });

    // circle
    const live = new Set(items.map((it) => it.id));
    for (const el of [...ring.querySelectorAll('.ag-tile')]) if (!live.has(Number(el.dataset.id))) el.remove();
    const count = items.length;
    const radius = count <= 1 ? 0 : Math.min(38, 22 + count * 1.2); // % of ring
    items.forEach((it, k) => {
      let el = ring.querySelector(`.ag-tile[data-id="${it.id}"]`);
      if (!el) { el = h('span', { class: 'ag-tile', 'data-id': it.id }, it.ch); ring.append(el); }
      const angle = (k / Math.max(count, 1)) * 2 * Math.PI - Math.PI / 2;
      el.style.left = `${50 + radius * Math.cos(angle)}%`;
      el.style.top = `${50 + radius * Math.sin(angle)}%`;
      el.classList.toggle('used', used.has(it.id));
    });

    const empties = slots.filter((ch, k) => !ch && !typed[k]).length;
    ringCount.textContent = count ? String(leftover.length) : '';
    ringCount.title = 'Letters not yet placed';
    if (!count) status.textContent = `${slots.filter((c) => !c).length} empty square${slots.filter((c) => !c).length === 1 ? '' : 's'}. Type the letters you think are being rearranged.`;
    else if (leftover.length > empties) status.textContent = `${leftover.length - empties} letter${leftover.length - empties === 1 ? '' : 's'} too many for the empty squares.`;
    else if (leftover.length < empties) status.textContent = `${empties - leftover.length} letter${empties - leftover.length === 1 ? '' : 's'} short of filling the empty squares.`;
    else status.textContent = 'The letters fit the empty squares exactly.';
    if (boxes.some((b) => b.classList.contains('clash'))) status.textContent += ' Red squares disagree with the grid.';

    placeBtn.disabled = !typed.length;
    solveBtn.disabled = !count;
    shuffleBtn.disabled = count < 2;
  }

  fodderIn.addEventListener('input', () => setFodder(fodderIn.value));
  answerIn.addEventListener('input', () => {
    const clean = lettersOf(answerIn.value).slice(0, n);
    answer = clean;
    if (answerIn.value !== clean) answerIn.value = clean;
    render();
  });
  fodderIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); answerIn.focus(); } });
  shuffleBtn.addEventListener('click', shuffle);
  ring.addEventListener('click', shuffle);
  solveBtn.addEventListener('click', () => { onSolve?.(lettersOf(fodderIn.value)); close(); });
  closeBtn.addEventListener('click', () => close());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const typed = lettersOf(answer);
    if (!typed) return;
    onPlace?.([...typed], pencilChk.checked);
    close(true);
  });
  // click on the backdrop closes
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  dlg.addEventListener('close', () => { dlg.remove(); onClose?.(); });

  function close() { if (dlg.open) dlg.close(); }

  render();
  dlg.showModal();
  fodderIn.focus();
}
