# Folio API

Requires Python 3.10+ with its standard SQLite module; no packages to install.

```sh
python3 server.py
```

The default address is `http://127.0.0.1:8000`. Use `--host` and `--port` for an explicitly configured preview. The server serves the sibling `public/` directory; UI assets are delivered by the separate design/integration cards.

Data lives at `$FOLIO_DATA_DIR/library.sqlite3` when configured, otherwise `$XDG_DATA_HOME/folio/library.sqlite3` or `~/.local/share/folio/library.sqlite3`. Set an absolute persistent directory outside checkout/build output for service deployment. The service user needs write access to that directory, including SQLite journal files. Database initialization uses an atomic metadata marker: the eight fictional books seed once, and deleting all books never triggers reseeding. Restarting against the same directory preserves edits. Back up the database using SQLite's backup API or stop the service before copying its database and journal files. Runtime databases must never enter Git.

## HTTP contract

Book fields: positive integer `id`, strings `title`, `author`, `status`, `notes`. Status values: `want_to_read`, `reading`, `finished`. Required title/author trim outer whitespace and allow 160/120 Unicode code points. Notes preserve literal whitespace and markup, allowing 4000 code points. Invalid types and unpaired Unicode surrogates are rejected. No Unicode normalization is performed.

- `GET /api/books?q=&status=` → `{books:[...]}`, stable id order. Search is literal Unicode case-insensitive substring matching in title/author, combined with status by AND.
- `GET /api/books/:id` → `{book:...}`.
- `POST /api/books` with all four fields → 201 `{book:...}`.
- `PUT /api/books/:id` replaces all four fields → 200 `{book:...}`.
- `DELETE /api/books/:id` → 204, no body.

Failures return `{error:{code,message,fields?}}`: malformed JSON 400 `invalid_json`, invalid fields 422 `validation_error`, missing/deleted records 404 `not_found`, unsupported actions 405 `method_not_allowed`, storage failures 500 `internal_error`. The 500 response contains actionable safe text; details remain in service logs. Bodies are bounded to 64 KiB. Excessively nested JSON is safely rejected without mutation: 400 `invalid_json` when it exceeds the runtime parser's nesting capacity, or 422 `validation_error` when parsing succeeds but field types are invalid. Both responses retain the structured error envelope; this contract is portable across Python parser versions. Failed validation never partially updates a record; PUT never recreates a deleted record. Successful mutation responses follow transaction commit.

The frontend owns pending-action locking, draft retention, literal DOM text rendering, and keyboard focus recovery. No UI files are owned by this prerequisite.

## Focused verification

```sh
python3 -m unittest discover -s tests -v
```

Tests create isolated temporary databases and loopback HTTP servers, stop/join every server, and remove data afterward. Coverage includes CRUD, literal notes, Unicode boundaries/types/whitespace, combined search, malformed payloads, safe storage failures, missing/stale records, concurrent writes/deletes, concurrent initialization of an emptied library, and real HTTP process restarts preserving edits and an emptied library. The integrated preview's independently supervised service and full browser evidence are owned by integration and Verifier.
