"""Yahoo!ショッピングから写し取った商品を、メルカリShops の商品一括登録CSVにする。

  1. カテゴリの確認表を作る
       python3 make_mercari_csv.py categories
       → data/export/カテゴリ確認表.csv（「要確認」の行を見て、違えば直す）
  2. 登録用CSVと画像をまとめる
       python3 make_mercari_csv.py build --shipping 14=送料ID,3=送料ID,9=送料ID,4=送料ID --stock 在庫CSV
       → data/export/メルカリShops_商品登録.csv（Shift_JIS・テンプレートと同じ列）
          data/export/メルカリShops_画像.zip（CSVに書いた画像だけ。フォルダなし）
          data/export/出品一覧（確認用）.csv
       --preview を付けると、送料ID・在庫が無くても「確認用_」のCSVを作る（アップロード用ではない）。
       --drop-sold-out を付けると、全SKUが在庫0の出品を入れない。
       --exclude-like 画像名,… … その画像と中身が同じ画像を、どの商品でも使わない（宣伝バナーなど）。
       --dedupe-shared … 違う商品に同じ中身の画像があれば、1つの名前にそろえる（同じ商品の中はそのまま）。
       --uploaded-result 取り込み結果CSV … メルカリの画像一覧にまだ無い画像だけを
          data/export/メルカリShops_画像_追加分.zip にする。
       SKU の種類名は1出品ずつ16文字以内にそろえる（「 / 」→「/」、それでも長ければ「（…）」を消す）。

決まっている値（依頼者の回答・Yahoo と同じ）:
  商品の状態 1:新品、未使用 / 配送方法 1:未定(出品者が手配) / 発送元の地域 jp16:富山県 /
  発送までの日数 2:2〜3日で発送 / 商品ステータス 1:非公開 / 配送料の負担 2:送料別（購入者負担） /
  販売価格 Yahoo のセール価格 / 画像 1出品20枚まで / SKU が10を超える商品はカラーごとに出品を分ける
"""
import argparse
import csv
import hashlib
import io
import json
import re
import sys
import zipfile
from pathlib import Path

import openpyxl

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))  # 同じフォルダの categories.py を読む（python -I で動かしても読めるように）
import categories as cat  # noqa: E402
FIXED = {'商品の状態': '1', '配送方法': '1', '発送元の地域': 'jp16', '発送までの日数': '2',
         '商品ステータス': '1', '配送料の負担': '2'}
MAX_IMAGES, MAX_SKUS = 20, 10
MAX_LABEL = 16   # SKU 種類名。取り込み結果で 16文字は通り、同じ文字の17文字は失敗した（公式の記載は未確認）
LIMITS = {'商品名': 130, '商品説明': 3000}
REQUIRED = ['商品画像名_1', '商品名', '商品説明', 'SKU1_在庫数', '販売価格', 'カテゴリID', '商品の状態', '配送方法',
            '発送元の地域', '発送までの日数', '商品ステータス', '配送料の負担']
# Shift_JIS（cp932）に無い文字の置きかえ（見た目が同じ全角の文字へ）
SAFE = str.maketrans({'〜': '～', '−': '－', '‖': '∥', '—': '―',
                      '¢': '￠', '£': '￡', '¬': '￢', ' ': ' '})


class BuildError(Exception):
    pass


def cp932_safe(s):
    return (s or '').translate(SAFE)


def check_cp932(row, label):
    bad = []
    for k, v in row.items():
        for ch in v or '':
            try:
                ch.encode('cp932')
            except UnicodeEncodeError:
                bad.append(f'{k}に「{ch}」(U+{ord(ch):04X})')
    if bad:
        raise BuildError(f'{label}: Shift_JIS にできない文字があります: ' + '、'.join(bad))


def read_template(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    header = [c for c in next(wb['テンプレート'].iter_rows(min_row=1, max_row=1, values_only=True)) if c]
    choices = {}
    rows = list(wb['選択肢'].iter_rows(values_only=True))
    for col, head in enumerate(rows[0] if rows else []):
        if head:
            choices[head] = {str(r[col]).split(':')[0] for r in rows[1:] if col < len(r) and r[col]}
    master = [r[:3] for r in wb['カテゴリーマスタ'].iter_rows(min_row=2, values_only=True) if r and r[0]]
    return header, choices, master


def read_csv_any(path):
    raw = Path(path).read_bytes()
    for enc in ('utf-8-sig', 'cp932'):
        try:
            return list(csv.DictReader(io.StringIO(raw.decode(enc), newline='')))
        except UnicodeDecodeError:
            continue
    raise BuildError(f'{path}: 文字コードを読めません')


def read_prices(path):
    rows = read_csv_any(path)
    if not rows or 'sale-price' not in rows[0]:
        raise BuildError('Yahoo の商品CSVに sale-price の列がありません')
    return {r['code']: r['sale-price'] for r in rows}


def read_stock(path):
    rows = read_csv_any(path)
    if not rows or 'quantity' not in rows[0]:
        raise BuildError(f'在庫CSVに quantity の列がありません（列: {list(rows[0].keys()) if rows else "なし"}）')
    stock = {}
    for r in rows:
        key = (r.get('sub-code') or '').strip() or (r.get('code') or '').strip()
        if key:
            stock[key] = (r.get('quantity') or '').strip()
    return stock


def read_category_map(path):
    return {r['商品コード']: r['カテゴリID'] for r in read_csv_any(path) if r.get('商品コード')}


def unique(seq):
    out = []
    for x in seq:
        if x not in out:
            out.append(x)
    return out


def split_listings(item):
    """[(商品名, SKUの一覧, カラー or None)] を返す。SKU が10を超えたらカラーごとに分ける。"""
    skus = item['skus']
    if len(skus) <= MAX_SKUS:
        return [(item['name'], skus, None)]
    out = []
    for color in unique(s['options'].get('カラー', '') for s in skus):
        group = [s for s in skus if s['options'].get('カラー', '') == color]
        if len(group) > MAX_SKUS:
            raise BuildError(f'{item["code"]}: カラー「{color}」だけで SKU が{len(group)}あり、10以内に分けられません')
        out.append((f'{item["name"]}（{color}）', group, color))
    return out


def sku_label(s, skus, split_color):
    color, size = s['options'].get('カラー', ''), s['options'].get('サイズ', '')
    colors = unique(x['options'].get('カラー', '') for x in skus)
    sizes = unique(x['options'].get('サイズ', '') for x in skus)
    if split_color is not None or len(colors) == 1:
        return size or color
    if len(sizes) == 1:
        return color or size
    return f'{color} / {size}'


def fit_labels(labels):
    """1出品の SKU 種類名を MAX_LABEL 文字以内にする。長いものがあれば、その出品の全部に同じ直しを順に当てる。
    1. 「 / 」→「/」  2. 「（…）」の補足を消す。  それでも長い・同じ名前になる → BuildError"""
    def fits(ls):
        return all(len(x) <= MAX_LABEL for x in ls)
    out = list(labels)
    for step in (lambda x: x.replace(' / ', '/'), lambda x: re.sub(r'（[^（）]*）', '', x)):
        if fits(out):
            break
        out = [step(x) for x in out]
    if not fits(out):
        raise BuildError(f'SKUの種類名を{MAX_LABEL}文字以内にできません: {[x for x in out if len(x) > MAX_LABEL]}')
    if len(set(out)) != len(out):
        raise BuildError(f'SKUの種類名を短くすると同じ名前になります: {out}')
    return out


def listing_images(item, color, drop=frozenset(), rename=None):
    """出品に使う画像名（20枚まで）。drop の画像は使わず、rename にある画像は共通の名前にする。"""
    imgs = [im for im in item['images'] if im.get('file') and im['file'] not in drop]
    if color is not None:
        imgs = [im for im in imgs if im.get('color') == color] + [im for im in imgs if not im.get('color')]
    return unique((rename or {}).get(im['file'], (item['code'], im['file'])) for im in imgs)[:MAX_IMAGES]


def file_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def image_path(data_dir, name):
    return Path(data_dir) / 'images' / name.split('_')[0] / name


def uploaded_from_result(path):
    """メルカリの取り込み結果CSVから、メルカリの画像一覧に入っている画像名を拾う。
    「商品画像名_N が存在しません」と言われた列の名前は入っていない、それ以外の列の名前は入っている、とする。"""
    ok, missing = set(), set()
    for r in read_csv_any(path):
        bad = set(re.findall(r'(商品画像名_\d+)が存在しません', r.get('エラー理由', '')))
        for k, v in r.items():
            if k and k.startswith('商品画像名_') and v:
                (missing if k in bad else ok).add(v)
    return ok - missing


def validate(row, header, choices, cat_ids, label, preview):
    errs = []
    for k in REQUIRED:
        if not row.get(k) and not (preview and k == 'SKU1_在庫数'):
            errs.append(f'{k}が空')
    for k, n in LIMITS.items():
        if len(row.get(k, '')) > n:
            errs.append(f'{k}が{n}文字を超える（{len(row[k])}文字）')
    for i in range(1, MAX_IMAGES + 1):
        if len(row.get(f'商品画像名_{i}', '')) > 40:
            errs.append(f'商品画像名_{i}が40文字を超える')
    p = row.get('販売価格', '')
    if not (p.isdigit() and 300 <= int(p) <= 9999999):
        errs.append(f'販売価格が300〜9,999,999円の外（{p!r}）')
    for n in range(1, MAX_SKUS + 1):
        q = row.get(f'SKU{n}_在庫数', '')
        if q and not (q.isdigit() and int(q) <= 9999):
            errs.append(f'SKU{n}_在庫数が0〜9,999の外（{q!r}）')
    if row.get('カテゴリID') not in cat_ids:
        errs.append(f'カテゴリIDがテンプレートに無い（{row.get("カテゴリID")!r}）')
    for k, v in FIXED.items():
        if k in choices and v not in choices[k]:
            errs.append(f'{k}の値 {v} が選択肢に無い')
    if row.get('配送料の負担') == '2' and not row.get('送料ID') and not preview:
        errs.append('送料別なのに送料IDが空')
    if set(row) - set(header):
        errs.append(f'テンプレートに無い列: {sorted(set(row) - set(header))}')
    if errs:
        raise BuildError(f'{label}: ' + '／'.join(errs))


def write_csv_bytes(header, rows, encoding, bom=False):
    buf = io.StringIO(newline='')
    w = csv.DictWriter(buf, fieldnames=header, lineterminator='\r\n')
    w.writeheader()
    w.writerows(rows)
    return (b'\xef\xbb\xbf' if bom else b'') + buf.getvalue().encode(encoding)


def image_plan(data_dir, items, exclude_like, dedupe_shared):
    """画像の中身（sha256）で見分けて、{商品コード: 使わない画像名の集合} と
    {商品コード: {画像名: (共通にする商品コード, 画像名)}} を返す。
    exclude_like … この画像と中身が同じ画像は、どの商品でも使わない。
    dedupe_shared … 違う商品に同じ中身の画像があれば、商品コード・画像名が一番小さいものの名前にそろえる
                     （同じ商品の中の重なりはそのまま）。"""
    hashes = {}
    for it in items:
        for im in it['images']:
            p = data_dir / 'images' / it['code'] / im['file'] if im.get('file') else None
            if p and p.is_file():
                hashes[(it['code'], im['file'])] = file_hash(p)
    bad = set()
    for name in exclude_like:
        p = image_path(data_dir, name)
        if not p.is_file():
            raise BuildError(f'外す画像の見本がありません: {name}')
        bad.add(file_hash(p))
    drop, rename, first = {}, {}, {}
    for (code, f), hv in sorted(hashes.items()):
        if hv in bad:
            drop.setdefault(code, set()).add(f)
            continue
        if dedupe_shared:
            canon = first.setdefault(hv, (code, f))
            if canon[0] != code:
                rename.setdefault(code, {})[f] = canon
    return drop, rename


def build(data_dir, yahoo_csv, template, category_map, shipping, stock_csv, out_dir, preview=False, skip=(),
          drop_sold_out=False, exclude_like=(), dedupe_shared=False, already_uploaded=None):
    data_dir, out_dir = Path(data_dir), Path(out_dir)
    items = [it for it in json.loads((data_dir / 'items.json').read_text(encoding='utf-8')) if it['code'] not in set(skip)]
    header, choices, master = read_template(template)
    cat_ids = {cid for cid, _n, _f in master}
    prices = read_prices(yahoo_csv)
    cmap = read_category_map(category_map)
    if stock_csv is None and not preview:
        raise BuildError('在庫CSVがありません（11/30 17:00 以降の Yahoo の在庫CSV）。確認用なら --preview')
    stock = read_stock(stock_csv) if stock_csv else {}
    drop, rename = image_plan(data_dir, items, exclude_like, dedupe_shared)

    rows, summary, used_images, dropped = [], [], [], []
    for it in items:
        group = str(it.get('postage_set') or '')
        fee_id = shipping.get(group, '')
        if not fee_id and not preview:
            raise BuildError(f'{it["code"]}: Yahoo の配送グループ {group} に対応するメルカリの送料IDがありません')
        if it['code'] not in cmap:
            raise BuildError(f'{it["code"]}: カテゴリ確認表にありません')
        for name, skus, color in split_listings(it):
            label = f'{it["code"]}「{name}」'
            if drop_sold_out and stock and all(str(stock.get(s['sku_code'], '')) == '0' for s in skus):
                dropped.append(label)   # 全SKUが在庫0の出品は入れない（依頼者の指示）
                continue
            row = {k: '' for k in header}
            images = listing_images(it, color, drop.get(it['code'], frozenset()), rename.get(it['code']))
            for i, (code, f) in enumerate(images, 1):
                row[f'商品画像名_{i}'] = f
                used_images.append((code, f))
            row['商品名'] = cp932_safe(name)
            row['商品説明'] = cp932_safe(it['description'])
            try:
                labels = fit_labels([cp932_safe(sku_label(s, skus, color)) for s in skus])
            except BuildError as e:
                raise BuildError(f'{label}: {e}') from None
            for n, s in enumerate(skus, 1):
                row[f'SKU{n}_種類'] = labels[n - 1]
                row[f'SKU{n}_商品管理コード'] = s['sku_code']
                q = stock.get(s['sku_code'])
                if q is None and not preview:
                    raise BuildError(f'{label}: SKU {s["sku_code"]} の在庫が在庫CSVにありません')
                row[f'SKU{n}_在庫数'] = q or ''
            row['販売価格'] = prices.get(it['code'], '')
            row['カテゴリID'] = cmap[it['code']]
            row.update(FIXED)
            row['送料ID'] = fee_id
            validate(row, header, choices, cat_ids, label, preview)
            check_cp932(row, label)
            rows.append(row)
            summary.append({'元の商品コード': it['code'], '商品名': row['商品名'], 'カラーで分けた': color or '',
                            'SKU数': str(len(skus)), '在庫の合計': str(sum(int(row[f'SKU{n}_在庫数'] or 0) for n in range(1, len(skus) + 1))),
                            '画像の枚数': str(len(images)), 'カテゴリID': row['カテゴリID'],
                            '販売価格': row['販売価格'], 'Yahooの配送グループ': group, '送料ID': fee_id})

    for code, f in used_images:
        if not (data_dir / 'images' / code / f).is_file():
            raise BuildError(f'{code}: 画像ファイルがありません: {f}')
    names = [f for _c, f in used_images]
    if len(set(names)) != len(set(used_images)):
        raise BuildError('違う商品で同じ画像ファイル名があります（zip で重なる）')

    out_dir.mkdir(parents=True, exist_ok=True)
    csv_path = out_dir / (('確認用_' if preview else '') + 'メルカリShops_商品登録.csv')
    csv_path.write_bytes(write_csv_bytes(header, rows, 'cp932'))
    with zipfile.ZipFile(out_dir / 'メルカリShops_画像.zip', 'w', compression=zipfile.ZIP_STORED) as z:
        for code, f in dict.fromkeys(used_images):
            z.write(data_dir / 'images' / code / f, arcname=f)
    upload = None
    if already_uploaded is not None:   # メルカリの画像一覧にまだ無い画像だけの zip
        upload = [(c, f) for c, f in dict.fromkeys(used_images) if f not in already_uploaded]
        with zipfile.ZipFile(out_dir / 'メルカリShops_画像_追加分.zip', 'w', compression=zipfile.ZIP_STORED) as z:
            for code, f in upload:
                z.write(data_dir / 'images' / code / f, arcname=f)
    (out_dir / '出品一覧（確認用）.csv').write_bytes(
        write_csv_bytes(list(summary[0].keys()) if summary else [], summary, 'utf-8', bom=True))
    return {'csv': csv_path, 'listings': len(rows), 'skus': sum(int(s['SKU数']) for s in summary),
            'images': len(set(used_images)), 'dropped': dropped,
            'to_upload': None if upload is None else len(upload),
            'upload_names': [] if upload is None else [f for _c, f in upload]}


def write_category_map(data_dir, template, out_path):
    items = json.loads((Path(data_dir) / 'items.json').read_text(encoding='utf-8'))
    _h, _c, master = read_template(template)
    ids = cat.category_ids(master)
    rows = []
    for it in items:
        p = cat.propose(it)
        if p['path'] not in ids:
            raise BuildError(f'{it["code"]}: 提案したカテゴリ {p["path"]} がテンプレートに無い')
        rows.append({'商品コード': it['code'], '商品名': it['name'],
                     'Yahooのカテゴリ': ' > '.join(it['category_path'][1:]),
                     'メルカリのカテゴリ': p['path'], 'カテゴリID': ids[p['path']],
                     '要確認': '要確認' if p['check'] else '', '根拠': p['reason']})
    rows.sort(key=lambda r: (r['要確認'] == '', r['商品コード']))
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_bytes(write_csv_bytes(list(rows[0].keys()), rows, 'utf-8', bom=True))
    return sum(1 for r in rows if r['要確認']), len(rows)


def parse_shipping(s):
    out = {}
    for part in (s or '').split(','):
        if part.strip():
            if '=' not in part:
                raise BuildError(f'--shipping の書き方が違います: {part!r}（例: 14=送料ID）')
            g, fid = part.split('=', 1)
            out[g.strip()] = fid.strip()
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description='メルカリShops の商品一括登録CSVを作る')
    ap.add_argument('command', choices=['categories', 'build'])
    ap.add_argument('--data', default=str(HERE / 'data'))
    ap.add_argument('--template', default=str(HERE / 'data' / 'template.xlsx'))
    ap.add_argument('--yahoo-csv', default=str(HERE.parent / 'closing-sale' / 'csv' / 'data' / 'data202611250949_original.csv'))
    ap.add_argument('--category-map', default=str(HERE / 'data' / 'export' / 'カテゴリ確認表.csv'))
    ap.add_argument('--shipping', default='', help='Yahooの配送グループ=メルカリの送料ID をカンマ区切り')
    ap.add_argument('--stock', default=None, help='Yahoo の在庫CSV')
    ap.add_argument('--out', default=str(HERE / 'data' / 'export'))
    ap.add_argument('--preview', action='store_true')
    ap.add_argument('--drop-sold-out', action='store_true', help='全SKUが在庫0の出品を入れない')
    ap.add_argument('--exclude-like', default='', help='この画像と中身が同じ画像を使わない（画像名をカンマ区切り）')
    ap.add_argument('--dedupe-shared', action='store_true', help='違う商品の同じ中身の画像を1つの名前にそろえる')
    ap.add_argument('--uploaded-result', default=None,
                    help='メルカリの取り込み結果CSV。画像一覧にまだ無い画像だけの zip（_追加分）を作る')
    a = ap.parse_args(argv)
    try:
        if a.command == 'categories':
            n_check, n = write_category_map(a.data, a.template, a.category_map)
            print(f'OK  カテゴリ確認表 {n}件（要確認 {n_check}件）→ {a.category_map}')
        else:
            r = build(a.data, a.yahoo_csv, a.template, a.category_map, parse_shipping(a.shipping),
                      a.stock, a.out, preview=a.preview, drop_sold_out=a.drop_sold_out,
                      exclude_like=[x.strip() for x in a.exclude_like.split(',') if x.strip()],
                      dedupe_shared=a.dedupe_shared,
                      already_uploaded=uploaded_from_result(a.uploaded_result) if a.uploaded_result else None)
            print(f'OK  出品 {r["listings"]}件 / SKU {r["skus"]} / 画像 {r["images"]}枚 → {r["csv"]}')
            for d in r['dropped']:
                print(f'    全SKU在庫0のため入れなかった: {d}')
            if r['to_upload'] is not None:
                print(f'    画像一覧にまだ無い画像 {r["to_upload"]}枚 → メルカリShops_画像_追加分.zip: {", ".join(r["upload_names"])}')
    except BuildError as e:
        print(f'NG  {e}（ファイルは作っていません）')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
