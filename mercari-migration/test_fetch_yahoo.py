"""fetch_yahoo.py のテスト（ネットにはつながない）。  実行:  python3 -m unittest mercari-migration/test_fetch_yahoo.py -v"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_yahoo as fy  # noqa: E402

ITEM = {
    'name': '長袖 ニット セーター',
    'catchCopy': 'しっとり プチハイネック',
    'information': '素材：綿95％<br>カラー：ミルクティー<br><br>※色落ち&amp;注意<br><a href="x">リンク</a>',
    'images': {'itemImageList': [
        {'id': 'comburabura_bura00014', 'type': 'Item', 'firstOptionChoiceName': None},
        {'id': 'comburabura_bura00014_1_d_20240925134033', 'type': 'Item', 'firstOptionChoiceName': None},
        {'id': 'magnet_171861152900.jpg', 'type': 'Lib', 'firstOptionChoiceName': 'グレー'},
    ]},
    'skuIdList': [
        {'bura00014-mi-s': [{'choiceName': 'ミルクティー'}, {'choiceName': 'S'}]},
        {'bura00014-mi-m': [{'choiceName': 'ミルクティー'}, {'choiceName': 'M'}]},
    ],
    'individualItemOptionList': [{'name': 'カラー'}, {'name': 'サイズ'}],
    'specList': [{'name': '色', 'valueList': [{'name': 'ベージュ系'}]}],
    'genreCategory': {'categoryPathsIgnoreShopping': [{'name': 'ファッション'}, {'name': 'トップス'}]},
    'originalPrice': '2970',
    'postageSet': '14',
}


def page_html(item):
    data = {'props': {'pageProps': {'item': item}}}
    return ('<html><head></head><body><script id="__NEXT_DATA__" type="application/json">'
            + json.dumps(data, ensure_ascii=False) + '</script></body></html>')


class ParseTest(unittest.TestCase):
    def test_parse_item_extracts_fields(self):
        r = fy.parse_item(page_html(ITEM), 'bura00014')
        self.assertEqual(r['code'], 'bura00014')
        self.assertEqual(r['name'], '長袖 ニット セーター')
        self.assertEqual(r['catch_copy'], 'しっとり プチハイネック')
        self.assertEqual(r['images'], [
            {'id': 'comburabura_bura00014', 'type': 'Item', 'color': None},
            {'id': 'comburabura_bura00014_1_d_20240925134033', 'type': 'Item', 'color': None},
            {'id': 'magnet_171861152900.jpg', 'type': 'Lib', 'color': 'グレー'},
        ])
        self.assertEqual(r['skus'], [
            {'sku_code': 'bura00014-mi-s', 'options': {'カラー': 'ミルクティー', 'サイズ': 'S'}},
            {'sku_code': 'bura00014-mi-m', 'options': {'カラー': 'ミルクティー', 'サイズ': 'M'}},
        ])
        self.assertEqual(r['category_path'], ['ファッション', 'トップス'])
        self.assertEqual(r['specs'], {'色': ['ベージュ系']})

    def test_description_html_becomes_plain_text(self):
        r = fy.parse_item(page_html(ITEM), 'bura00014')
        self.assertEqual(r['description'], '素材：綿95％\nカラー：ミルクティー\n\n※色落ち&注意\nリンク')
        self.assertEqual(r['description_html'], ITEM['information'])

    def test_page_without_data_is_refused(self):
        with self.assertRaises(fy.FetchError):
            fy.parse_item('<html><body>メンテナンス中</body></html>', 'bura00014')

    def test_image_file_names_keep_order(self):
        self.assertEqual(fy.image_file_name('bura00014', 0, 'jpg'), 'bura00014_01.jpg')
        self.assertEqual(fy.image_file_name('bura00014', 14, 'png'), 'bura00014_15.png')

    def test_image_url_uses_largest_variant(self):
        self.assertEqual(fy.image_url({'id': 'comburabura_bura00014_1_d_20240925134033', 'type': 'Item'}),
                         'https://item-shopping.c.yimg.jp/i/n/comburabura_bura00014_1_d_20240925134033')

    def test_lib_image_url_uses_store_library(self):
        self.assertEqual(fy.image_url({'id': 'magnet_171861152900.jpg', 'type': 'Lib'}, 'comburabura'),
                         'https://shopping.c.yimg.jp/lib/comburabura/magnet_171861152900.jpg')

    def test_strange_image_ids_are_refused(self):
        for bad in ({'id': '../x.jpg', 'type': 'Lib'}, {'id': 'a/b.jpg', 'type': 'Lib'},
                    {'id': 'x.jpg', 'type': 'Item'}, {'id': 'ok', 'type': 'Other'}):
            with self.subTest(bad=bad):
                with self.assertRaises(fy.FetchError):
                    fy.image_url(bad)

    def test_image_kind_by_content(self):
        self.assertEqual(fy.image_ext(b'\xff\xd8\xff\xe0rest'), 'jpg')
        self.assertEqual(fy.image_ext(b'\x89PNG\r\n\x1a\nrest'), 'png')
        self.assertEqual(fy.image_ext(b'GIF89a...'), 'gif')
        self.assertIsNone(fy.image_ext(b'<html>not image'))

    def test_read_codes_from_yahoo_csv(self):
        d = Path(tempfile.mkdtemp())
        f = d / 'items.csv'
        f.write_bytes('code,sub-code,price\r\nbura00014,x,1\r\nbura00056,y,1\r\n'.encode('cp932'))
        self.assertEqual(fy.read_codes(f), ['bura00014', 'bura00056'])

    def test_bad_code_is_refused(self):
        for bad in ('../etc', 'bura 01', '', 'a/b'):
            with self.subTest(bad=bad):
                with self.assertRaises(fy.FetchError):
                    fy.page_url(bad)


if __name__ == '__main__':
    unittest.main()
