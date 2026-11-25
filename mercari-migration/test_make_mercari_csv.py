"""make_mercari_csv.py のテスト。  実行:  python3 -m unittest mercari-migration/test_make_mercari_csv.py -v"""
import csv
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_mercari_csv as mk  # noqa: E402

HEADER = ([f'商品画像名_{i}' for i in range(1, 21)] + ['商品名', '商品説明']
          + [f'SKU{n}_{k}' for n in range(1, 11) for k in ('種類', '在庫数', '商品管理コード', 'JANコード', 'catalog_id')]
          + ['ブランドID', '販売価格', 'カテゴリID', '商品の状態', '配送方法', '発送元の地域', '発送までの日数', '商品ステータス',
             '配送料の負担', '送料ID', 'メルカリBiz配送_クール区分', '発売日', '予約受付開始日', '予約受付終了日', 'キャンセル期限', 'お届け予定'])
CHOICES = {'商品の状態': ['1:新品、未使用'], '配送方法': ['1:未定(出品者が手配)'], '発送元の地域': ['jp16:富山県'],
           '発送までの日数': ['2:2〜3日で発送'], '商品ステータス': ['1:非公開', '2:公開'], '配送料の負担': ['1:送料込み（出品者負担）', '2:送料別（購入者負担）']}
CAT_ID = 'ID_KNIT_LONG'


def make_template(path):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'テンプレート'
    ws.append(HEADER)
    ch = wb.create_sheet('選択肢')
    col = 1
    for head, vals in CHOICES.items():
        ch.cell(1, col, head)
        for i, v in enumerate(vals, 2):
            ch.cell(i, col, v)
        col += 3
    cm = wb.create_sheet('カテゴリーマスタ')
    cm.append(['カテゴリID', 'カテゴリ名', 'カテゴリ名（フル）'])
    cm.append([CAT_ID, '長袖', 'ファッション > レディース > トップス > ニット・セーター > 長袖'])
    wb.save(path)


def sku(code, color, size):
    return {'sku_code': code, 'options': {'カラー': color, 'サイズ': size}}


def img(n, color=None, code='bura00001'):
    return {'id': f'i{n}', 'type': 'Item', 'color': color, 'file': f'{code}_{n:02d}.jpg'}


SMALL = {'code': 'bura00001', 'name': '長袖 ニット', 'catch_copy': '', 'description': '素材：綿\n手洗い〜OK',
         'images': [img(1), img(2)], 'image_files': ['bura00001_01.jpg', 'bura00001_02.jpg'],
         'skus': [sku('b1-bk-m', 'ブラック', 'M'), sku('b1-bk-l', 'ブラック', 'L'), sku('b1-w-m', 'ホワイト', 'M')],
         'category_path': ['ファッション', 'レディースファッション', 'トップス', 'ニット、セーター'], 'specs': {}, 'postage_set': '14'}
BIG_SKUS = [sku(f'b2-{c}-{s}', c, s) for c in ('ブラック', 'ホワイト', 'グレー') for s in ('S', 'M', 'L', 'XL')]
BIG = {'code': 'bura00002', 'name': '長袖 セーター', 'catch_copy': '', 'description': '説明',
       'images': [img(1, code='bura00002'), img(2, 'ホワイト', 'bura00002'), img(3, 'ブラック', 'bura00002')]
       + [img(n, code='bura00002') for n in range(4, 26)],
       'skus': BIG_SKUS, 'category_path': ['ファッション', 'レディースファッション', 'トップス', 'ニット、セーター'],
       'specs': {}, 'postage_set': '3'}
BIG['image_files'] = [i['file'] for i in BIG['images']]
YAHOO = ('code,sub-code,original-price,price,sale-price,member-price,sale-period-start,sale-period-end,postage-set\r\n'
         'bura00001,x,2970,2580,1380,1080,2026110818,2026112217,14\r\n'
         'bura00002,y,5000,3980,2980,2880,2026110818,2026112217,3\r\n')


class MakeTest(unittest.TestCase):
    def setUp(self):
        self.d = Path(tempfile.mkdtemp())
        make_template(self.d / 't.xlsx')
        data = self.d / 'data'
        for it in (SMALL, BIG):
            (data / 'images' / it['code']).mkdir(parents=True)
            for f in it['image_files']:
                (data / 'images' / it['code'] / f).write_bytes(b'\xff\xd8\xff' + f.encode())
        (data / 'items.json').write_text(json.dumps([SMALL, BIG], ensure_ascii=False), encoding='utf-8')
        (self.d / 'yahoo.csv').write_bytes(YAHOO.encode('cp932'))
        with open(self.d / 'cat.csv', 'w', encoding='utf-8-sig', newline='') as f:
            w = csv.writer(f)
            w.writerow(['商品コード', 'メルカリのカテゴリ', 'カテゴリID', '要確認', '根拠'])
            w.writerow(['bura00001', 'トップス > ニット・セーター > 長袖', CAT_ID, '', ''])
            w.writerow(['bura00002', 'トップス > ニット・セーター > 長袖', CAT_ID, '', ''])
        stock = 'code,sub-code,quantity\r\n' + ''.join(f'x,{s["sku_code"]},{i % 3}\r\n' for i, s in enumerate(SMALL['skus'] + BIG_SKUS))
        (self.d / 'stock.csv').write_bytes(stock.encode('cp932'))
        self.args = dict(data_dir=data, yahoo_csv=self.d / 'yahoo.csv', template=self.d / 't.xlsx',
                         category_map=self.d / 'cat.csv', shipping={'14': 'fee_neko', '3': 'fee_60'},
                         stock_csv=self.d / 'stock.csv', out_dir=self.d / 'out')

    def rows(self, name='メルカリShops_商品登録.csv'):
        raw = (self.d / 'out' / name).read_bytes()
        return raw, list(csv.DictReader(io.StringIO(raw.decode('cp932'), newline='')))

    def test_header_matches_template_and_file_is_shift_jis(self):
        mk.build(**self.args)
        raw, rows = self.rows()
        self.assertEqual(next(csv.reader(io.StringIO(raw.decode('cp932')))), HEADER)
        self.assertTrue(raw.endswith(b'\r\n'))

    def test_small_product_is_one_listing_with_color_and_size(self):
        mk.build(**self.args)
        r = self.rows()[1][0]
        self.assertEqual(r['商品名'], '長袖 ニット')
        self.assertEqual([r[f'SKU{i}_種類'] for i in (1, 2, 3)], ['ブラック / M', 'ブラック / L', 'ホワイト / M'])
        self.assertEqual([r[f'SKU{i}_商品管理コード'] for i in (1, 2, 3)], ['b1-bk-m', 'b1-bk-l', 'b1-w-m'])
        self.assertEqual([r[f'SKU{i}_在庫数'] for i in (1, 2, 3)], ['0', '1', '2'])
        self.assertEqual(r['販売価格'], '1380')
        self.assertEqual((r['商品画像名_1'], r['商品画像名_2'], r['商品画像名_3']), ('bura00001_01.jpg', 'bura00001_02.jpg', ''))

    def test_fixed_values(self):
        mk.build(**self.args)
        r = self.rows()[1][0]
        self.assertEqual((r['カテゴリID'], r['商品の状態'], r['配送方法'], r['発送元の地域'], r['発送までの日数'],
                          r['商品ステータス'], r['配送料の負担'], r['送料ID']),
                         (CAT_ID, '1', '1', 'jp16', '2', '1', '2', 'fee_neko'))

    def test_description_is_made_shift_jis_safe(self):
        mk.build(**self.args)
        self.assertEqual(self.rows()[1][0]['商品説明'], '素材：綿\n手洗い～OK')

    def test_product_with_more_than_10_skus_is_split_by_color(self):
        mk.build(**self.args)
        rows = self.rows()[1][1:]
        self.assertEqual([r['商品名'] for r in rows], ['長袖 セーター（ブラック）', '長袖 セーター（ホワイト）', '長袖 セーター（グレー）'])
        self.assertEqual([rows[0][f'SKU{i}_種類'] for i in range(1, 5)], ['S', 'M', 'L', 'XL'])
        self.assertEqual(rows[0]['SKU5_種類'], '')
        self.assertEqual(rows[0]['送料ID'], 'fee_60')

    def test_split_listing_puts_its_color_images_first_and_skips_other_colors(self):
        mk.build(**self.args)
        black = self.rows()[1][1]
        names = [black[f'商品画像名_{i}'] for i in range(1, 21)]
        self.assertEqual(names[:3], ['bura00002_03.jpg', 'bura00002_01.jpg', 'bura00002_04.jpg'])
        self.assertNotIn('bura00002_02.jpg', names)
        self.assertEqual(len([n for n in names if n]), 20)

    def test_images_zip_has_exactly_the_referenced_files_flat(self):
        mk.build(**self.args)
        _, rows = self.rows()
        used = {r[f'商品画像名_{i}'] for r in rows for i in range(1, 21)} - {''}
        with zipfile.ZipFile(self.d / 'out' / 'メルカリShops_画像.zip') as z:
            self.assertEqual(set(z.namelist()), used)

    def test_missing_stock_or_shipping_is_refused_unless_preview(self):
        a = dict(self.args, stock_csv=None)
        with self.assertRaises(mk.BuildError):
            mk.build(**a)
        a = dict(self.args, shipping={'14': 'fee_neko'})
        with self.assertRaises(mk.BuildError):
            mk.build(**a)
        r = mk.build(**dict(self.args, stock_csv=None, shipping={}, preview=True))
        self.assertTrue(r['csv'].name.startswith('確認用'))
        self.assertFalse((self.d / 'out' / 'メルカリShops_商品登録.csv').exists())

    def test_unknown_category_id_is_refused(self):
        with open(self.d / 'cat.csv', 'a', encoding='utf-8', newline='') as f:
            f.write('bura00002,x,NOPE,,\r\n')
        with self.assertRaises(mk.BuildError):
            mk.build(**self.args)

    def test_skipped_products_are_left_out(self):
        r = mk.build(**dict(self.args, skip={'bura00002'}))
        self.assertEqual(r['listings'], 1)


class SafeTextTest(unittest.TestCase):
    def test_known_characters_are_replaced(self):
        self.assertEqual(mk.cp932_safe('〜−‖'), '～－∥')

    def test_unencodable_characters_are_reported(self):
        with self.assertRaises(mk.BuildError):
            mk.check_cp932({'商品名': 'ok 😀'}, 'bura00001')


if __name__ == '__main__':
    unittest.main()
