// Folio UI components (Designer-owned foundation).
//
// Integration contract — app.js supplies a data source and starts the view:
//
//   import { createLibraryView, FolioError, initTheme } from './components.js';
//   initTheme();
//   const view = createLibraryView(document.getElementById('folio'), source);
//   view.start();
//
// `source` implements shared contract v2 and returns promises:
//   list({ q, status })   -> Book[]      status is '' (all) or a status value
//   create(draft)         -> Book        draft = { title, author, status, notes }
//   update(id, draft)     -> Book
//   remove(id)            -> void
// Failures reject with a FolioError (see FolioError.fromResponse); anything
// else is treated as a network failure. The view owns pending locks, drafts,
// inline errors, retries, missing-record recovery and focus return.

// ---------- Shared constants and validation ----------

export const STATUSES = Object.freeze([
  Object.freeze({ value: 'want_to_read', label: 'Want to read' }),
  Object.freeze({ value: 'reading', label: 'Reading' }),
  Object.freeze({ value: 'finished', label: 'Finished' }),
]);
export const STATUS_LABELS = Object.freeze(
  Object.fromEntries(STATUSES.map((s) => [s.value, s.label])),
);
export const LIMITS = Object.freeze({ title: 160, author: 120, notes: 4000 });
const FIELD_NAMES = Object.freeze({ title: 'title', author: 'author', status: 'status', notes: 'notes' });

/** Unicode code points, matching the server's character count. */
export const countChars = (value) => Array.from(value ?? '').length;

/** Trim title/author; keep notes literally. */
export function normalizeDraft(draft) {
  return {
    title: String(draft.title ?? '').trim(),
    author: String(draft.author ?? '').trim(),
    status: String(draft.status ?? ''),
    notes: String(draft.notes ?? ''),
  };
}

/** Returns { field: message } for a normalized draft; empty when valid. */
export function validateDraft(draft) {
  const errors = {};
  const length = (name, limit, noun) => {
    const n = countChars(draft[name]);
    if (n > limit) errors[name] = `Keep the ${noun} to ${limit.toLocaleString('en')} characters — it is ${n.toLocaleString('en')} now.`;
  };
  if (!draft.title) errors.title = 'Give the book a title.';
  else length('title', LIMITS.title, 'title');
  if (!draft.author) errors.author = 'Add the author’s name.';
  else length('author', LIMITS.author, 'author name');
  if (!STATUS_LABELS[draft.status]) errors.status = 'Choose a reading status.';
  length('notes', LIMITS.notes, 'notes');
  return errors;
}

// ---------- Errors ----------

export class FolioError extends Error {
  /**
   * kind: 'validation' | 'not_found' | 'invalid' | 'server' | 'network'
   * fields: { title?, author?, status?, notes? } server messages (validation only)
   */
  constructor({ kind = 'server', message = '', fields = {}, status = 0 } = {}) {
    super(message || kind);
    this.name = 'FolioError';
    this.kind = kind;
    this.fields = fields;
    this.status = status;
  }

  /** Map an HTTP status and parsed contract-v1 body (or null) to a FolioError. */
  static fromResponse(status, body) {
    const error = body && typeof body === 'object' ? body.error : null;
    const code = error && typeof error.code === 'string' ? error.code : '';
    const message = error && typeof error.message === 'string' ? error.message : '';
    const fields = {};
    if (error && error.fields && typeof error.fields === 'object') {
      for (const [key, value] of Object.entries(error.fields)) {
        if (FIELD_NAMES[key] && typeof value === 'string') fields[key] = value;
      }
    }
    let kind = 'server';
    if (status === 422 || code === 'validation_error') kind = 'validation';
    else if (status === 404 || code === 'not_found') kind = 'not_found';
    else if (status === 400 || code === 'invalid_json') kind = 'invalid';
    return new FolioError({ kind, message, fields, status });
  }

  static network(cause) {
    const error = new FolioError({ kind: 'network', message: 'Network request failed' });
    error.cause = cause;
    return error;
  }
}

const toFolioError = (err) => (err instanceof FolioError ? err : FolioError.network(err));

const SAVE_COPY = {
  network: ['Couldn’t reach your library', 'Folio didn’t get a response. Check that it is still running, then try again — your changes are kept here.'],
  server: ['Couldn’t save your changes', 'Something went wrong on Folio’s side. Your changes are kept here; try again in a moment.'],
  invalid: ['Couldn’t save your changes', 'The library didn’t understand that request. Your changes are kept here; try again.'],
};
const STATUS_COPY = {
  network: 'Folio couldn’t reach your library, so the status is unchanged. Check that it is still running, then try again.',
  server: 'Something went wrong on Folio’s side, so the status is unchanged. Try again in a moment.',
  invalid: 'The library didn’t understand that request, so the status is unchanged. Try again.',
  validation: 'The library didn’t accept this book’s details, so the status is unchanged. Use Edit book to check them.',
};
const DELETE_COPY = {
  network: 'Folio couldn’t reach your library, so nothing was deleted. Check that it is still running and try again.',
  server: 'Something went wrong on Folio’s side, so nothing was deleted. Try again in a moment.',
  invalid: 'The library didn’t understand that request, so nothing was deleted. Try again.',
};

// ---------- Theme ----------

const THEME_KEY = 'folio-theme';

function readStoredTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

/** Apply the stored or system theme to <html data-theme>. Safe to call twice. */
export function initTheme() {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    document.documentElement.dataset.theme = readStoredTheme() || (media.matches ? 'dark' : 'light');
  };
  apply();
  media.addEventListener?.('change', () => {
    if (!readStoredTheme()) apply();
  });
}

export function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode: theme still applies for this page */
  }
}

// ---------- DOM helpers ----------

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value; // static markup only, never user text
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const ICONS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>',
};

export function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
}

function statusTag(status) {
  return el('p', { class: 'status-tag', dataset: { status } }, [
    el('span', { class: 'status-dot', 'aria-hidden': 'true' }),
    STATUS_LABELS[status] || 'Unknown status',
  ]);
}

// ---------- Covers ----------

const SEEDED_COVERS = 8;
const TRIMS = [1.5, 1.42, 1.55, 1.46, 1.52, 1.4, 1.48, 1.44];

// The series inks: every generated cover is printed from these pairs.
const INKS = [
  { bg: '#1E2F5C', fg: '#C9D6E6', ac: '#D99A2B' },
  { bg: '#BCCFE0', fg: '#2B44A8', ac: '#D8452B' },
  { bg: '#3E6B4A', fg: '#D7E3CF', ac: '#E3B04B' },
  { bg: '#D8452B', fg: '#1F1C1A', ac: '#F4EFE4' },
  { bg: '#DDA33A', fg: '#1F1C1A', ac: '#D8452B' },
  { bg: '#2B44A8', fg: '#F1EADC', ac: '#E7A08C' },
  { bg: '#EFD9C8', fg: '#1F1C1A', ac: '#D8452B' },
  { bg: '#B8582F', fg: '#2A2420', ac: '#F1EADC' },
];

function seeded(seed) {
  let t = (seed * 2654435761) >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashText(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  return h;
}

/** Deterministic abstract artwork for books beyond the eight seeded covers. */
function generatedArt(seed) {
  const rand = seeded(seed);
  const { bg, fg, ac } = INKS[seed % INKS.length];
  const motif = Math.floor(rand() * 4);
  const r = (min, max) => Math.round(min + rand() * (max - min));
  let shapes = '';
  if (motif === 0) {
    // stacked bands with one sun
    let y = r(18, 40);
    while (y < 200) {
      const h = r(6, 22);
      shapes += `<rect x="0" y="${y}" width="200" height="${h}" fill="${fg}" opacity="${(0.35 + rand() * 0.55).toFixed(2)}"/>`;
      y += h + r(8, 24);
    }
    shapes += `<circle cx="${r(50, 150)}" cy="${r(50, 120)}" r="${r(18, 34)}" fill="${ac}"/>`;
  } else if (motif === 1) {
    // dot grid with one accented dot
    const pick = r(0, 11);
    let i = 0;
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        shapes += `<circle cx="${40 + col * 60}" cy="${32 + row * 48}" r="15" fill="${i === pick ? ac : fg}"/>`;
        i += 1;
      }
    }
  } else if (motif === 2) {
    // nested arches
    const cx = r(70, 130);
    [96, 72, 48, 24].forEach((rad, n) => {
      shapes += `<path d="M${cx - rad} 210V${210 - rad * 0.9}A${rad} ${rad} 0 0 1 ${cx + rad} ${210 - rad * 0.9}V210Z" fill="${[fg, ac, fg, bg][n]}"/>`;
    });
  } else {
    // diagonal hatching broken by one line
    const gap = r(9, 14);
    for (let x = -210; x < 200; x += gap) shapes += `<path d="M${x} 210L${x + 210} 0" stroke="${fg}" stroke-width="1.3"/>`;
    const y = r(60, 150);
    shapes += `<path d="M0 ${y + 50}L200 ${y - 50}" stroke="${bg}" stroke-width="14"/><path d="M0 ${y + 40}L200 ${y - 60}" stroke="${ac}" stroke-width="3"/>`;
  }
  return `<svg viewBox="0 0 200 210" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><rect width="200" height="210" fill="${bg}"/>${shapes}</svg>`;
}

/**
 * A typeset cover: art panel + label band with live title/author text.
 * Seeded books 1–8 use the authored covers/cover-<id>.svg; later books get
 * generated art from the same inks. Decorative: the adjacent text names the book.
 */
export function renderCover(book) {
  const id = Number(book.id) || 0;
  const seed = id > 0 ? id : hashText(`${book.title}|${book.author}`);
  const art = el('div', { class: 'cover__art' });
  if (id >= 1 && id <= SEEDED_COVERS) {
    art.append(el('img', { src: `covers/cover-${id}.svg`, alt: '', decoding: 'async', draggable: 'false' }));
  } else {
    art.innerHTML = generatedArt(seed);
  }
  const cover = el('div', { class: 'cover', 'aria-hidden': 'true' }, [
    art,
    el('div', { class: 'cover__label' }, [
      el('span', { class: 'cover__title', text: book.title || 'Untitled' }),
      el('span', { class: 'cover__author', text: book.author || '' }),
    ]),
  ]);
  cover.style.setProperty('--trim', TRIMS[seed % TRIMS.length]);
  return cover;
}

// ---------- Library view ----------

const EMPTY_ART = `<svg class="state__art" viewBox="0 0 240 120" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.4">
  <path d="M8 104H232" stroke-width="1.8"/>
  <rect x="96" y="30" width="22" height="74" rx="1.5"/><path d="M100 42h14M100 92h14"/>
  <rect x="122" y="44" width="18" height="60" rx="1.5"/>
  <rect x="0" y="-62" width="16" height="62" rx="1.5" transform="translate(146 104) rotate(24)"/>
</svg>`;

const FOCUSABLE = 'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

export function createLibraryView(root, source, { toastDuration = 4200 } = {}) {
  const state = {
    books: [],
    query: '',
    status: '',
    loaded: false,
    loadError: null,
    request: 0,
  };
  const sheet = {
    mode: null, // 'view' | 'edit' | 'create'
    book: null,
    trigger: null, // { kind: 'book', id } | { kind: 'add' }
    order: [],
    pending: false,
    confirming: false,
    missing: false, // the open book was deleted elsewhere
  };
  const drafts = new Map(); // 'new' | book id -> unsaved draft

  // ----- Shell -----
  root.innerHTML = '';
  const searchInput = el('input', {
    type: 'search',
    id: 'folio-search',
    name: 'q',
    placeholder: 'Search titles and authors',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-controls': 'library',
  });
  const filterOptions = el('div', { class: 'filter__options' });
  [{ value: '', label: 'All' }, STATUSES[1], STATUSES[0], STATUSES[2]].forEach((option, i) => {
    const id = `folio-filter-${option.value || 'all'}`;
    filterOptions.append(
      el('input', { type: 'radio', name: 'status', id, value: option.value, checked: i === 0 }),
      el(
        'label',
        { for: id, dataset: option.value ? { status: option.value } : {} },
        option.value ? [el('span', { class: 'status-dot', 'aria-hidden': 'true' }), option.label] : option.label,
      ),
    );
  });
  const themeButton = el('button', { type: 'button', class: 'icon-button', 'data-action': 'theme' });
  const addButton = el('button', { type: 'button', class: 'button button--primary', 'data-action': 'add' });
  addButton.innerHTML = `${icon('plus')}<span>Add <span class="add-label-long">a </span>book</span>`;

  const library = el('main', { class: 'library page', id: 'library', tabindex: '-1', 'aria-busy': 'true' });
  // A manual popover sits in the top layer, so toasts stay visible above the modal sheet.
  const toastRegion = el('div', { class: 'toast-region', role: 'status', 'aria-live': 'polite', popover: 'manual' });
  // Search/filter results are announced here, only for the response that is current.
  const announcer = el('p', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', 'data-role': 'results-announcer' });
  const dialog = el('dialog', { class: 'sheet', 'aria-labelledby': 'sheet-heading' });

  root.append(
    el('a', { class: 'skip-link', href: '#library', text: 'Skip to library' }),
    el('header', { class: 'masthead' }, [
      el('div', { class: 'masthead__inner page' }, [
        el('h1', { class: 'wordmark', title: 'A personal reading library' }, ['Folio', el('span', { class: 'wordmark__dot', text: '.' })]),
        el('div', { class: 'tools', role: 'search' }, [
          el('div', { class: 'search' }, [
            el('label', { class: 'visually-hidden', for: 'folio-search', text: 'Search titles and authors' }),
            el('span', { html: icon('search') }),
            searchInput,
          ]),
          el('fieldset', { class: 'filter' }, [el('legend', { class: 'visually-hidden', text: 'Show books by status' }), filterOptions]),
        ]),
        el('div', { class: 'masthead__actions' }, [themeButton, addButton]),
      ]),
    ]),
    library,
    announcer,
    toastRegion,
    dialog,
  );

  function syncThemeButton() {
    const dark = document.documentElement.dataset.theme === 'dark';
    themeButton.innerHTML = icon(dark ? 'sun' : 'moon');
    themeButton.setAttribute('aria-label', dark ? 'Use light theme' : 'Use dark theme');
    themeButton.title = dark ? 'Light theme' : 'Dark theme';
  }
  syncThemeButton();
  new MutationObserver(syncThemeButton).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  themeButton.addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  addButton.addEventListener('click', () => openCreate({ kind: 'add' }));

  let searchTimer = 0;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (searchInput.value === state.query) return;
      state.query = searchInput.value;
      refresh({ announce: true });
    }, 220);
  });
  filterOptions.addEventListener('change', (event) => {
    state.status = event.target.value;
    refresh({ announce: true });
  });

  library.addEventListener('click', (event) => {
    const link = event.target.closest('[data-book-id]');
    if (link) {
      const book = state.books.find((b) => b.id === Number(link.dataset.bookId));
      if (book) openDetail(book, { kind: 'book', id: book.id });
      return;
    }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'retry') refresh();
    if (action === 'clear-search') {
      clearTimeout(searchTimer);
      searchInput.value = '';
      state.query = '';
      refresh({ announce: true }).then(() => searchInput.focus());
    }
    if (action === 'show-all') {
      filterOptions.querySelector('#folio-filter-all').checked = true;
      state.status = '';
      refresh({ announce: true }).then(() => filterOptions.querySelector('#folio-filter-all').focus());
    }
    if (action === 'add-empty') openCreate({ kind: 'add' });
  });

  // ----- Loading the collection -----

  /**
   * Reload with the current query and filter. `announce` is set only by
   * search/filter changes: the result summary is spoken once the response that
   * is still current arrives; superseded responses never announce.
   */
  async function refresh({ announce = false } = {}) {
    const request = ++state.request;
    library.setAttribute('aria-busy', 'true');
    if (state.loaded) library.dataset.refreshing = '';
    else renderLibrary();
    let ok = false;
    try {
      const books = await source.list({ q: state.query, status: state.status });
      if (request !== state.request) return false;
      state.books = Array.isArray(books) ? books : [];
      state.loaded = true;
      state.loadError = null;
      ok = true;
      return true;
    } catch (err) {
      if (request !== state.request) return false;
      state.loadError = toFolioError(err);
      return false;
    } finally {
      if (request === state.request) {
        library.setAttribute('aria-busy', 'false');
        delete library.dataset.refreshing;
        renderLibrary();
        if (announce && ok) announceResults();
      }
    }
  }

  function resultSummary() {
    const { books, status } = state;
    const query = state.query.trim();
    const marked = status ? ` marked ${STATUS_LABELS[status]}` : '';
    if (!books.length) {
      return query ? `No books${marked} match “${query}”.` : status ? `No books${marked}.` : 'The library is empty.';
    }
    return `${plural(books.length, 'book', 'books')}${marked}${query ? ` matching “${query}”` : ''}.`;
  }

  function announceResults() {
    const text = resultSummary();
    const request = state.request;
    announcer.textContent = '';
    // A fresh text node after a frame makes identical summaries speak again.
    requestAnimationFrame(() => {
      if (request === state.request) announcer.textContent = text;
    });
  }

  function bookLink(book, className) {
    return el('button', { type: 'button', class: `book-link ${className}`, dataset: { bookId: String(book.id) }, text: book.title });
  }

  /** A book being read: cover, title, author and its note excerpt (literal text). */
  function deskItem(book) {
    const note = book.notes.trim();
    return el('li', { class: 'desk-book' }, [
      renderCover(book),
      el('div', { class: 'desk-book__text' }, [
        el('h3', { class: 'desk-book__title' }, bookLink(book, '')),
        el('p', { class: 'desk-book__author', text: book.author }),
        note
          ? el('p', { class: 'desk-book__note', text: note })
          : el('p', { class: 'desk-book__note desk-book__note--empty', text: 'No notes yet — open the book to add some.' }),
      ]),
    ]);
  }

  function shelfItem(book) {
    return el('li', { class: 'shelf__item' }, [
      el('div', { class: 'shelf__stand' }, renderCover(book)),
      el('div', { class: 'shelf__caption' }, [
        el('h3', { class: 'shelf__title' }, bookLink(book, '')),
        el('p', { class: 'shelf__author', text: book.author }),
        statusTag(book.status),
      ]),
    ]);
  }

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  function sectionHead(id, title, meta) {
    return el('div', { class: 'section-head' }, [
      el('h2', { class: 'section-title', id, text: title }),
      meta ? el('p', { class: 'section-meta', text: meta }) : null,
    ]);
  }

  function stateBlock({ title, text, actions = [], art = false, error = false }) {
    const block = el('div', { class: `state${error ? ' state--error' : ''}` }, [
      art ? el('div', { html: EMPTY_ART }) : null,
      el('h2', { class: 'state__title', text: title }),
      text ? el('p', { class: 'state__text', text }) : null,
      actions.length ? el('div', { class: 'state__actions' }, actions) : null,
    ]);
    if (art) block.firstChild.replaceWith(block.firstChild.firstElementChild);
    return block;
  }

  function actionButton(label, action, variant = 'secondary') {
    return el('button', { type: 'button', class: `button button--${variant}`, 'data-action': action, text: label });
  }

  function renderLibrary() {
    const children = [];
    if (!state.loaded && !state.loadError) {
      const skeleton = el('ol', { class: 'shelf skeleton', 'aria-hidden': 'true' });
      for (let i = 0; i < 6; i += 1) {
        const cover = el('div', { class: 'cover cover--placeholder' });
        cover.style.setProperty('--trim', TRIMS[i]);
        skeleton.append(
          el('li', { class: 'shelf__item' }, [
            el('div', { class: 'shelf__stand' }, cover),
            el('div', { class: 'shelf__caption' }, [el('div', { class: 'shelf__title' }), el('div', { class: 'shelf__author' })]),
          ]),
        );
      }
      children.push(
        el('section', { class: 'shelf-section' }, [sectionHead('shelf-heading', 'The shelf', 'Loading…'), skeleton]),
      );
    } else if (!state.loaded) {
      children.push(
        stateBlock({
          title: 'Your library didn’t load',
          text: 'Folio couldn’t reach its library. Check that it is still running, then try again.',
          actions: [actionButton('Try again', 'retry', 'primary')],
          error: true,
        }),
      );
    } else {
      if (state.loadError) {
        children.push(
          el('div', { class: 'banner', role: 'alert' }, [
            el('span', { text: 'Couldn’t refresh your library. You’re seeing the last books that loaded.' }),
            actionButton('Try again', 'retry'),
          ]),
        );
      }
      children.push(...renderCollection());
    }
    library.replaceChildren(...children);
    // Desk beside the shelf on wide screens; everything else is one column.
    library.dataset.layout = library.querySelector(':scope > .desk--rail') && library.querySelector(':scope > .shelf-section') ? 'split' : 'single';
  }

  function renderCollection() {
    const { books, query, status } = state;
    const filtered = Boolean(query.trim() || status);
    if (!books.length && !filtered) {
      return [
        stateBlock({
          title: 'An empty shelf',
          text: 'Add the first book you want to remember — something you are reading, have finished or mean to start.',
          actions: [actionButton('Add a book', 'add-empty', 'primary')],
          art: true,
        }),
      ];
    }
    if (!books.length) {
      const where = status ? ` among books marked “${STATUS_LABELS[status]}”` : '';
      const actions = [];
      if (query.trim()) actions.push(actionButton('Clear search', 'clear-search'));
      if (status) actions.push(actionButton('Show all statuses', 'show-all'));
      return [
        stateBlock({
          title: query.trim() ? `Nothing matches “${query.trim()}”` : `No books marked “${STATUS_LABELS[status]}”`,
          text: query.trim()
            ? `No title or author contains that text${where}. Check the spelling or search for part of a name.`
            : 'Change a book’s status from its page, or look through the whole library.',
          actions,
        }),
      ];
    }
    if (filtered) {
      const title = query.trim()
        ? `Results for “${query.trim()}”`
        : STATUS_LABELS[status];
      const meta = query.trim() && status ? `${plural(books.length, 'book', 'books')} · ${STATUS_LABELS[status]}` : plural(books.length, 'book', 'books');
      // The Reading filter keeps each book's notes: it is the reading journal, not a thinner shelf.
      if (status === 'reading') {
        return [
          el('section', { class: 'desk desk--journal', 'aria-labelledby': 'shelf-heading' }, [
            sectionHead('shelf-heading', title, meta),
            el('ol', { class: 'desk__list' }, books.map(deskItem)),
          ]),
        ];
      }
      return [
        el('section', { class: 'shelf-section', 'aria-labelledby': 'shelf-heading' }, [
          sectionHead('shelf-heading', title, meta),
          el('ol', { class: 'shelf' }, books.map(shelfItem)),
        ]),
      ];
    }
    const reading = books.filter((b) => b.status === 'reading');
    const rest = books.filter((b) => b.status !== 'reading');
    const sections = [];
    if (reading.length) {
      sections.push(
        el('section', { class: 'desk desk--rail', 'aria-labelledby': 'desk-heading' }, [
          sectionHead('desk-heading', 'On the desk', `${reading.length} in progress`),
          el('ol', { class: 'desk__list' }, reading.map(deskItem)),
        ]),
      );
    }
    if (rest.length) {
      sections.push(
        el('section', { class: 'shelf-section', 'aria-labelledby': 'shelf-heading' }, [
          sectionHead('shelf-heading', 'The shelf', plural(rest.length, 'book', 'books')),
          el('ol', { class: 'shelf' }, rest.map(shelfItem)),
        ]),
      );
    }
    return sections;
  }

  // ----- Toasts -----

  const canPopover = typeof toastRegion.showPopover === 'function';

  function raiseToasts() {
    if (!canPopover || !toastRegion.isConnected) return;
    if (toastRegion.matches(':popover-open')) toastRegion.hidePopover();
    if (toastRegion.childElementCount) toastRegion.showPopover();
  }

  function toast(message) {
    const node = el('div', { class: 'toast', text: message });
    toastRegion.append(node);
    raiseToasts();
    setTimeout(() => {
      node.remove();
      if (!toastRegion.childElementCount && canPopover && toastRegion.matches(':popover-open')) toastRegion.hidePopover();
    }, toastDuration);
  }

  // ----- Sheet: shared -----

  const bookLinks = () => [...library.querySelectorAll('[data-book-id]')];
  const findBookLink = (id) => library.querySelector(`[data-book-id="${Number(id)}"]`);

  function openSheet(trigger) {
    if (dialog.open) return;
    sheet.trigger = trigger;
    sheet.order = bookLinks().map((link) => Number(link.dataset.bookId));
    sheet.pending = false;
    sheet.confirming = false;
    sheet.missing = false;
    dialog.showModal();
    raiseToasts();
  }

  function closeSheet() {
    if (sheet.pending || !dialog.open) return;
    dialog.close();
  }

  function restoreFocus() {
    const { trigger, order } = sheet;
    let target = null;
    if (trigger?.kind === 'book') {
      target = findBookLink(trigger.id);
      if (!target) {
        // The opener disappeared: next surviving book, then previous, then Add.
        const index = order.indexOf(trigger.id);
        const after = order.slice(index + 1);
        const before = order.slice(0, Math.max(index, 0)).reverse();
        for (const id of [...after, ...before]) {
          target = findBookLink(id);
          if (target) break;
        }
      }
    }
    (target || addButton).focus();
    sheet.mode = null;
    sheet.book = null;
    sheet.trigger = null;
  }

  dialog.addEventListener('close', () => {
    sheet.pending = false;
    restoreFocus();
    raiseToasts();
  });

  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (sheet.pending) {
        announcePending();
      } else if (sheet.confirming) {
        cancelConfirm();
      } else {
        closeSheet();
      }
      return;
    }
    if (event.key === 'Tab') {
      const focusables = [...dialog.querySelectorAll(FOCUSABLE)].filter(
        (node) => !node.hidden && node.offsetParent !== null && !node.closest('[hidden]'),
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  dialog.addEventListener('cancel', (event) => {
    // Escape is handled in keydown; never let the platform close a pending sheet.
    event.preventDefault();
  });
  dialog.addEventListener('click', (event) => {
    // Clicking the backdrop closes when safe.
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (!inside) closeSheet();
    }
  });

  function closeButton() {
    const button = el('button', { type: 'button', class: 'icon-button', 'aria-label': 'Close', 'data-role': 'close', html: icon('close') });
    button.addEventListener('click', () => {
      if (sheet.pending) announcePending();
      else closeSheet();
    });
    return button;
  }

  function pendingNote() {
    return el('p', { class: 'sheet__pending', 'aria-live': 'polite', 'data-role': 'pending' });
  }

  function announcePending() {
    const note = dialog.querySelector('[data-role="pending"]');
    if (!note) return;
    note.textContent = '';
    requestAnimationFrame(() => {
      note.textContent = `${sheet.pendingLabel} You can close this once the library responds.`;
    });
  }

  /** Lock or unlock every mutation control in the sheet. */
  function setPending(on, label = '') {
    sheet.pending = on;
    sheet.pendingLabel = label;
    dialog.toggleAttribute('data-pending', on);
    for (const control of dialog.querySelectorAll('[data-lock]')) {
      control.setAttribute('aria-disabled', String(on));
    }
    for (const field of dialog.querySelectorAll('input:not([type="radio"]), textarea')) field.readOnly = on;
    const active = dialog.querySelector('[data-active-action]');
    if (active) {
      active.dataset.pending = String(on);
      const text = active.querySelector('[data-label]');
      if (text) text.textContent = on ? active.dataset.pendingText : active.dataset.idleText;
      if (!on) active.removeAttribute('data-active-action');
    }
    const note = dialog.querySelector('[data-role="pending"]');
    if (note) note.textContent = on ? label : '';
  }

  function lockedButton(text, variant, { pendingText, iconName } = {}) {
    const button = el('button', {
      type: 'button',
      class: `button button--${variant}`,
      'data-lock': '',
      'aria-disabled': 'false',
      dataset: { idleText: text, pendingText: pendingText || text },
    });
    button.innerHTML = iconName ? icon(iconName) : '';
    button.append(el('span', { 'data-label': '', text }));
    return button;
  }

  const isLocked = (button) => sheet.pending || button.getAttribute('aria-disabled') === 'true';

  // ----- Sheet: detail -----

  function openDetail(book, trigger) {
    openSheet(trigger);
    showDetail(book);
  }

  function showDetail(book, { focus = 'heading' } = {}) {
    sheet.mode = 'view';
    sheet.book = book;
    sheet.confirming = false;
    const heading = el('h2', { class: 'detail__title', id: 'sheet-heading', tabindex: '-1', text: book.title });
    const notes = book.notes.trim()
      ? el('p', { class: 'notes-text', text: book.notes })
      : el('p', { class: 'notes-empty', text: 'No notes yet.' });

    const editButton = lockedButton('Edit book', 'secondary', { iconName: 'pencil' });
    const deleteButton = lockedButton('Delete', 'danger-quiet', { iconName: 'trash' });
    const footer = el('div', { class: 'sheet__footer' }, [editButton, el('span', { class: 'spacer' }), deleteButton, pendingNote()]);

    // Handlers read sheet.book: a status change replaces it while the sheet stays open.
    editButton.addEventListener('click', () => {
      if (!isLocked(editButton)) showEditor('edit', sheet.book);
    });
    deleteButton.addEventListener('click', () => {
      if (!isLocked(deleteButton)) showConfirm(sheet.book, footer);
    });

    dialog.replaceChildren(
      el('div', { class: 'sheet__panel' }, [
        el('div', { class: 'sheet__bar sheet__bar--end' }, closeButton()),
        el('div', { class: 'sheet__body' }, [
          el('div', { class: 'detail__head' }, [
            renderCover(book),
            el('div', { class: 'detail__meta' }, [heading, el('p', { class: 'detail__author', text: book.author })]),
          ]),
          statusSwitch(book),
          el('section', { class: 'detail__notes', 'aria-labelledby': 'notes-label' }, [
            el('h3', { class: 'detail__label', id: 'notes-label', text: 'Notes' }),
            notes,
          ]),
        ]),
        footer,
      ]),
    );
    if (sheet.missing) lockMissing();
    if (focus === 'heading') heading.focus();
    else if (focus === 'delete') deleteButton.focus();
  }

  // ----- Sheet: direct status change -----

  /**
   * Three toggle buttons (aria-pressed), not radios: arrow keys never send a
   * request. The pressed state always shows the committed status; the chosen
   * option shows progress until the library confirms.
   */
  function statusSwitch(book) {
    const group = el('div', { class: 'status-switch', role: 'group', 'aria-labelledby': 'status-switch-label' });
    for (const option of STATUSES) {
      const button = el(
        'button',
        {
          type: 'button',
          class: 'status-switch__option',
          'data-lock': '',
          'aria-disabled': 'false',
          'aria-pressed': String(book.status === option.value),
          dataset: { status: option.value, idleText: option.label, pendingText: option.label },
        },
        [el('span', { class: 'status-dot', 'aria-hidden': 'true' }), el('span', { 'data-label': '', text: option.label })],
      );
      button.addEventListener('click', () => {
        if (sheet.pending) announcePending();
        else if (!isLocked(button) && sheet.book.status !== option.value) changeStatus(option.value);
      });
      group.append(button);
    }
    return el('div', { class: 'detail__status' }, [
      el('p', { class: 'detail__label', id: 'status-switch-label', text: 'Reading status' }),
      group,
      el('div', { class: 'alert', role: 'alert', tabindex: '-1', hidden: true, 'data-role': 'status-alert' }),
    ]);
  }

  const statusButton = (status) => dialog.querySelector(`.status-switch__option[data-status="${status}"]`);

  function showStatusAlert({ title, text, actions = [] }) {
    const alert = dialog.querySelector('[data-role="status-alert"]');
    alert.replaceChildren(
      el('p', { class: 'alert__title', text: title }),
      text ? el('p', { class: 'alert__text', text }) : null,
      actions.length ? el('div', { class: 'alert__actions' }, actions) : null,
    );
    alert.hidden = false;
    return alert;
  }

  function hideStatusAlert() {
    const alert = dialog.querySelector('[data-role="status-alert"]');
    if (!alert) return;
    alert.hidden = true;
    alert.replaceChildren();
  }

  /** The open book was deleted elsewhere: keep the page readable, lock every mutation. */
  function lockMissing() {
    for (const control of dialog.querySelectorAll('[data-lock]')) control.setAttribute('aria-disabled', 'true');
  }

  async function changeStatus(status) {
    if (sheet.pending || sheet.mode !== 'view') return;
    const book = sheet.book;
    const label = STATUS_LABELS[status];
    hideStatusAlert();
    statusButton(status).setAttribute('data-active-action', '');
    setPending(true, `Moving “${book.title}” to ${label}…`);
    let saved;
    try {
      // Untouched fields are sent exactly as last committed.
      saved = await source.update(book.id, { title: book.title, author: book.author, status, notes: book.notes });
    } catch (err) {
      const error = toFolioError(err);
      if (error.kind === 'not_found') {
        await refresh();
        setPending(false);
        sheet.missing = true;
        lockMissing();
        const close = el('button', { type: 'button', class: 'button button--secondary', text: 'Close' });
        close.addEventListener('click', () => closeSheet());
        showStatusAlert({
          title: `“${book.title}” is no longer in your library`,
          text: 'It may have been deleted in another window, so nothing was changed. Close this page to return to your books.',
          actions: [close],
        }).focus();
        return;
      }
      setPending(false);
      const again = el('button', { type: 'button', class: 'button button--secondary', text: `Try “${label}” again` });
      again.addEventListener('click', () => {
        if (sheet.pending) announcePending();
        else changeStatus(status);
      });
      showStatusAlert({ title: 'Couldn’t change the status', text: STATUS_COPY[error.kind] || STATUS_COPY.server, actions: [again] }).focus();
      return;
    }
    await refresh();
    setPending(false);
    sheet.book = saved;
    for (const option of dialog.querySelectorAll('.status-switch__option')) {
      option.setAttribute('aria-pressed', String(option.dataset.status === saved.status));
    }
    statusButton(saved.status)?.focus();
    toast(`“${saved.title}” is now marked ${STATUS_LABELS[saved.status]}.`);
  }

  function showConfirm(book, footer, errorText = '') {
    sheet.confirming = true;
    const confirmButton = lockedButton('Delete book', 'danger', { pendingText: 'Deleting…' });
    const keepButton = lockedButton('Keep it', 'secondary');
    const text = el('p', { class: 'confirm__text', id: 'confirm-text', tabindex: '-1' });
    text.append('Delete ', el('strong', { text: `“${book.title}”` }), ' from your library? This can’t be undone.');
    const error = errorText ? el('p', { class: 'alert', role: 'alert', text: errorText }) : null;
    const confirm = el('div', { class: 'confirm', role: 'group', 'aria-labelledby': 'confirm-text' }, [
      error,
      text,
      el('div', { class: 'confirm__actions' }, [confirmButton, keepButton]),
    ]);
    footer.replaceChildren(confirm, pendingNote());
    keepButton.addEventListener('click', () => {
      if (!isLocked(keepButton)) cancelConfirm();
    });
    confirmButton.addEventListener('click', () => {
      if (!isLocked(confirmButton)) deleteBook(book, confirmButton, footer);
    });
    (errorText ? confirmButton : keepButton).focus();
  }

  function cancelConfirm() {
    if (sheet.mode === 'view' && sheet.book) showDetail(sheet.book, { focus: 'delete' });
  }

  async function deleteBook(book, button, footer) {
    if (sheet.pending) return;
    button.setAttribute('data-active-action', '');
    setPending(true, `Deleting “${book.title}”…`);
    let outcome = 'deleted';
    try {
      await source.remove(book.id);
    } catch (err) {
      const error = toFolioError(err);
      if (error.kind === 'not_found') {
        outcome = 'missing';
      } else {
        setPending(false);
        showConfirm(book, footer, DELETE_COPY[error.kind] || DELETE_COPY.server);
        return;
      }
    }
    drafts.delete(book.id);
    const refreshed = await refresh();
    if (!refreshed) {
      state.books = state.books.filter((b) => b.id !== book.id);
      renderLibrary();
    }
    setPending(false);
    closeSheet();
    toast(outcome === 'deleted' ? `Deleted “${book.title}”.` : `“${book.title}” had already been removed.`);
  }

  // ----- Sheet: editor -----

  function openCreate(trigger) {
    if (dialog.open) return;
    openSheet(trigger);
    showEditor('create', null);
  }

  function fieldBlock({ name, label, control, limit, alwaysCount = false, hint }) {
    const count = limit
      ? el('span', { class: 'field__count', id: `count-${name}`, dataset: { always: String(alwaysCount), near: 'false', over: 'false' } })
      : null;
    const error = el('p', { class: 'field__error', id: `error-${name}`, 'data-error-for': name });
    control.setAttribute('aria-describedby', [count ? count.id : '', error.id].filter(Boolean).join(' '));
    return el('div', { class: 'field' }, [
      el('div', { class: 'field__top' }, [
        el('label', { class: 'field__label', for: control.id }, [label, hint ? el('span', { class: 'field__hint', text: ` ${hint}` }) : null]),
        count,
      ]),
      control,
      error,
    ]);
  }

  function showEditor(mode, book, { restoreDraft = true } = {}) {
    sheet.mode = mode;
    sheet.book = book;
    sheet.confirming = false;
    const key = mode === 'create' ? 'new' : book.id;
    const original = book
      ? { title: book.title, author: book.author, status: book.status, notes: book.notes }
      : { title: '', author: '', status: 'want_to_read', notes: '' };
    const saved = restoreDraft ? drafts.get(key) : null;
    const values = saved || original;

    const title = el('input', { class: 'input input--title', id: 'field-title', name: 'title', autocomplete: 'off', required: true });
    const author = el('input', { class: 'input', id: 'field-author', name: 'author', autocomplete: 'off', required: true });
    const notes = el('textarea', { class: 'input', id: 'field-notes', name: 'notes', rows: '7' });
    title.value = values.title;
    author.value = values.author;
    notes.value = values.notes;

    const choice = el('div', { class: 'choice' });
    for (const option of STATUSES) {
      const id = `field-status-${option.value}`;
      choice.append(
        el('input', { type: 'radio', name: 'status', id, value: option.value, checked: values.status === option.value }),
        el('label', { for: id, dataset: { status: option.value } }, [el('span', { class: 'status-dot', 'aria-hidden': 'true' }), option.label]),
      );
    }
    const statusError = el('p', { class: 'field__error', id: 'error-status', 'data-error-for': 'status' });
    const statusField = el('fieldset', { class: 'field', 'aria-describedby': 'error-status' }, [
      el('legend', { class: 'field__label', text: 'Status' }),
      choice,
      statusError,
    ]);
    choice.addEventListener('click', (event) => {
      if (sheet.pending && event.target.matches('input')) event.preventDefault();
    });

    const alert = el('div', { class: 'alert', role: 'alert', tabindex: '-1', hidden: true, 'data-role': 'alert' });
    const restored = saved
      ? el('div', { class: 'alert alert--info', 'data-role': 'restored' }, [
          el('p', { class: 'alert__title', text: 'Your unsaved changes are back.' }),
          el('div', { class: 'alert__actions' }, [
            el('button', {
              type: 'button',
              class: 'button button--quiet',
              text: 'Discard them',
              onclick: () => {
                if (sheet.pending) return;
                drafts.delete(key);
                showEditor(mode, book, { restoreDraft: false });
              },
            }),
          ]),
        ])
      : null;

    const submitText = mode === 'create' ? 'Add to library' : 'Save changes';
    const submit = lockedButton(submitText, 'primary', { pendingText: mode === 'create' ? 'Adding…' : 'Saving…' });
    submit.type = 'submit';
    const cancel = lockedButton('Cancel', 'quiet');
    const form = el('form', { class: 'editor', novalidate: true, 'aria-labelledby': 'sheet-heading' }, [
      el('div', { class: 'sheet__bar' }, [
        el('h2', { class: 'sheet__bar-title', id: 'sheet-heading', tabindex: '-1', text: mode === 'create' ? 'Add a book' : 'Edit book' }),
        closeButton(),
      ]),
      el('div', { class: 'sheet__body' }, [
        restored,
        alert,
        el('div', { class: 'editor__fields' }, [
          fieldBlock({ name: 'title', label: 'Title', control: title, limit: LIMITS.title }),
          fieldBlock({ name: 'author', label: 'Author', control: author, limit: LIMITS.author }),
          statusField,
          fieldBlock({ name: 'notes', label: 'Notes', control: notes, limit: LIMITS.notes, alwaysCount: true, hint: '(optional)' }),
        ]),
      ]),
      el('div', { class: 'sheet__footer' }, [submit, cancel, pendingNote()]),
    ]);

    const readForm = () => ({
      title: title.value,
      author: author.value,
      status: form.querySelector('input[name="status"]:checked')?.value || '',
      notes: notes.value,
    });

    const updateCounts = () => {
      for (const [name, control] of [['title', title], ['author', author], ['notes', notes]]) {
        const count = form.querySelector(`#count-${name}`);
        const n = countChars(name === 'notes' ? control.value : control.value.trim());
        const limit = LIMITS[name];
        count.textContent = `${n.toLocaleString('en')} / ${limit.toLocaleString('en')}`;
        count.dataset.near = String(n >= limit * 0.8);
        count.dataset.over = String(n > limit);
      }
    };
    updateCounts();

    form.addEventListener('input', () => {
      updateCounts();
      const current = readForm();
      const dirty = Object.keys(original).some((k) => current[k] !== original[k]);
      if (dirty) drafts.set(key, current);
      else drafts.delete(key);
    });

    cancel.addEventListener('click', () => {
      if (isLocked(cancel)) return;
      drafts.delete(key);
      if (sheet.mode === 'edit' && sheet.book) showDetail(sheet.book);
      else closeSheet();
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (isLocked(submit)) {
        if (sheet.pending) announcePending();
        return;
      }
      save(form, submit, readForm);
    });

    dialog.replaceChildren(el('div', { class: 'sheet__panel' }, form));
    title.focus();
  }

  function showFieldErrors(form, errors) {
    for (const node of form.querySelectorAll('[data-error-for]')) {
      const name = node.dataset.errorFor;
      const message = errors[name] || '';
      node.innerHTML = message ? icon('alert') : '';
      if (message) node.append(el('span', { text: message }));
      const control = name === 'status' ? null : form.querySelector(`[name="${name}"]`);
      if (control) control.setAttribute('aria-invalid', String(Boolean(message)));
    }
  }

  function showAlert(form, { title, text, actions = [] }) {
    const alert = form.querySelector('[data-role="alert"]');
    alert.replaceChildren(
      el('p', { class: 'alert__title', text: title }),
      text ? el('p', { class: 'alert__text', text }) : null,
      actions.length ? el('div', { class: 'alert__actions' }, actions) : null,
    );
    alert.hidden = false;
    return alert;
  }

  function hideAlert(form) {
    const alert = form.querySelector('[data-role="alert"]');
    alert.hidden = true;
    alert.replaceChildren();
  }

  function focusFirstInvalid(form, errors) {
    const first = ['title', 'author', 'status', 'notes'].find((name) => errors[name]);
    const target = first === 'status' ? form.querySelector('input[name="status"]:checked') || form.querySelector('input[name="status"]') : form.querySelector(`[name="${first}"]`);
    target?.focus();
  }

  async function save(form, submit, readForm) {
    if (sheet.pending) return;
    const mode = sheet.mode;
    const key = mode === 'create' ? 'new' : sheet.book.id;
    const draft = normalizeDraft(readForm());
    const errors = validateDraft(draft);
    showFieldErrors(form, errors);
    hideAlert(form);
    form.querySelector('[data-role="restored"]')?.remove();
    if (Object.keys(errors).length) {
      focusFirstInvalid(form, errors);
      return;
    }

    submit.setAttribute('data-active-action', '');
    setPending(true, mode === 'create' ? 'Adding this book to your library…' : 'Saving your changes…');
    let saved;
    try {
      saved = mode === 'create' ? await source.create(draft) : await source.update(sheet.book.id, draft);
    } catch (err) {
      setPending(false);
      handleSaveError(form, toFolioError(err), { mode, key, draft, retry: () => save(form, submit, readForm) });
      return;
    }
    drafts.delete(key);
    await refresh();
    setPending(false);
    if (!dialog.open) return;
    showDetail(saved);
    toast(mode === 'create' ? `Added “${saved.title}” to your library.` : 'Changes saved.');
  }

  function handleSaveError(form, error, { mode, key, draft, retry }) {
    drafts.set(key, readDraftFrom(form));
    if (error.kind === 'validation') {
      const fields = { ...validateDraft(draft), ...error.fields };
      if (!Object.keys(fields).length) fields.title = 'Check this book’s details and try again.';
      showFieldErrors(form, fields);
      const alert = showAlert(form, {
        title: 'Some details need attention',
        text: 'Fix the highlighted fields and save again. Nothing you typed was lost.',
      });
      if (Object.keys(error.fields).length) focusFirstInvalid(form, fields);
      else alert.focus();
      return;
    }
    if (error.kind === 'not_found' && mode === 'edit') {
      const missing = sheet.book;
      refresh();
      const saveAsNew = el('button', { type: 'button', class: 'button button--primary', text: 'Save as a new book' });
      const discard = el('button', { type: 'button', class: 'button button--quiet', text: 'Discard changes' });
      saveAsNew.addEventListener('click', () => {
        if (sheet.pending) return;
        drafts.delete(key);
        drafts.set('new', readDraftFrom(form));
        sheet.mode = 'create';
        sheet.book = null;
        form.querySelector('#sheet-heading').textContent = 'Add a book';
        const submit = form.querySelector('button[type="submit"]');
        submit.dataset.idleText = 'Add to library';
        submit.dataset.pendingText = 'Adding…';
        submit.querySelector('[data-label]').textContent = 'Add to library';
        hideAlert(form);
        form.requestSubmit(submit);
      });
      discard.addEventListener('click', () => {
        if (sheet.pending) return;
        drafts.delete(key);
        closeSheet();
      });
      showAlert(form, {
        title: `“${missing.title}” is no longer in your library`,
        text: 'It may have been deleted in another window. Your changes are still here — save them as a new book or discard them.',
        actions: [saveAsNew, discard],
      }).focus();
      return;
    }
    const [title, text] = SAVE_COPY[error.kind] || SAVE_COPY.server;
    const again = el('button', { type: 'button', class: 'button button--secondary', text: 'Try again' });
    again.addEventListener('click', () => {
      if (!sheet.pending) retry();
    });
    showAlert(form, { title, text, actions: [again] }).focus();
  }

  function readDraftFrom(form) {
    return {
      title: form.querySelector('[name="title"]').value,
      author: form.querySelector('[name="author"]').value,
      status: form.querySelector('input[name="status"]:checked')?.value || '',
      notes: form.querySelector('[name="notes"]').value,
    };
  }

  return {
    start: () => refresh(),
    refresh,
    openCreate: () => openCreate({ kind: 'add' }),
    /** Testing/inspection hook: current state snapshot. */
    get snapshot() {
      return {
        books: state.books.slice(),
        query: state.query,
        status: state.status,
        sheet: sheet.mode,
        bookId: sheet.book ? sheet.book.id : null,
        pending: sheet.pending,
      };
    },
  };
}
