"""export_copy.py のテスト。  実行:  python3 -m unittest mercari-migration/test_export_copy.py -v"""
import csv
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import export_copy as ex  # noqa: E402

ITEMS = [{
    'code': 'bura00014', 'name': '長袖 ニット', 'catch_copy': 'しっとり', 'description': '素材：綿\n洗濯：手洗い',
    'images': [{'id': 'a', 'type': 'Item', 'color': None, 'file': 'bura00014_01.jpg'},
               {'id': 'b', 'type': 'Lib', 'color': 'グレー', 'file': 'bura00014_02.png'},
               {'id': 'c', 'type': 'Item', 'color': None, 'file': None}],
    'image_files': ['bura00014_01.jpg', 'bura00014_02.png'],
    'skus': [{'sku_code': 'bura00014-gy-s', 'options': {'カラー': 'グレー', 'サイズ': 'S'}},
             {'sku_code': 'bura00014-bk-m', 'options': {'カラー': 'ブラック', 'サイズ': 'M'}}],
    'category_path': ['ファッション', 'トップス'],
}]
YAHOO_CSV = ('code,sub-code,original-price,price,sale-price,member-price,sale-period-start,sale-period-end,postage-set\r\n'
             'bura00014,x,2970,2580,1380,1080,2026110818,2026112217,14\r\n'
             'bura00050,y,3000,2000,1500,1400,2026110818,2026112217,14\r\n')


def read_utf8_csv(path):
    raw = path.read_bytes()
    assert raw.startswith(b'\xef\xbb\xbf'), 'Excel で文字化けしないよう BOM 付き UTF-8 にする'
    return list(csv.DictReader(io.StringIO(raw.decode('utf-8-sig'), newline='')))


class ExportTest(unittest.TestCase):
    def setUp(self):
        self.d = Path(tempfile.mkdtemp())
        (self.d / 'images' / 'bura00014').mkdir(parents=True)
        (self.d / 'images' / 'bura00014' / 'bura00014_01.jpg').write_bytes(b'\xff\xd8\xffJPEG')
        (self.d / 'images' / 'bura00014' / 'bura00014_02.png').write_bytes(b'\x89PNG\r\n\x1a\nPNG')
        (self.d / 'items.json').write_text(json.dumps(ITEMS, ensure_ascii=False), encoding='utf-8')
        self.ycsv = self.d / 'yahoo.csv'
        self.ycsv.write_bytes(YAHOO_CSV.encode('cp932'))
        self.out = self.d / 'export'
        self.result = ex.export(self.d, self.ycsv, self.out)

    def test_products_sheet_has_one_row_per_product_with_sale_price(self):
        rows = read_utf8_csv(self.out / '商品一覧.csv')
        self.assertEqual(len(rows), 1)
        r = rows[0]
        self.assertEqual(r['商品コード'], 'bura00014')
        self.assertEqual(r['販売価格（Yahooのセール価格）'], '1380')
        self.assertEqual(r['通常価格（参考）'], '2580')
        self.assertEqual(r['商品説明'], '素材：綿\n洗濯：手洗い')
        self.assertEqual(r['画像の枚数'], '2')
        self.assertEqual(r['画像ファイル'], 'bura00014_01.jpg / bura00014_02.png')
        self.assertEqual(r['カラー'], 'グレー / ブラック')

    def test_sku_sheet_has_one_row_per_sku(self):
        rows = read_utf8_csv(self.out / 'SKU一覧.csv')
        self.assertEqual([(r['SKUコード'], r['カラー'], r['サイズ']) for r in rows],
                         [('bura00014-gy-s', 'グレー', 'S'), ('bura00014-bk-m', 'ブラック', 'M')])
        self.assertEqual(rows[0]['このカラーの画像'], 'bura00014_02.png')
        self.assertEqual(rows[1]['このカラーの画像'], '')

    def test_images_are_zipped_by_product_folder(self):
        with zipfile.ZipFile(self.out / '商品画像.zip') as z:
            self.assertEqual(sorted(z.namelist()), ['bura00014/bura00014_01.jpg', 'bura00014/bura00014_02.png'])
            self.assertEqual(z.read('bura00014/bura00014_01.jpg'), b'\xff\xd8\xffJPEG')

    def test_products_missing_from_copy_are_reported(self):
        self.assertEqual(self.result['missing'], ['bura00050'])
        self.assertEqual(self.result['missing_images'], [('bura00014', 3)])

    def test_missing_image_file_on_disk_is_an_error(self):
        (self.d / 'images' / 'bura00014' / 'bura00014_02.png').unlink()
        with self.assertRaises(ex.ExportError):
            ex.export(self.d, self.ycsv, self.d / 'export2')


if __name__ == '__main__':
    unittest.main()
