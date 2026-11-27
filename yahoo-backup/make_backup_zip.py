"""Yahoo!ショッピングのデータ一式を、デスクトップの「ヤフーショッピングallデータ」に展開する zip にまとめる。

zip の中の名前は英数字だけにする（Windows の「すべて展開」で名前が文字化けしないように）。
説明は README.txt（日本語・UTF-8 BOM 付き・改行 CRLF、メモ帳で読める）に書く。
書いたあと zip を読み直し、元のファイルと1バイトずつ同じか確かめる。

  python3 -I make_backup_zip.py --data <取り直したデータ> --catalog <offline_catalog.py build の出力>
                                --stock <在庫CSV（英数字の名前）> --readme <README.txt> --out <出力zip>
"""
import argparse
import json
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
MM = REPO / 'mercari-migration'
CS = REPO / 'closing-sale'
sys.path.insert(0, str(MM))
import export_copy as ex  # noqa: E402

IMAGE_EXT = ('.jpg', '.jpeg', '.png', '.gif', '.webp')


class ZipError(Exception):
    pass


def plan_files(data_dir, catalog_dir, stock_csv, tmp):
    data_dir, catalog_dir = Path(data_dir), Path(catalog_dir)
    items = json.loads((data_dir / 'items.json').read_text(encoding='utf-8'))
    plan = [('index.html', catalog_dir / 'index.html')]
    for p in sorted((catalog_dir / '00_catalog').rglob('*')):
        if p.is_file():
            plan.append((p.relative_to(catalog_dir).as_posix(), p))
    plan += [('01_products/products_list.csv', tmp / '商品一覧.csv'),
             ('01_products/sku_list.csv', tmp / 'SKU一覧.csv'),
             (f'01_products/{Path(stock_csv).name}', Path(stock_csv)),
             ('01_products/items_raw.json', data_dir / 'items.json')]
    for old in sorted(MM.glob('data/在庫_2026*.csv')):
        plan.append((f'01_products/stock_{old.stem.split("_", 1)[1]}.csv', old))
    for it in items:
        for f in it['image_files']:
            plan.append((f'02_images/{it["code"]}/{f}', data_dir / 'images' / it['code'] / f))
    plan += [('03_yahoo_csv/data202611250949_original.csv', CS / 'csv' / 'data' / 'data202611250949_original.csv'),
             ('03_yahoo_csv/closing-sale_upload_1yen.csv', CS / 'csv' / 'data' / 'closing-sale_upload_1yen.csv'),
             ('04_toppage_code/toppage_original.html', CS / 'toppage' / 'original.html'),
             ('04_toppage_code/toppage_closing_sale.html', CS / 'toppage' / 'toppage.html'),
             ('05_shipping_text/shipping_original.txt', CS / 'shipping-text' / 'original.txt'),
             ('05_shipping_text/shipping_closing_sale.txt', CS / 'shipping-text' / 'sale.txt'),
             ('07_sns_posts/posts_line_threads.txt', CS / 'posts.md')]
    for p in sorted((CS / 'out').glob('*.png')):
        plan.append((f'06_banners/{p.name}', p))
    for p in sorted((data_dir / 'pages').glob('*.html')):
        plan.append((f'99_original_html_need_internet/{p.name}', p))
    return plan


def check_plan(plan):
    names = [n for n, _ in plan]
    if len(set(names)) != len(names):
        raise ZipError('zip の中で名前が重なっています')
    for n, src in plan:
        if not n.isascii():
            raise ZipError(f'英数字以外の名前があります: {n}')
        if not Path(src).is_file():
            raise ZipError(f'ファイルがありません: {src}')


def write_zip(out_zip, plan, readme_text):
    with zipfile.ZipFile(out_zip, 'w') as z:
        z.writestr('README.txt', '﻿' + readme_text.replace('\r\n', '\n').replace('\n', '\r\n'),
                   compress_type=zipfile.ZIP_DEFLATED)
        for n, src in plan:
            kind = zipfile.ZIP_STORED if Path(src).suffix.lower() in IMAGE_EXT else zipfile.ZIP_DEFLATED
            z.write(src, arcname=n, compress_type=kind)
    with zipfile.ZipFile(out_zip) as z:      # 読み直して確かめる
        if z.testzip() is not None:
            raise ZipError('zip が壊れています')
        for n, src in plan:
            if z.read(n) != Path(src).read_bytes():
                raise ZipError(f'中身が違います: {n}')
        return len(z.namelist())


def main(argv=None):
    ap = argparse.ArgumentParser(description='Yahoo のデータ一式を zip にまとめる')
    ap.add_argument('--data', required=True)
    ap.add_argument('--catalog', required=True)
    ap.add_argument('--stock', required=True)
    ap.add_argument('--readme', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args(argv)
    out = Path(a.out)
    tmp = out.parent / '_export_tmp'
    try:
        r = ex.export(a.data, CS / 'csv' / 'data' / 'data202611250949_original.csv', tmp)
        plan = plan_files(a.data, a.catalog, a.stock, tmp)
        check_plan(plan)
        count = write_zip(out, plan, Path(a.readme).read_text(encoding='utf-8'))
    except (ZipError, ex.ExportError) as e:
        print(f'NG  {e}')
        return 1
    finally:
        if tmp.is_dir():
            for f in tmp.iterdir():
                f.unlink()
            tmp.rmdir()
    print(f'OK  商品 {r["products"]} / SKU {r["skus"]} / zip の中のファイル {count} → {out}')
    print(f'    商品CSVにあってページが無かった商品: {r["missing"]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
