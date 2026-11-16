// Hawktionary beside the puzzle, in an iframe.
//
// Hawktionary routes on its URL hash ('#/module?key=value') and listens for
// hashchange, so changing only the iframe's hash switches word or tab without
// reloading it (its offline dictionary stays loaded).

import { HAWKTIONARY_URL } from './config.js';
import { load, save } from './store.js';

const $ = (id) => document.getElementById(id);
const layout = $('layout');
const panel = $('dict');
const frame = $('dictFrame');
const toggle = $('dictToggle');
const pop = $('dictPop');

let open = false;
let loadedHash = null;

export function hashFor(module, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  return `#/${module}${qs ? '?' + qs : ''}`;
}

function navigate(hash) {
  const url = HAWKTIONARY_URL + hash;
  pop.href = url;
  if (loadedHash === null) {
    frame.src = url;
  } else {
    // same document, new fragment: Hawktionary re-routes without a reload
    frame.contentWindow?.location.replace(url);
  }
  loadedHash = hash;
}

export function setOpen(value, { remember = true } = {}) {
  open = value;
  panel.hidden = !open;
  layout.classList.toggle('with-dict', open);
  toggle.setAttribute('aria-pressed', String(open));
  if (open && loadedHash === null) navigate(load('dictHash', '#/'));
  if (remember) save('dictOpen', open);
}

export const isOpen = () => open;

/** Look a word or phrase up in the Dictionary tab. */
export function lookup(word) {
  navigate(hashFor('dictionary', { q: word }));
  save('dictHash', hashFor('dictionary', { q: word }));
  if (!open) setOpen(true);
}

/** Send a clue (and the grid pattern so far, and any anagram letters) to the Solve tab. */
export function solve(clue, pattern, anagram = '') {
  const hash = hashFor('solve', { c: clue, p: pattern, a: anagram });
  navigate(hash);
  if (!open) setOpen(true);
}

export function init() {
  pop.href = HAWKTIONARY_URL;
  toggle.addEventListener('click', () => setOpen(!open));
  $('dictClose').addEventListener('click', () => setOpen(false));
  // Desktop: reopen if it was open last time. On phones it starts closed.
  if (load('dictOpen', false) && matchMedia('(min-width: 900px)').matches) setOpen(true, { remember: false });
}
