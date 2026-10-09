#!/usr/bin/env python3
"""Folio's dependency-free HTTP and durable SQLite service."""
import argparse
from contextlib import contextmanager
import json
import logging
import os
from pathlib import Path
import re
import sqlite3
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

STATUSES = ('want_to_read', 'reading', 'finished')
SEEDS = [
    ('The Salt Archive', 'Ines Varga', 'reading', "Halfway through. The chapter on the harbour master's ledgers — every tide written down for sixty years — is the best thing I've read this year."),
    ('Small Hours in Lisbon', 'Tomás Brandão', 'finished', 'Read on the night train. Slight, but the last page stayed with me for days.'),
    ('A Grammar of Weather', 'Hollis Okafor', 'want_to_read', ''),
    ('Paper Architecture', 'Mireille Castan', 'reading', 'Essays on buildings that were only ever drawn.\nPage 112: the competition entry for a library with no walls.'),
    ('The Orchard at Ninth Street', 'June Halvorsen', 'finished', 'A family novel told in four seasons. Lent to Dana — ask for it back.'),
    ('Notes Toward a Blue Room', 'Saskia Lindqvist', 'want_to_read', 'Recommended by the bookseller on Calle Mayor.'),
    ('Every Line a Border', 'Rafael Ndiaye', 'finished', 'Maps, passports and the people who draw both. Uneven, but the cartography chapters are superb.'),
    ('What the Kiln Keeps', 'Aiko Marrow', 'want_to_read', ''),
]

ROOT = Path(__file__).resolve().parent


def data_directory():
    configured = os.environ.get('FOLIO_DATA_DIR')
    if configured:
        return Path(configured).expanduser().resolve()
    return Path(os.environ.get('XDG_DATA_HOME', str(Path.home() / '.local/share'))) / 'folio'


@contextmanager
def connect(database):
    connection = sqlite3.connect(database, timeout=10)
    connection.row_factory = sqlite3.Row
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize(database):
    Path(database).parent.mkdir(parents=True, exist_ok=True)
    with connect(database) as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('BEGIN IMMEDIATE')
        db.execute('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
        db.execute('''CREATE TABLE IF NOT EXISTS books (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL, author TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('want_to_read','reading','finished')),
            notes TEXT NOT NULL)''')
        if not db.execute("SELECT 1 FROM metadata WHERE key='seeded'").fetchone():
            db.executemany('INSERT INTO books(title,author,status,notes) VALUES(?,?,?,?)',
                           SEEDS)
            db.execute("INSERT INTO metadata VALUES('seeded','1')")


def validate(payload):
    fields = {}
    if not isinstance(payload, dict):
        return None, {'body': 'Send a JSON object containing title, author, status and notes.'}
    result = {}
    for field, maximum in [('title', 160), ('author', 120), ('notes', 4000)]:
        value = payload.get(field)
        if not isinstance(value, str):
            fields[field] = 'Must be text.'
            continue
        if field != 'notes':
            value = value.strip()
        # Reject unpaired surrogates, which cannot be stored as valid UTF-8.
        try:
            value.encode('utf-8')
        except UnicodeEncodeError:
            fields[field] = 'Must contain valid Unicode text.'
            continue
        if field != 'notes' and not value:
            fields[field] = 'Required.'
        elif len(value) > maximum:
            fields[field] = f'Use {maximum} characters or fewer.'
        result[field] = value
    status = payload.get('status')
    if not isinstance(status, str) or status not in STATUSES:
        fields['status'] = 'Choose Want to read, Reading or Finished.'
    result['status'] = status
    return result, fields


class FolioHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'public'), **kwargs)

    def json_response(self, status, value=None):
        body = b'' if value is None else json.dumps(value, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        if body:
            self.wfile.write(body)

    def error(self, status, code, message, fields=None):
        error = {'code': code, 'message': message}
        if fields is not None:
            error['fields'] = fields
        self.json_response(status, {'error': error})

    def read_payload(self):
        length = self.headers.get('Content-Length', '')
        if not length.isdigit() or int(length) > 65536:
            raise ValueError('Invalid JSON body length')
        return json.loads(self.rfile.read(int(length)).decode('utf-8'),
                          parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))

    def dispatch(self, method):
        path = urlsplit(self.path)
        match = re.fullmatch(r'/api/books/([1-9][0-9]*)', path.path)
        collection = path.path == '/api/books'
        if not collection and not match:
            self.error(404, 'not_found', 'This resource was not found. Refresh the library.')
            return
        if match and len(match.group(1)) > 19:
            self.error(404, 'not_found', 'This book no longer exists. Refresh the library.')
            return
        book_id = int(match.group(1)) if match else None
        if book_id is not None and book_id > 9223372036854775807:
            self.error(404, 'not_found', 'This book no longer exists. Refresh the library.')
            return
        allowed = ('GET', 'POST') if collection else ('GET', 'PUT', 'DELETE')
        if method not in allowed:
            self.error(405, 'method_not_allowed', 'This action is not available for this resource.')
            return
        try:
            payload = None
            if method in ('POST', 'PUT'):
                try:
                    payload = self.read_payload()
                except (ValueError, UnicodeError):
                    self.error(400, 'invalid_json', 'The request could not be read. Send valid JSON and try again.')
                    return
                payload, fields = validate(payload)
                if fields:
                    self.error(422, 'validation_error', 'Check the highlighted fields and try again.', fields)
                    return
            with connect(self.server.database) as db:
                if method == 'GET' and collection:
                    params = parse_qs(path.query, keep_blank_values=True)
                    status = params.get('status', [''])[0]
                    if status and status not in STATUSES:
                        self.error(422, 'validation_error', 'Choose a valid reading status.', {'status': 'Unknown reading status.'})
                        return
                    query = params.get('q', [''])[0].casefold()
                    books = [dict(row) for row in db.execute('SELECT * FROM books ORDER BY id')]
                    books = [book for book in books if (not status or book['status'] == status)
                             and (query in book['title'].casefold() or query in book['author'].casefold())]
                    self.json_response(200, {'books': books})
                elif method == 'POST':
                    cursor = db.execute('INSERT INTO books(title,author,status,notes) VALUES(?,?,?,?)',
                                        tuple(payload[key] for key in ('title', 'author', 'status', 'notes')))
                    book = dict(db.execute('SELECT * FROM books WHERE id=?', (cursor.lastrowid,)).fetchone())
                    db.commit()
                    self.json_response(201, {'book': book})
                elif method == 'PUT':
                    cursor = db.execute('UPDATE books SET title=?,author=?,status=?,notes=? WHERE id=?',
                                        tuple(payload[key] for key in ('title', 'author', 'status', 'notes')) + (book_id,))
                    if not cursor.rowcount:
                        self.error(404, 'not_found', 'This book no longer exists. Refresh the library; your draft can be saved as a new book.')
                        return
                    book = dict(db.execute('SELECT * FROM books WHERE id=?', (book_id,)).fetchone())
                    db.commit()
                    self.json_response(200, {'book': book})
                elif method == 'DELETE':
                    cursor = db.execute('DELETE FROM books WHERE id=?', (book_id,))
                    if not cursor.rowcount:
                        self.error(404, 'not_found', 'This book no longer exists. Refresh the library.')
                        return
                    db.commit()
                    self.json_response(204)
                else:
                    book = db.execute('SELECT * FROM books WHERE id=?', (book_id,)).fetchone()
                    if book is None:
                        self.error(404, 'not_found', 'This book no longer exists. Refresh the library.')
                    else:
                        self.json_response(200, {'book': dict(book)})
        except (sqlite3.Error, OSError):
            logging.exception('Library operation failed')
            self.error(500, 'internal_error', 'The library could not be saved or loaded. Please try again; if this continues, check the service storage.')

    def do_GET(self):
        if urlsplit(self.path).path.startswith('/api/'):
            self.dispatch('GET')
        else:
            super().do_GET()

    def do_POST(self):
        self.dispatch('POST')

    def do_PUT(self):
        self.dispatch('PUT')

    def do_DELETE(self):
        self.dispatch('DELETE')

    def list_directory(self, path):
        self.send_error(404, 'Not found')
        return None


def make_server(host='127.0.0.1', port=8000, database=None):
    database = Path(database) if database else data_directory() / 'library.sqlite3'
    initialize(database)
    server = ThreadingHTTPServer((host, port), FolioHandler)
    server.database = database
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()
    with make_server(args.host, args.port) as server:
        print(f'Folio listening at http://{args.host}:{server.server_port}', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
