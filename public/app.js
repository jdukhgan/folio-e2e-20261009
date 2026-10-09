import { createLibraryView, FolioError, initTheme } from './components.js';

// Keep transport here; the Designer's view owns drafts, pending state and focus.
async function request(path, method = 'GET', draft) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: draft ? { 'Content-Type': 'application/json' } : {},
      ...(draft ? { body: JSON.stringify(draft) } : {}),
      cache: 'no-store',
    });
  } catch (cause) {
    throw FolioError.network(cause);
  }
  if (response.status === 204 && response.ok) return;
  let body;
  try { body = await response.json(); } catch {
    throw FolioError.fromResponse(response.ok ? 500 : response.status, null);
  }
  if (!response.ok) throw FolioError.fromResponse(response.status, body);
  return body;
}

const source = {
  async list({ q = '', status = '' }) {
    const params = new URLSearchParams({ q, status });
    return (await request(`/api/books?${params}`)).books;
  },
  async create(draft) { return (await request('/api/books', 'POST', draft)).book; },
  async update(id, draft) { return (await request(`/api/books/${id}`, 'PUT', draft)).book; },
  async remove(id) { await request(`/api/books/${id}`, 'DELETE'); },
};

initTheme();
createLibraryView(document.getElementById('folio'), source).start();
