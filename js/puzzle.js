// Puzzle model: turns the Guardian's crossword JSON into cells and entries.
//
// Guardian entry: { id:'4-across', number, humanNumber, clue(html), direction, length,
//   group:['4-across', '19-down'], position:{x,y}, separatorLocations:{',':[4], '-':[2]}, solution }
// A "group" is a clue whose answer runs across several grid entries; the first id
// holds the real clue and the others say "See 4".

export function buildPuzzle(data) {
  const cols = data.dimensions.cols;
  const rows = data.dimensions.rows;
  const cells = new Array(cols * rows).fill(null);
  const entries = new Map();

  for (const raw of data.entries) {
    const dx = raw.direction === 'across' ? 1 : 0;
    const dy = raw.direction === 'down' ? 1 : 0;
    const idx = [];
    for (let k = 0; k < raw.length; k++) {
      const x = raw.position.x + dx * k;
      const y = raw.position.y + dy * k;
      const i = y * cols + x;
      idx.push(i);
      const cell = (cells[i] ||= { i, x, y, number: null, solution: '', across: null, down: null });
      cell[raw.direction] = raw.id;
      if (k === 0) cell.number = raw.number;
      const ch = raw.solution?.[k];
      if (ch) cell.solution = ch.toUpperCase();
    }
    const seps = raw.separatorLocations || {};
    entries.set(raw.id, {
      id: raw.id,
      number: raw.number,
      label: raw.humanNumber || String(raw.number),
      direction: raw.direction,
      clueHtml: raw.clue,
      clueText: htmlToText(raw.clue),
      group: raw.group?.length ? raw.group : [raw.id],
      cells: idx,
      commas: seps[','] || [],
      hyphens: seps['-'] || [],
    });
  }

  const order = (dir) => [...entries.values()].filter((e) => e.direction === dir).sort((a, b) => a.number - b.number);
  const across = order('across');
  const down = order('down');

  return {
    id: data.id,
    series: data.series,
    number: data.number,
    name: data.name,
    setter: data.creator?.name || '',
    date: data.date ? new Date(data.date) : null,
    hasSolution: data.solutionAvailable !== false && data.entries.every((e) => e.solution),
    solutionDate: data.dateSolutionAvailable ? new Date(data.dateSolutionAvailable) : null,
    instructions: data.instructions || '',
    cols, rows, cells, entries, across, down,
    clueOrder: [...across, ...down].filter((e) => e.group[0] === e.id),
  };
}

/** The entry that holds the clue text for a (possibly linked) entry. */
export const parentOf = (pz, id) => pz.entries.get(pz.entries.get(id).group[0]);

/** Every cell of a clue's answer, in reading order across linked entries. */
export function answerCells(pz, id) {
  return parentOf(pz, id).group.flatMap((gid) => pz.entries.get(gid)?.cells || []);
}

/** Word breaks for a whole answer: enumeration from the clue, else the grid separators. */
export function answerBreaks(pz, id) {
  const parent = parentOf(pz, id);
  const total = answerCells(pz, id).length;
  const enumMatch = parent.clueText.match(/\(([\d\s,.'’-]+)\)\s*$/);
  if (enumMatch) {
    const breaks = [];
    let at = 0;
    for (const tok of enumMatch[1].match(/\d+|[,\-.'’]/g) || []) {
      if (/\d/.test(tok)) at += Number(tok);
      else if (at > 0 && at < total) breaks.push({ at, kind: tok === '-' ? '-' : ' ' });
    }
    if (at === total) return breaks;
  }
  const breaks = [];
  let offset = 0;
  for (const gid of parent.group) {
    const e = pz.entries.get(gid);
    if (!e) continue;
    for (const c of e.commas) breaks.push({ at: offset + c, kind: ' ' });
    for (const h of e.hyphens) breaks.push({ at: offset + h, kind: '-' });
    offset += e.cells.length;
  }
  return breaks.sort((a, b) => a.at - b.at);
}

/** Pattern for Hawktionary's Solve tab: known letters, ? for gaps, space / - for breaks. */
export function answerPattern(pz, id, letters) {
  const cells = answerCells(pz, id);
  const breaks = answerBreaks(pz, id);
  let out = '';
  cells.forEach((ci, k) => {
    const b = breaks.find((br) => br.at === k);
    if (b) out += b.kind;
    out += letters[ci] ? letters[ci].toLowerCase() : '?';
  });
  return out;
}

/** Clue text without HTML tags or the trailing enumeration. */
export const clueWithoutEnum = (text) => text.replace(/\s*\([\d\s,.'’-]+\)\s*$/, '');

export function htmlToText(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

/**
 * Safe clue markup: keeps italics/bold, drops everything else, and wraps each word
 * in a <span class="w"> so it can be tapped to look up.
 */
export function clueFragment(html, { words = true } = {}) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  const frag = document.createDocumentFragment();
  const walk = (node, parent) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        appendWords(child.textContent, parent, words);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();
        if (['i', 'em', 'b', 'strong', 'sub', 'sup'].includes(tag)) {
          const el = document.createElement(tag);
          parent.appendChild(el);
          walk(child, el);
        } else {
          walk(child, parent);
        }
      }
    }
  };
  walk(doc.body, frag);
  return frag;
}

const WORD = /[\p{L}][\p{L}\p{M}'’\-]*/gu;
const ENUM = /\(([\d\s,.'’-]+)\)\s*$/;

function appendWords(text, parent, words) {
  if (!words) { parent.appendChild(document.createTextNode(text)); return; }
  // keep the enumeration "(5,3)" as plain, slightly muted text
  const em = text.match(ENUM);
  const body = em ? text.slice(0, em.index) : text;
  let last = 0;
  for (const m of body.matchAll(WORD)) {
    if (m.index > last) parent.appendChild(document.createTextNode(body.slice(last, m.index)));
    const span = document.createElement('span');
    span.className = 'w';
    span.textContent = m[0];
    parent.appendChild(span);
    last = m.index + m[0].length;
  }
  if (last < body.length) parent.appendChild(document.createTextNode(body.slice(last)));
  if (em) {
    const span = document.createElement('span');
    span.className = 'enum';
    span.textContent = text.slice(em.index);
    parent.appendChild(span);
  }
}

/** Normalise a tapped word for lookup: "Sailor’s" → "sailor", "hat," → "hat". */
export function lookupForm(word) {
  return word
    .replace(/[’']s$/i, '')
    .replace(/^[-'’]+|[-'’]+$/g, '')
    .toLowerCase();
}
