// Folio fixtures (Designer-owned). FIXTURE_BOOKS mirrors the API seed data
// (ids 1–8 match covers/cover-<id>.svg). createFixtureSource() is an
// in-memory implementation of the contract-v1 data source used by
// reference.html to demonstrate pending, failure and stale-record states.
// app.js must use the real API, not this module.

import { FolioError, normalizeDraft, validateDraft, STATUS_LABELS } from './components.js';

export const FIXTURE_BOOKS = Object.freeze([
  {
    id: 1,
    title: 'The Salt Archive',
    author: 'Ines Varga',
    status: 'reading',
    notes: 'Halfway through. The chapter on the harbour master’s ledgers — every tide written down for sixty years — is the best thing I’ve read this year.',
  },
  {
    id: 2,
    title: 'Small Hours in Lisbon',
    author: 'Tomás Brandão',
    status: 'finished',
    notes: 'Read on the night train. Slight, but the last page stayed with me for days.',
  },
  { id: 3, title: 'A Grammar of Weather', author: 'Hollis Okafor', status: 'want_to_read', notes: '' },
  {
    id: 4,
    title: 'Paper Architecture',
    author: 'Mireille Castan',
    status: 'reading',
    notes: 'Essays on buildings that were only ever drawn.\nPage 112: the competition entry for a library with no walls.',
  },
  {
    id: 5,
    title: 'The Orchard at Ninth Street',
    author: 'June Halvorsen',
    status: 'finished',
    notes: 'A family novel told in four seasons. Lent to Dana — ask for it back.',
  },
  {
    id: 6,
    title: 'Notes Toward a Blue Room',
    author: 'Saskia Lindqvist',
    status: 'want_to_read',
    notes: 'Recommended by the bookseller on Calle Mayor.',
  },
  {
    id: 7,
    title: 'Every Line a Border',
    author: 'Rafael Ndiaye',
    status: 'finished',
    notes: 'Maps, passports and the people who draw both. Uneven, but the cartography chapters are superb.',
  },
  { id: 8, title: 'What the Kiln Keeps', author: 'Aiko Marrow', status: 'want_to_read', notes: '' },
]);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const copy = (book) => ({ ...book });

/**
 * In-memory data source with failure injection.
 * controls.failNext(op, kind)  op: 'list'|'create'|'update'|'remove', kind: FolioError kind
 * controls.removeQuietly(id)   simulate deletion in another window (stale record)
 * controls.clear()             empty library
 * controls.latency             ms per request
 */
export function createFixtureSource({ books = FIXTURE_BOOKS, latency = 450 } = {}) {
  let rows = books.map(copy);
  let nextId = Math.max(0, ...rows.map((b) => b.id)) + 1;
  const failures = new Map();

  const controls = {
    latency,
    failNext(op, kind) {
      failures.set(op, kind);
    },
    removeQuietly(id) {
      rows = rows.filter((b) => b.id !== id);
    },
    clear() {
      rows = [];
    },
    reset() {
      rows = books.map(copy);
      nextId = Math.max(0, ...rows.map((b) => b.id)) + 1;
    },
    get books() {
      return rows.map(copy);
    },
  };

  async function respond(op) {
    await wait(controls.latency);
    const kind = failures.get(op);
    if (!kind) return;
    failures.delete(op);
    if (kind === 'network') throw FolioError.network(new TypeError('Failed to fetch'));
    const status = { validation: 422, not_found: 404, invalid: 400, server: 500 }[kind] || 500;
    const body = {
      error: {
        code: { 422: 'validation_error', 404: 'not_found', 400: 'invalid_json', 500: 'internal_error' }[status],
        message: 'Injected fixture failure',
        fields: kind === 'validation' ? { title: 'The library rejected this title. Shorten it and try again.' } : undefined,
      },
    };
    throw FolioError.fromResponse(status, body);
  }

  function checked(draft) {
    const clean = normalizeDraft(draft);
    const fields = validateDraft(clean);
    if (Object.keys(fields).length) {
      throw FolioError.fromResponse(422, { error: { code: 'validation_error', message: 'Invalid book', fields } });
    }
    return clean;
  }

  return {
    controls,
    async list({ q = '', status = '' } = {}) {
      await respond('list');
      const needle = q.trim().toLocaleLowerCase();
      if (status && !STATUS_LABELS[status]) throw FolioError.fromResponse(422, { error: { code: 'validation_error' } });
      return rows
        .filter((b) => !status || b.status === status)
        .filter((b) => !needle || b.title.toLocaleLowerCase().includes(needle) || b.author.toLocaleLowerCase().includes(needle))
        .sort((a, b) => a.id - b.id)
        .map(copy);
    },
    async create(draft) {
      await respond('create');
      const book = { id: nextId++, ...checked(draft) };
      rows.push(book);
      return copy(book);
    },
    async update(id, draft) {
      await respond('update');
      const index = rows.findIndex((b) => b.id === id);
      if (index < 0) throw FolioError.fromResponse(404, { error: { code: 'not_found', message: 'Book not found' } });
      rows[index] = { id, ...checked(draft) };
      return copy(rows[index]);
    },
    async remove(id) {
      await respond('remove');
      const before = rows.length;
      rows = rows.filter((b) => b.id !== id);
      if (rows.length === before) throw FolioError.fromResponse(404, { error: { code: 'not_found', message: 'Book not found' } });
    },
  };
}
