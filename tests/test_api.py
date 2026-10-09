import concurrent.futures
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class APITest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.database = Path(self.temp.name) / 'library.sqlite3'
        self.start()

    def start(self):
        self.http = server.make_server(port=0, database=self.database)
        self.thread = threading.Thread(target=self.http.serve_forever)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.http.server_port}'

    def stop(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()

    def tearDown(self):
        self.stop()
        self.temp.cleanup()

    def request(self, method='GET', path='/api/books', body=None, raw=None):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        request = Request(self.url + path, data=data, method=method,
                          headers={'Content-Type': 'application/json'})
        try:
            response = urlopen(request, timeout=5)
        except HTTPError as error:
            response = error
        with response:
            content = response.read()
            return response.status, json.loads(content) if content else None

    def book(self, **changes):
        return {
            **dict(title='New title', author='New author', status='reading', notes=''), **changes}

    def test_designer_seed_contract(self):
        books = self.request()[1]['books']
        self.assertEqual([book['id'] for book in books], list(range(1, 9)))
        self.assertEqual([tuple(book[key] for key in ('title', 'author', 'status', 'notes')) for book in books], server.SEEDS)
        self.assertEqual(books[0]['title'], 'The Salt Archive')
        self.assertEqual(books[1]['author'], 'Tomás Brandão')
        self.assertIn('\nPage 112:', books[3]['notes'])

    def test_crud_literal_notes_and_restart(self):
        self.assertEqual(len(self.request()[1]['books']), 8)
        value = self.book(title=' \tAstral 😀\n', author='  Writer  ', notes='\n<script>alert(1)</script>  \t')
        status, created = self.request('POST', body=value)
        self.assertEqual(status, 201)
        book = created['book']
        self.assertEqual(book['title'], 'Astral 😀')
        self.assertEqual(book['author'], 'Writer')
        self.assertEqual(book['notes'], value['notes'])
        self.assertEqual(self.request(path=f"/api/books/{book['id']}")[1], created)
        updated = self.book(title='Revised', status='finished', notes='literal & text')
        self.assertEqual(self.request('PUT', f"/api/books/{book['id']}", updated)[0], 200)
        self.stop()
        self.start()
        self.assertEqual(self.request(path=f"/api/books/{book['id']}")[1]['book']['title'], 'Revised')
        self.assertEqual(len(self.request()[1]['books']), 9)
        self.assertEqual(self.request('DELETE', f"/api/books/{book['id']}")[0], 204)
        for method in ('GET', 'PUT', 'DELETE'):
            status, result = self.request(method, f"/api/books/{book['id']}", updated if method == 'PUT' else None)
            self.assertEqual(status, 404)
            self.assertEqual(result['error']['code'], 'not_found')
        self.assertEqual(len(self.request()[1]['books']), 8)

    def test_unicode_limits_types_and_atomic_validation(self):
        for field, maximum in [('title', 160), ('author', 120), ('notes', 4000)]:
            valid = self.book(**{field: '😀' * maximum})
            self.assertEqual(self.request('POST', body=valid)[0], 201)
            invalid = self.book(**{field: '😀' * (maximum + 1)})
            status, result = self.request('POST', body=invalid)
            self.assertEqual(status, 422)
            self.assertIn(field, result['error']['fields'])
            for value in (None, 5, [], {}, True):
                self.assertEqual(self.request('POST', body=self.book(**{field: value}))[0], 422)
        for title in ('', ' \t\n', '\u2003'):
            self.assertEqual(self.request('POST', body=self.book(title=title))[0], 422)
        for status in ('Reading', '', None, []):
            self.assertEqual(self.request('POST', body=self.book(status=status))[0], 422)
        before = self.request(path='/api/books/1')[1]
        self.assertEqual(self.request('PUT', '/api/books/1', self.book(author=''))[0], 422)
        self.assertEqual(self.request(path='/api/books/1')[1], before)
        self.assertEqual(self.request('POST', body=[])[0], 422)
        self.assertEqual(self.request('POST', body=self.book(title='\ud800'))[0], 422)

    def test_search_literal_casefold_and_status_intersection(self):
        for title, author, status in [('Straße 100%_', 'A', 'reading'), ('STRASSE 100%_', 'B', 'finished'), ('Other', 'Straße', 'reading')]:
            self.request('POST', body=self.book(title=title, author=author, status=status))
        query = urlencode({'q': 'STRASSE', 'status': 'reading'})
        books = self.request(path='/api/books?' + query)[1]['books']
        self.assertEqual([b['title'] for b in books], ['Straße 100%_', 'Other'])
        self.assertEqual(len(self.request(path='/api/books?' + urlencode({'q': '%_'}))[1]['books']), 2)
        self.assertEqual(self.request(path='/api/books?q=unmatched')[1]['books'], [])
        self.assertEqual(self.request(path='/api/books?status=nope')[0], 422)

    def test_seed_once_after_empty_and_concurrent_initialization(self):
        for book in self.request()[1]['books']:
            self.request('DELETE', f"/api/books/{book['id']}")
        self.stop()
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            list(executor.map(lambda _: server.initialize(self.database), range(8)))
        self.start()
        self.assertEqual(self.request()[1]['books'], [])
        self.assertGreater(self.request('POST', body=self.book())[1]['book']['id'], 8)

    def test_parallel_mutations_and_stale_update(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            results = list(executor.map(lambda n: self.request('POST', body=self.book(title=f'Book {n}')), range(20)))
        self.assertTrue(all(status == 201 for status, _ in results))
        self.assertEqual(len({result['book']['id'] for _, result in results}), 20)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            statuses = list(executor.map(lambda _: self.request('DELETE', '/api/books/1')[0], range(2)))
        self.assertEqual(sorted(statuses), [204, 404])
        self.assertEqual(self.request('PUT', '/api/books/1', self.book())[0], 404)

    def test_structured_errors_and_safe_storage_failure(self):
        for raw in (b'{', b'\xff', b'{"title":NaN}', b'x' * 65537):
            status, error = self.request('POST', raw=raw)
            self.assertEqual(status, 400)
            self.assertEqual(error['error']['code'], 'invalid_json')
        for path in ('/api/unknown', '/api/books/999999999999999999999999', '/api/books/-1'):
            self.assertEqual(self.request(path=path)[0], 404)
        self.assertEqual(self.request('DELETE')[0], 405)
        original = self.http.database
        self.http.database = Path(self.temp.name) / 'absent' / 'no.sqlite3'
        status, error = self.request()
        self.assertEqual(status, 500)
        self.assertEqual(error['error']['code'], 'internal_error')
        self.assertNotIn(self.temp.name, json.dumps(error))
        self.http.database = original

    def test_restart_in_separate_process(self):
        self.stop()
        code = ("import server,sys; http=server.make_server(port=0,database=sys.argv[1]); "
                "print(http.server_port,flush=True); http.serve_forever()")
        def launch():
            process = subprocess.Popen([sys.executable, '-u', '-c', code, str(self.database)],
                                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
            self.url = f'http://127.0.0.1:{int(process.stdout.readline())}'
            return process
        def terminate(process):
            process.terminate()
            process.wait(timeout=5)
            process.stdout.close()
        process = launch()
        try:
            self.assertEqual(self.request('PUT', '/api/books/1', self.book(title='Process restart persisted'))[0], 200)
        finally:
            terminate(process)
        process = launch()
        try:
            self.assertEqual(self.request(path='/api/books/1')[1]['book']['title'], 'Process restart persisted')
            self.assertEqual(len(self.request()[1]['books']), 8)
            for book in self.request()[1]['books']:
                self.request('DELETE', f"/api/books/{book['id']}")
        finally:
            terminate(process)
        process = launch()
        try:
            self.assertEqual(self.request()[1]['books'], [])
        finally:
            terminate(process)
            self.start()


if __name__ == '__main__':
    unittest.main()
