"""Yahoo!ショッピングの自分のストアの商品ページから、今の在庫数（SKUごと）を読み取る。

  python3 stock_from_pages.py [--data data] [--out data/在庫_<日時>.csv] [--wait 0.5]
  → code, sub-code, quantity の列のCSV（make_mercari_csv.py の --stock にそのまま渡せる）

商品の一覧は data/items.json（写し取った商品）を使う。ページは data/pages_stock/<日時>/ に保存する。
"""
import argparse
import csv
import io
import json
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fetch_yahoo as fy  # noqa: E402


class StockError(Exception):
    pass


def parse_stock(page, code):
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', page, re.S)
    if not m:
        raise StockError(f'{code}: ページに商品データがありません')
    item = json.loads(m.group(1))['props']['pageProps']['item']
    out = {}
    for ind in item.get('individualItemList') or []:
        q = (ind.get('stock') or {}).get('quantity')
        if not isinstance(q, int):
            raise StockError(f'{code}: SKU {ind.get("skuId")} の在庫数がページにありません')
        out[ind['skuId']] = q
    if not out:
        raise StockError(f'{code}: SKU の一覧がページにありません')
    return out


def write_stock_csv(path, stock):
    buf = io.StringIO(newline='')
    w = csv.writer(buf, lineterminator='\r\n')
    w.writerow(['code', 'sub-code', 'quantity'])
    for code, skus in stock.items():
        for sku, q in skus.items():
            w.writerow([code, sku, q])
    Path(path).write_bytes(b'\xef\xbb\xbf' + buf.getvalue().encode('utf-8'))


def main(argv=None):
    now = datetime.now(timezone(timedelta(hours=9)))
    ap = argparse.ArgumentParser(description='商品ページから今の在庫数を読み取る')
    ap.add_argument('--data', default=str(HERE / 'data'))
    ap.add_argument('--store', default=fy.STORE)
    ap.add_argument('--out', default=None)
    ap.add_argument('--wait', type=float, default=0.5)
    a = ap.parse_args(argv)
    data = Path(a.data)
    stamp = now.strftime('%Y%m%d_%H%M')
    pages = data / 'pages_stock' / stamp
    pages.mkdir(parents=True, exist_ok=True)
    out = Path(a.out) if a.out else data / f'在庫_{stamp}.csv'
    items = json.loads((data / 'items.json').read_text(encoding='utf-8'))

    stock, problems = {}, []
    for it in items:
        code = it['code']
        try:
            status, _, body = fy.get(fy.page_url(code, a.store), wait=a.wait)
            time.sleep(a.wait)
            if status != 200:
                raise StockError(f'{code}: 商品ページが開けません（{status}）')
            (pages / f'{code}.html').write_bytes(body)
            s = parse_stock(body.decode('utf-8', errors='replace'), code)
            expected = {x['sku_code'] for x in it['skus']}
            if set(s) != expected:
                raise StockError(f'{code}: ページの SKU が写し取ったときと違います（増えた {sorted(set(s) - expected)} / 消えた {sorted(expected - set(s))}）')
            stock[code] = s
        except (StockError, fy.FetchError) as e:
            problems.append(str(e))
    write_stock_csv(out, stock)
    total = sum(q for s in stock.values() for q in s.values())
    zero = sum(1 for s in stock.values() for q in s.values() if q == 0)
    print(f'{now:%Y/%m/%d %H:%M} 時点  商品 {len(stock)}/{len(items)}  SKU {sum(len(s) for s in stock.values())}  '
          f'在庫の合計 {total}  在庫0のSKU {zero}  → {out}')
    if problems:
        print('うまくいかなかったもの:')
        for p in problems:
            print('  -', p)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
