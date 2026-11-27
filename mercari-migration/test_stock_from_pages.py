"""stock_from_pages.py のテスト。  実行:  python3 -m unittest mercari-migration/test_stock_from_pages.py -v"""
import csv
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stock_from_pages as sp  # noqa: E402


def page(individuals, stock=None):
    item = {'name': 'x', 'individualItemList': individuals, 'stock': stock or {'quantity': None}}
    return ('<script id="__NEXT_DATA__" type="application/json">'
            + json.dumps({'props': {'pageProps': {'item': item}}}, ensure_ascii=False) + '</script>')


class ParseTest(unittest.TestCase):
    def test_quantities_per_sku(self):
        html = page([{'skuId': 'a-bk-s', 'stock': {'quantity': 2, 'isAvailable': True}},
                     {'skuId': 'a-bk-m', 'stock': {'quantity': 0, 'isAvailable': False}}])
        self.assertEqual(sp.parse_stock(html, 'a'), {'a-bk-s': 2, 'a-bk-m': 0})

    def test_missing_quantity_is_refused(self):
        html = page([{'skuId': 'a-bk-s', 'stock': {'quantity': None, 'isAvailable': True}}])
        with self.assertRaises(sp.StockError):
            sp.parse_stock(html, 'a')

    def test_page_without_sku_list_is_refused(self):
        with self.assertRaises(sp.StockError):
            sp.parse_stock(page([]), 'a')

    def test_write_stock_csv_in_yahoo_like_format(self):
        d = Path(tempfile.mkdtemp())
        sp.write_stock_csv(d / 's.csv', {'a': {'a-bk-s': 2, 'a-bk-m': 0}})
        rows = list(csv.DictReader(io.StringIO((d / 's.csv').read_bytes().decode('utf-8-sig'), newline='')))
        self.assertEqual([(r['code'], r['sub-code'], r['quantity']) for r in rows], [('a', 'a-bk-s', '2'), ('a', 'a-bk-m', '0')])


if __name__ == '__main__':
    unittest.main()
