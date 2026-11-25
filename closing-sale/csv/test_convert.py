"""convert.py のテスト。  実行:  python3 -m unittest closing-sale/csv/test_convert.py -v"""
import csv
import io
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import convert  # noqa: E402

HEADER = ['code', 'sub-code', 'original-price', 'price', 'sale-price', 'member-price',
          'sale-period-start', 'sale-period-end', 'postage-set']
ROWS = [
    ['bura00014', 'カラー:ミルクティー#サイズ:S=bura00014-mi-s&カラー:ミルクティー#サイズ:M=bura00014-mi-m',
     '2970', '2580', '1380', '1080', '2026110818', '2026112217', '14'],
    ['bura00019', 'カラー:カーキ#サイズ:フリーサイズ=bura00019-ca-f', '2220', '1980', '1180', '1080',
     '2026110818', '2026112217', '3'],
]


def make_csv(path, header=HEADER, rows=ROWS):
    text = '\r\n'.join(','.join(r) for r in [header] + rows) + '\r\n'
    path.write_bytes(text.encode('cp932'))


def read_csv(path):
    raw = path.read_bytes()
    return raw, list(csv.reader(io.StringIO(raw.decode('cp932'), newline='')))


class ConvertTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.src = self.dir / 'in.csv'
        self.dst = self.dir / 'out.csv'
        make_csv(self.src)

    def run_convert(self, **kw):
        convert.convert(self.src, self.dst, kw.get('start', '2026112500'), kw.get('end', '2026113017'))
        return read_csv(self.dst)

    def test_prices_become_1_yen_and_other_prices_are_cleared(self):
        _, rows = self.run_convert()
        h = rows[0]
        for r in rows[1:]:
            self.assertEqual(r[h.index('price')], '1')
            self.assertEqual(r[h.index('sale-price')], '')
            self.assertEqual(r[h.index('member-price')], '')

    def test_original_price_is_kept_by_default(self):
        _, rows = self.run_convert()
        h = rows[0]
        for before, after in zip(ROWS, rows[1:]):
            self.assertEqual(after[h.index('original-price')], before[HEADER.index('original-price')])

    def test_original_price_is_cleared_only_when_asked(self):
        convert.convert(self.src, self.dst, '2026112500', '2026113017', clear_original_price=True)
        _, rows = read_csv(self.dst)
        h = rows[0]
        for r in rows[1:]:
            self.assertEqual(r[h.index('original-price')], '')

    def test_sale_period_is_set(self):
        _, rows = self.run_convert()
        h = rows[0]
        for r in rows[1:]:
            self.assertEqual(r[h.index('sale-period-start')], '2026112500')
            self.assertEqual(r[h.index('sale-period-end')], '2026113017')

    def test_other_columns_are_unchanged(self):
        _, rows = self.run_convert()
        self.assertEqual(rows[0], HEADER)
        h = rows[0]
        for before, after in zip(ROWS, rows[1:]):
            for col in ('code', 'sub-code', 'original-price', 'postage-set'):
                self.assertEqual(after[h.index(col)], before[HEADER.index(col)])
        self.assertEqual(len(rows) - 1, len(ROWS))

    def test_output_is_shift_jis_with_crlf_and_no_added_quotes(self):
        raw, _ = self.run_convert()
        raw.decode('cp932')  # 読めなければ例外
        self.assertNotIn(b'\n', raw.replace(b'\r\n', b''))
        self.assertTrue(raw.endswith(b'\r\n'))
        self.assertNotIn(b'"', raw)

    def test_missing_column_is_refused(self):
        make_csv(self.src, header=HEADER[:-3] + ['postage-set'], rows=[r[:-3] + [r[-1]] for r in ROWS])
        with self.assertRaises(convert.ConvertError):
            self.run_convert()
        self.assertFalse(self.dst.exists())

    def test_bad_period_is_refused(self):
        for start, end in (('2026113017', '2026112500'), ('20261125', '2026113017'), ('2026113125', '2026113017')):
            with self.subTest(start=start, end=end):
                with self.assertRaises(convert.ConvertError):
                    self.run_convert(start=start, end=end)

    def test_duplicate_code_is_refused(self):
        make_csv(self.src, rows=[ROWS[0], ROWS[0]])
        with self.assertRaises(convert.ConvertError):
            self.run_convert()

    def test_input_file_is_not_modified(self):
        before = self.src.read_bytes()
        self.run_convert()
        self.assertEqual(self.src.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
