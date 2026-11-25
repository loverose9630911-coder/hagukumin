"""to_template_xlsx.py のテスト。  実行:  python3 -m unittest mercari-migration/test_to_template_xlsx.py -v"""
import csv
import io
import sys
import tempfile
import unittest
from pathlib import Path

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent))
import to_template_xlsx as tx  # noqa: E402

HEADER = ['商品画像名_1', '商品名', '商品説明', 'SKU1_種類', '販売価格', '発送元の地域']


def make_template(path):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'テンプレート'
    ws.append(HEADER)
    ws.append(['sample_image.png', 'サンプル商品1', 'サンプル商品説明1', 'SKU名', '300', 'jp13'])
    ws.append(['sample_image_1.jpeg', 'サンプル商品2', 'サンプル商品説明2', 'SKU名_1', '99999', 'jp27'])
    wb.create_sheet('選択肢').append(['商品の状態'])
    wb.save(path)


class XlsxTest(unittest.TestCase):
    def setUp(self):
        self.d = Path(tempfile.mkdtemp())
        make_template(self.d / 't.xlsx')
        rows = [HEADER,
                ['a_01.jpg', '長袖 ニット', '素材：綿\n手洗い', 'ブラック / M', '1380', 'jp16'],
                ['b_01.jpg', 'スカート', '説明', 'F', '2980', 'jp16']]
        buf = io.StringIO(newline='')
        csv.writer(buf, lineterminator='\r\n').writerows(rows)
        (self.d / 'in.csv').write_bytes(buf.getvalue().encode('cp932'))
        self.rows = rows

    def test_rows_are_written_in_place_of_the_samples(self):
        tx.fill(self.d / 'in.csv', self.d / 't.xlsx', self.d / 'out.xlsx')
        ws = openpyxl.load_workbook(self.d / 'out.xlsx')['テンプレート']
        got = [[c if c is not None else '' for c in r] for r in ws.iter_rows(values_only=True)]
        self.assertEqual(got, self.rows)

    def test_values_stay_text(self):
        tx.fill(self.d / 'in.csv', self.d / 't.xlsx', self.d / 'out.xlsx')
        ws = openpyxl.load_workbook(self.d / 'out.xlsx')['テンプレート']
        self.assertEqual(ws['E2'].value, '1380')
        self.assertEqual(ws['E2'].data_type, 's')

    def test_other_sheets_are_kept(self):
        tx.fill(self.d / 'in.csv', self.d / 't.xlsx', self.d / 'out.xlsx')
        self.assertEqual(openpyxl.load_workbook(self.d / 'out.xlsx').sheetnames, ['テンプレート', '選択肢'])

    def test_header_mismatch_is_refused(self):
        (self.d / 'in.csv').write_bytes('商品名,商品説明\r\nx,y\r\n'.encode('cp932'))
        with self.assertRaises(tx.XlsxError):
            tx.fill(self.d / 'in.csv', self.d / 't.xlsx', self.d / 'out.xlsx')


if __name__ == '__main__':
    unittest.main()
