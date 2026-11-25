"""作った商品登録CSVの中身を、メルカリShops 公式テンプレート（Excel）の「テンプレート」シートに入れる。

メルカリの案内どおり「Excel で開く → 名前を付けて保存 → CSV（コンマ区切り）」で保存すれば、
その人のパソコンに合った形の CSV になる（文字コードの違いで失敗するのを避けるため）。

  python3 to_template_xlsx.py [--csv data/export/メルカリShops_商品登録.csv]
                              [--template data/template.xlsx] [--out data/export/メルカリShops_商品登録.xlsx]
"""
import argparse
import csv
import io
import sys
from pathlib import Path

import openpyxl

HERE = Path(__file__).resolve().parent


class XlsxError(Exception):
    pass


def fill(csv_path, template_path, out_path):
    raw = Path(csv_path).read_bytes()
    rows = list(csv.reader(io.StringIO(raw.decode('cp932'), newline='')))
    wb = openpyxl.load_workbook(template_path)
    ws = wb['テンプレート']
    header = [c.value for c in ws[1] if c.value is not None]
    if rows[0] != header:
        raise XlsxError('CSV の見出しがテンプレートと違います')
    if ws.max_row > 1:
        ws.delete_rows(2, ws.max_row - 1)   # 見本の行を消す
    for r in rows[1:]:
        ws.append([v if v != '' else None for v in r])
    for row in ws.iter_rows(min_row=2):
        for c in row:
            if c.value is not None:
                c.value = str(c.value)
                c.data_type = 's'          # 数字も文字のまま（先頭の0や形が変わらないように）
    wb.save(out_path)

    # 書いたものを読み直して、CSV と一字一句同じか確かめる
    back = openpyxl.load_workbook(out_path, read_only=True)['テンプレート']
    got = [[('' if v is None else str(v)) for v in r][:len(header)] for r in back.iter_rows(values_only=True)]
    got = [r + [''] * (len(header) - len(r)) for r in got]
    if got != rows:
        raise XlsxError('Excel に書いた内容が CSV と一致しません')
    return len(rows) - 1


def main(argv=None):
    ap = argparse.ArgumentParser(description='商品登録CSVを公式テンプレート（Excel）に入れる')
    ap.add_argument('--csv', default=str(HERE / 'data' / 'export' / 'メルカリShops_商品登録.csv'))
    ap.add_argument('--template', default=str(HERE / 'data' / 'template.xlsx'))
    ap.add_argument('--out', default=str(HERE / 'data' / 'export' / 'メルカリShops_商品登録.xlsx'))
    a = ap.parse_args(argv)
    try:
        n = fill(a.csv, a.template, a.out)
    except XlsxError as e:
        print(f'NG  {e}')
        return 1
    print(f'OK  {n}出品をテンプレートに入れました → {a.out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
