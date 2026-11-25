"""Yahoo!ショッピングから写し取った商品情報・画像を、開いて確かめられる形にまとめる。

  出力（--out のフォルダ）:
    商品一覧.csv   1商品1行。商品名・キャッチコピー・商品説明・販売価格（Yahooのセール価格）・カラー・画像
    SKU一覧.csv    1SKU1行。SKUコード・カラー・サイズ・そのカラーに付いている画像
    商品画像.zip   商品コードごとのフォルダに画像（<商品コード>_01.jpg … 1枚目がメイン）
  CSV は Excel で文字化けしないよう BOM 付き UTF-8。

使い方:
  python3 export_copy.py [--data data] [--yahoo-csv 閉店セール前の商品CSV] [--out data/export]
"""
import argparse
import csv
import io
import json
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent


class ExportError(Exception):
    pass


def read_yahoo_prices(path):
    raw = Path(path).read_bytes()
    rows = list(csv.reader(io.StringIO(raw.decode('cp932'), newline='')))
    h = rows[0]
    for col in ('code', 'price', 'sale-price'):
        if col not in h:
            raise ExportError(f'Yahoo の商品CSVに {col} の列がありません')
    return {r[h.index('code')]: {'price': r[h.index('price')], 'sale_price': r[h.index('sale-price')]}
            for r in rows[1:] if r}


def write_csv(path, header, rows):
    buf = io.StringIO(newline='')
    w = csv.DictWriter(buf, fieldnames=header, lineterminator='\r\n')
    w.writeheader()
    w.writerows(rows)
    path.write_bytes(b'\xef\xbb\xbf' + buf.getvalue().encode('utf-8'))


def unique(seq):
    out = []
    for x in seq:
        if x not in out:
            out.append(x)
    return out


def export(data_dir, yahoo_csv, out_dir):
    data_dir, out_dir = Path(data_dir), Path(out_dir)
    items = json.loads((data_dir / 'items.json').read_text(encoding='utf-8'))
    prices = read_yahoo_prices(yahoo_csv)

    # 画像ファイルが実際にあるかを先に確かめる（無ければ何も書き出さない）
    for it in items:
        for f in it['image_files']:
            if not (data_dir / 'images' / it['code'] / f).is_file():
                raise ExportError(f'{it["code"]}: 画像ファイルがありません: {f}')

    out_dir.mkdir(parents=True, exist_ok=True)
    product_rows, sku_rows = [], []
    for it in items:
        p = prices.get(it['code'], {})
        colors = unique(s['options'].get('カラー', '') for s in it['skus'])
        sizes = unique(s['options'].get('サイズ', '') for s in it['skus'])
        product_rows.append({
            '商品コード': it['code'],
            '商品名': it['name'],
            'キャッチコピー': it.get('catch_copy', ''),
            '販売価格（Yahooのセール価格）': p.get('sale_price', ''),
            '通常価格（参考）': p.get('price', ''),
            'カラー': ' / '.join(c for c in colors if c),
            'サイズ': ' / '.join(s for s in sizes if s),
            'SKU数': str(len(it['skus'])),
            '画像の枚数': str(len(it['image_files'])),
            '画像ファイル': ' / '.join(it['image_files']),
            'Yahooのカテゴリ': ' > '.join(it.get('category_path') or []),
            '商品説明': it['description'],
        })
        for s in it['skus']:
            color = s['options'].get('カラー', '')
            color_images = [im['file'] for im in it['images'] if im.get('file') and color and im.get('color') == color]
            sku_rows.append({
                '商品コード': it['code'],
                '商品名': it['name'],
                'SKUコード': s['sku_code'],
                'カラー': color,
                'サイズ': s['options'].get('サイズ', ''),
                '販売価格（Yahooのセール価格）': p.get('sale_price', ''),
                'このカラーの画像': ' / '.join(color_images),
            })

    write_csv(out_dir / '商品一覧.csv', list(product_rows[0].keys()) if product_rows else [], product_rows)
    write_csv(out_dir / 'SKU一覧.csv', list(sku_rows[0].keys()) if sku_rows else [], sku_rows)
    with zipfile.ZipFile(out_dir / '商品画像.zip', 'w', compression=zipfile.ZIP_STORED) as z:
        for it in items:
            for f in it['image_files']:
                z.write(data_dir / 'images' / it['code'] / f, arcname=f'{it["code"]}/{f}')

    copied = {it['code'] for it in items}
    return {
        'products': len(items),
        'skus': len(sku_rows),
        'images': sum(len(it['image_files']) for it in items),
        'missing': sorted(c for c in prices if c not in copied),
        'missing_images': [(it['code'], i + 1) for it in items for i, im in enumerate(it['images']) if not im.get('file')],
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description='写し取った商品情報・画像を、開いて確かめられる形にまとめる')
    ap.add_argument('--data', default=str(HERE / 'data'))
    ap.add_argument('--yahoo-csv', default=str(HERE.parent / 'closing-sale' / 'csv' / 'data' / 'data202611250949_original.csv'))
    ap.add_argument('--out', default=str(HERE / 'data' / 'export'))
    a = ap.parse_args(argv)
    try:
        r = export(a.data, a.yahoo_csv, a.out)
    except ExportError as e:
        print(f'NG  {e}'); return 1
    print(f'OK  商品 {r["products"]} / SKU {r["skus"]} / 画像 {r["images"]} → {a.out}')
    if r['missing']:
        print(f'    写し取れていない商品: {r["missing"]}')
    if r['missing_images']:
        print(f'    取れなかった画像: {r["missing_images"]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
