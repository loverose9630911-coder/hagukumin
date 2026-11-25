"""Yahoo!ショッピングの自分のストアから、商品情報と商品画像を写し取る（メルカリShops への移行用）。

  - 商品ページ https://store.shopping.yahoo.co.jp/<ストア>/<商品コード>.html を1つずつ読み、
    ページ内の商品データ（__NEXT_DATA__）から 商品名・キャッチコピー・商品説明・SKU（カラー/サイズ）・
    画像の一覧・カテゴリ・スペック を取り出して data/items.json に保存する。
  - 商品画像は公開されている中でいちばん大きい版（/i/n/、700×700）を data/images/<商品コード>/ に
    <商品コード>_01.jpg, _02.jpg … の順で保存する（1枚目がメイン画像。拡張子は中身で決める）。
    ストアの画像置き場の画像（type: Lib）は shopping.c.yimg.jp/lib/ から取り、色の指定があれば記録する。
  - 1枚・1商品で失敗しても止まらず、最後にうまくいかなかったものを一覧で出す。
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
IMAGE_URL = 'https://item-shopping.c.yimg.jp/i/n/{image_id}'          # 商品画像（type: Item）
LIB_URL = 'https://shopping.c.yimg.jp/lib/{store}/{image_id}'          # ストアの画像置き場（type: Lib）
USER_AGENT = 'Mozilla/5.0 (store owner data export)'
CODE_RE = re.compile(r'^[A-Za-z0-9_\-]+$')
LIB_ID_RE = re.compile(r'^[A-Za-z0-9_\-]+(\.[A-Za-z0-9]+)?$')


class FetchError(Exception):
    pass


def page_url(code, store=STORE):
    if not code or not CODE_RE.match(code):
        raise FetchError(f'商品コードの形が想定外です: {code!r}')
    return PAGE_URL.format(store=store, code=code)


def image_url(image, store=STORE):
    image_id, kind = image.get('id') or '', image.get('type')
    if kind == 'Item' and CODE_RE.match(image_id):
        return IMAGE_URL.format(image_id=image_id)
    if kind == 'Lib' and LIB_ID_RE.match(image_id):
        return LIB_URL.format(store=store, image_id=image_id)
    raise FetchError(f'画像の種類・IDの形が想定外です: {kind!r} {image_id!r}')


def image_ext(body):
    """中身の先頭から画像の種類を見分ける。画像でなければ None。"""
    if body[:3] == b'\xff\xd8\xff':
        return 'jpg'
    if body[:8] == b'\x89PNG\r\n\x1a\n':
        return 'png'
    if body[:6] in (b'GIF87a', b'GIF89a'):
        return 'gif'
    if body[:4] == b'RIFF' and body[8:12] == b'WEBP':
        return 'webp'
    return None


def image_file_name(code, index, ext):
    return f'{code}_{index + 1:02d}.{ext}'


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
        'images': [{'id': i['id'], 'type': i.get('type'), 'color': i.get('firstOptionChoiceName')}
                   for i in images if i.get('id')],
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


def saved_image(img_dir, code, index):
    """保存済みの画像（拡張子は何でもよい）があり、中身が画像ならそのパスを返す。"""
    for f in sorted(img_dir.glob(f'{code}_{index + 1:02d}.*')):
        if image_ext(f.read_bytes()[:16]):
            return f
    return None


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
        try:
            page_file = out / 'pages' / f'{code}.html'
            if not page_file.exists():
                status, _, body = get(page_url(code, a.store), wait=a.wait)
                time.sleep(a.wait)
                if status != 200:
                    problems.append(f'{code}: 商品ページが開けません（{status}）')
                    continue
                page_file.write_bytes(body)
            item = parse_item(page_file.read_text(encoding='utf-8', errors='replace'), code)
        except FetchError as e:
            problems.append(str(e))
            continue

        img_dir = out / 'images' / code
        img_dir.mkdir(exist_ok=True)
        for i, image in enumerate(item['images']):
            image['file'] = None
            try:
                f = saved_image(img_dir, code, i)
                if f is None:
                    status, ctype, body = get(image_url(image, a.store), wait=a.wait)
                    time.sleep(a.wait)
                    ext = image_ext(body) if status == 200 else None
                    if not ext:
                        problems.append(f'{code}: 画像 {i + 1}枚目（{image["id"]}）を取得できません（{status} {ctype}）')
                        continue
                    f = img_dir / image_file_name(code, i, ext)
                    f.write_bytes(body)
                image['file'] = f.name
            except FetchError as e:
                problems.append(f'{code}: 画像 {i + 1}枚目: {e}')
        item['image_files'] = [im['file'] for im in item['images'] if im['file']]
        items.append(item)
        print(f'[{n}/{len(codes)}] {code}  SKU {len(item["skus"])}  画像 {len(item["image_files"])}/{len(item["images"])}', flush=True)

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
