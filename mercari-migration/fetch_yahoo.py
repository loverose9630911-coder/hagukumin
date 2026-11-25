"""Yahoo!ショッピングの自分のストアから、商品情報と商品画像を写し取る（メルカリShops への移行用）。

  - 商品ページ https://store.shopping.yahoo.co.jp/<ストア>/<商品コード>.html を1つずつ読み、
    ページ内の商品データ（__NEXT_DATA__）から 商品名・キャッチコピー・商品説明・SKU（カラー/サイズ）・
    画像の一覧・カテゴリ・スペック を取り出して data/items.json に保存する。
  - 商品画像は公開されている中でいちばん大きい版（/i/n/、700×700）を data/images/<商品コード>/ に
    <商品コード>_01.jpg, _02.jpg … の順で保存する（1枚目がメイン画像）。
  - 相手のサーバーに負担をかけないよう、1回ごとに待ち時間を入れる。途中で止まっても、
    保存済みのページ・画像は読み直さずに続きから再開できる。

使い方:
  python3 fetch_yahoo.py 商品CSV.csv [--store comburabura] [--out data] [--wait 0.5]
  （商品CSV は ストアクリエイターPro からダウンロードしたもの。code 列の商品コードを使う）
"""
import argparse
import csv
import html as html_lib
import io
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

STORE = 'comburabura'
PAGE_URL = 'https://store.shopping.yahoo.co.jp/{store}/{code}.html'
IMAGE_URL = 'https://item-shopping.c.yimg.jp/i/n/{image_id}'
USER_AGENT = 'Mozilla/5.0 (store owner data export)'
CODE_RE = re.compile(r'^[A-Za-z0-9_\-]+$')


class FetchError(Exception):
    pass


def page_url(code, store=STORE):
    if not code or not CODE_RE.match(code):
        raise FetchError(f'商品コードの形が想定外です: {code!r}')
    return PAGE_URL.format(store=store, code=code)


def image_url(image_id):
    if not CODE_RE.match(image_id):
        raise FetchError(f'画像IDの形が想定外です: {image_id!r}')
    return IMAGE_URL.format(image_id=image_id)


def image_file_name(code, index):
    return f'{code}_{index + 1:02d}.jpg'


def html_to_text(s):
    s = re.sub(r'(?i)<br\s*/?>', '\n', s or '')
    s = re.sub(r'(?i)</p>|</div>|</li>', '\n', s)
    s = re.sub(r'<[^>]+>', '', s)
    s = html_lib.unescape(s)
    s = re.sub(r'[ \t　]+\n', '\n', s)
    return s.strip()


def parse_item(page, code):
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', page, re.S)
    if not m:
        raise FetchError(f'{code}: ページに商品データがありません（非公開・メンテナンス中などの可能性）')
    try:
        item = json.loads(m.group(1))['props']['pageProps']['item']
    except (ValueError, KeyError, TypeError) as e:
        raise FetchError(f'{code}: 商品データを読めません: {e}') from None
    if not item or not item.get('name'):
        raise FetchError(f'{code}: 商品名がありません')

    axes = [o.get('name') for o in (item.get('individualItemOptionList') or [])]
    skus = []
    for entry in item.get('skuIdList') or []:
        for sku_code, choices in entry.items():
            options = {axes[i] if i < len(axes) else f'選択肢{i + 1}': c.get('choiceName')
                       for i, c in enumerate(choices)}
            skus.append({'sku_code': sku_code, 'options': options})

    images = (item.get('images') or {}).get('itemImageList') or []
    return {
        'code': code,
        'name': item.get('name', ''),
        'catch_copy': item.get('catchCopy') or '',
        'description': html_to_text(item.get('information') or ''),
        'description_html': item.get('information') or '',
        'image_ids': [i['id'] for i in images if i.get('id')],
        'skus': skus,
        'option_names': axes,
        'category_path': [c.get('name') for c in
                          ((item.get('genreCategory') or {}).get('categoryPathsIgnoreShopping') or [])],
        'specs': {s.get('name'): [v.get('name') for v in (s.get('valueList') or [])]
                  for s in (item.get('specList') or [])},
        'original_price_on_page': item.get('originalPrice'),
        'postage_set': item.get('postageSet'),
    }


def read_codes(csv_path):
    raw = Path(csv_path).read_bytes()
    try:
        text = raw.decode('cp932')
    except UnicodeDecodeError:
        text = raw.decode('utf-8-sig')
    rows = list(csv.reader(io.StringIO(text, newline='')))
    if not rows or 'code' not in rows[0]:
        raise FetchError('CSV に code の列がありません')
    i = rows[0].index('code')
    codes = [r[i] for r in rows[1:] if len(r) > i and r[i]]
    if len(set(codes)) != len(codes):
        raise FetchError('CSV の code に重複があります')
    return codes


def get(url, tries=3, wait=0.5):
    last = None
    for n in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.status, r.headers.get('Content-Type', ''), r.read()
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                return e.code, '', b''
            last = e
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = e
        time.sleep(wait * (2 ** (n + 1)))
    raise FetchError(f'取得できません: {url}（{last}）')


def is_jpeg(b):
    return b[:3] == b'\xff\xd8\xff'


def main(argv=None):
    ap = argparse.ArgumentParser(description='Yahoo!ショッピングの自分のストアから商品情報と画像を写し取る')
    ap.add_argument('csv', help='ストアクリエイターPro の商品CSV（code 列）')
    ap.add_argument('--store', default=STORE)
    ap.add_argument('--out', default=str(Path(__file__).resolve().parent / 'data'))
    ap.add_argument('--wait', type=float, default=0.5, help='1回ごとの待ち時間（秒）')
    a = ap.parse_args(argv)

    out = Path(a.out)
    (out / 'pages').mkdir(parents=True, exist_ok=True)
    (out / 'images').mkdir(parents=True, exist_ok=True)
    codes = read_codes(a.csv)
    items, problems = [], []

    for n, code in enumerate(codes, 1):
        page_file = out / 'pages' / f'{code}.html'
        if not page_file.exists():
            status, _, body = get(page_url(code, a.store), wait=a.wait)
            time.sleep(a.wait)
            if status != 200:
                problems.append(f'{code}: 商品ページが開けません（{status}）')
                continue
            page_file.write_bytes(body)
        try:
            item = parse_item(page_file.read_text(encoding='utf-8', errors='replace'), code)
        except FetchError as e:
            problems.append(str(e))
            continue

        img_dir = out / 'images' / code
        img_dir.mkdir(exist_ok=True)
        files = []
        for i, image_id in enumerate(item['image_ids']):
            f = img_dir / image_file_name(code, i)
            if not (f.exists() and is_jpeg(f.read_bytes())):
                status, ctype, body = get(image_url(image_id), wait=a.wait)
                time.sleep(a.wait)
                if status != 200 or not is_jpeg(body):
                    problems.append(f'{code}: 画像 {i + 1}枚目（{image_id}）を取得できません（{status} {ctype}）')
                    continue
                f.write_bytes(body)
            files.append(f.name)
        item['image_files'] = files
        items.append(item)
        print(f'[{n}/{len(codes)}] {code}  SKU {len(item["skus"])}  画像 {len(files)}/{len(item["image_ids"])}', flush=True)

    (out / 'items.json').write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'\n商品 {len(items)}/{len(codes)}  SKU合計 {sum(len(i["skus"]) for i in items)}  '
          f'画像合計 {sum(len(i["image_files"]) for i in items)}  → {out / "items.json"}')
    if problems:
        print('うまくいかなかったもの:')
        for p in problems:
            print('  -', p)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
