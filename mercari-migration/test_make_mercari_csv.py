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

    def test_sold_out_listings_are_dropped_when_asked(self):
        stock = 'code,sub-code,quantity\r\n' + ''.join(
            f'x,{s["sku_code"]},{0 if s["options"]["カラー"] == "グレー" else 1}\r\n' for s in SMALL['skus'] + BIG_SKUS)
        (self.d / 'stock.csv').write_bytes(stock.encode('cp932'))
        r = mk.build(**dict(self.args, drop_sold_out=True))
        names = [x['商品名'] for x in self.rows()[1]]
        self.assertNotIn('長袖 セーター（グレー）', names)
        self.assertEqual(r['listings'], 3)
        self.assertEqual(r['dropped'], ['bura00002「長袖 セーター（グレー）」'])
        self.assertEqual(mk.build(**self.args)['listings'], 4)  # 指定しなければ残す

    def _same_content(self, *names):
        for n in names:
            code = n.split('_')[0]
            (self.args['data_dir'] / 'images' / code / n).write_bytes(b'\xff\xd8\xffSAME')

    def _used(self):
        return [r[f'商品画像名_{i}'] for r in self.rows()[1] for i in range(1, 21) if r[f'商品画像名_{i}']]

    def test_images_like_the_given_ones_are_dropped_everywhere(self):
        self._same_content('bura00001_02.jpg', 'bura00002_05.jpg')
        mk.build(**dict(self.args, exclude_like=['bura00001_02.jpg']))
        used = self._used()
        self.assertNotIn('bura00001_02.jpg', used)
        self.assertNotIn('bura00002_05.jpg', used)
        self.assertEqual(self.rows()[1][0]['商品画像名_1'], 'bura00001_01.jpg')

    def test_images_shared_across_products_use_one_name(self):
        self._same_content('bura00001_01.jpg', 'bura00002_04.jpg')
        mk.build(**dict(self.args, dedupe_shared=True))
        used = self._used()
        self.assertNotIn('bura00002_04.jpg', used)
        self.assertIn('bura00001_01.jpg', self.rows()[1][1].values())   # bura00002 の出品も同じ名前を使う
        with zipfile.ZipFile(self.d / 'out' / 'メルカリShops_画像.zip') as z:
            self.assertNotIn('bura00002_04.jpg', z.namelist())

    def test_duplicates_inside_one_product_are_left_alone(self):
        self._same_content('bura00002_04.jpg', 'bura00002_05.jpg')
        mk.build(**dict(self.args, dedupe_shared=True))
        used = self._used()
        self.assertIn('bura00002_04.jpg', used)
        self.assertIn('bura00002_05.jpg', used)

    def test_extra_zip_has_only_images_not_uploaded_yet(self):
        r = mk.build(**dict(self.args, already_uploaded={'bura00001_01.jpg', 'bura00002_01.jpg'}))
        with zipfile.ZipFile(self.d / 'out' / 'メルカリShops_画像_追加分.zip') as z:
            names = set(z.namelist())
        self.assertEqual(names, set(self._used()) - {'bura00001_01.jpg', 'bura00002_01.jpg'})
        self.assertEqual(r['to_upload'], len(names))

    def test_skipped_products_are_left_out(self):
        r = mk.build(**dict(self.args, skip={'bura00002'}))
        self.assertEqual(r['listings'], 1)


class UploadedFromResultTest(unittest.TestCase):
    def test_names_in_columns_without_errors_count_as_uploaded(self):
        d = Path(tempfile.mkdtemp())
        head = ['処理結果', 'エラー理由', '商品画像名_1', '商品画像名_2', '商品画像名_3', '商品名']
        rows = [head,
                ['失敗', '商品画像名_2が存在しません', 'a_01.jpg', 'ban.jpg', 'a_03.jpg', 'A'],
                ['失敗', '商品画像名_1が存在しません\r\n商品画像名_3が存在しません', 'ban.jpg', 'b_02.jpg', 'x.png', 'B'],
                ['失敗', 'SKU1_種類は16文字以内で入力してください', 'c_01.jpg', '', '', 'C']]
        buf = io.StringIO(newline='')
        csv.writer(buf, lineterminator='\r\n').writerows(rows)
        (d / 'r.csv').write_bytes(buf.getvalue().encode('cp932'))
        self.assertEqual(mk.uploaded_from_result(d / 'r.csv'), {'a_01.jpg', 'a_03.jpg', 'b_02.jpg', 'c_01.jpg'})


class SkuLabelTest(unittest.TestCase):
    def test_short_labels_are_unchanged(self):
        self.assertEqual(mk.fit_labels(['ブラック / M', '杏地色ネイビーボーダー / XL']),
                         ['ブラック / M', '杏地色ネイビーボーダー / XL'])

    def test_spaces_are_removed_for_the_whole_listing(self):
        self.assertEqual(mk.fit_labels(['杏地色ネイビーボーダー / XXL', '杏地色ネイビーボーダー / XL']),
                         ['杏地色ネイビーボーダー/XXL', '杏地色ネイビーボーダー/XL'])

    def test_note_with_unchecked_characters_is_dropped_when_still_too_long(self):
        self.assertEqual(mk.fit_labels(['ブラック / フリーサイズ（S.M相当）', 'ブラック / XL']),
                         ['ブラック/フリーサイズ', 'ブラック/XL'])

    def test_still_too_long_is_refused(self):
        with self.assertRaises(mk.BuildError):
            mk.fit_labels(['とてもながいいろのなまえのからーです / M'])

    def test_bracket_note_is_dropped_only_as_last_step(self):
        self.assertEqual(mk.fit_labels(['ドットパターン（キューブ寄り） / M', 'ホワイト（ベージュ寄り） / M']),
                         ['ドットパターン/M', 'ホワイト/M'])

    def test_labels_that_would_become_the_same_are_refused(self):
        with self.assertRaises(mk.BuildError):
            mk.fit_labels(['ドットパターン（キューブ寄り） / M', 'ドットパターン（ストライプ寄り） / M'])


class SafeTextTest(unittest.TestCase):
    def test_known_characters_are_replaced(self):
        self.assertEqual(mk.cp932_safe('〜−‖'), '～－∥')

    def test_unencodable_characters_are_reported(self):
        with self.assertRaises(mk.BuildError):
            mk.check_cp932({'商品名': 'ok 😀'}, 'bura00001')


if __name__ == '__main__':
    unittest.main()
