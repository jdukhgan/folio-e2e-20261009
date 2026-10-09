# Folio

A personal reading library with eight original fictional books, search, reading-status filters, notes and light/dark themes. Python 3.10+ and SQLite from the standard library are the only runtime dependencies; no install or build step is needed.

```sh
python3 server.py
```

Open http://127.0.0.1:8000. Add a book, select a cover/title to view it, or use the sheet to edit and delete. Close keeps unsaved drafts for the current page session; Cancel discards them. Notes are literal text. Seeds are inserted once; edits and even an emptied collection survive restarts.

Data defaults to `~/.local/share/folio/library.sqlite3` (or `$XDG_DATA_HOME/folio`). Override it with `FOLIO_DATA_DIR` pointing to persistent storage outside the checkout. Runtime databases must stay out of Git. See [API documentation](docs/backend.md) and the [component contract](docs/design/FOUNDATION.md).

The retained development preview uses the enabled, non-transient user service `jlab-preview-folio-e2e-20261009.service`, port 8766, with data at `~/.local/share/folio-e2e-20261009/library.sqlite3`. Its working directory is the retained integration checkout; inspect its absolute configuration with `systemctl --user cat jlab-preview-folio-e2e-20261009.service`. The service runs `/usr/bin/python3 server.py --host 0.0.0.0 --port 8766`, restarts on failure, and uses a lingering user manager so it survives delivery sessions. Local health URL: http://127.0.0.1:8766/api/books.

```sh
systemctl --user start jlab-preview-folio-e2e-20261009.service
systemctl --user restart jlab-preview-folio-e2e-20261009.service
systemctl --user stop jlab-preview-folio-e2e-20261009.service
```

The live service restart was checked with an edited record: all stored records were unchanged. Preview setup is specific to the delivery environment; on another machine use the one-command run above or configure your own user service with an absolute checkout, executable and persistent data path.

```sh
python3 -m unittest discover -s tests -v
```

API tests cover validation, atomic CRUD, literal Unicode search/notes, missing records, parser errors, one-time seeds and process-restart persistence. Integration Builder also exercised real browser CRUD/search/filter, stale-record recovery, injected HTTP/network failures, draft/list retention, delayed duplicate-submit prevention and focus after controls unlock. Independent Review, integrated Verifier evidence and final Designer acceptance remain separate workflow gates.
