"""Yahoo!ショッピングのストアを、ネットにつながっていなくても見られる「商品カタログ」にする。

保存した商品ページ（Yahoo のサーバーから見た目や画像を読み込むので、ページが消えると表示できない）から、
中のデータだけを取り出して、手元の画像だけを使う HTML を作り直す。外のサイトは1つも読みに行かない。

  1. ストアの画像置き場の画像（shopping.c.yimg.jp/lib/<ストア>/）を手元に保存する
       python3 -I offline_catalog.py assets <取り直したデータのフォルダ> [--extra-html トップページ.html ...]
  2. カタログを作る
       python3 -I offline_catalog.py build <取り直したデータのフォルダ> --yahoo-csv 商品CSV --stock 在庫CSV
                                       --toppage 名前=トップページ.html ... --out 出力フォルダ

出力（--out）:
  index.html                     … 商品の一覧（まずこれを開く）
  00_catalog/items/<商品コード>.html … 1商品1ページ（画像・価格・SKUと在庫・説明文・フリースペース・レビュー）
  00_catalog/<名前>.html          … トップページ・ストアのフッター
  00_catalog/assets/              … ストアの画像置き場の画像
  商品画像は ../02_images/<商品コード>/ を使う（zip の 02_images と同じ並び）。
"""
import argparse
import csv
import html
import io
import json
import re
import sys
import time
from html.parser import HTMLParser
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'mercari-migration'))
import fetch_yahoo as fy  # noqa: E402

STORE = 'comburabura'
LIB_RE = re.compile(r'https?://shopping\.c\.yimg\.jp/lib/' + STORE + r'/([A-Za-z0-9_\-][A-Za-z0-9_\-./]*)')
ITEM_LINK_RE = re.compile(r'^https?://store\.shopping\.yahoo\.co\.jp/' + STORE + r'/([A-Za-z0-9_\-]+)\.html(?:[?#].*)?$')
HTML_FIELDS = [('information', '商品説明'), ('pageComment', 'PC用 商品ページのコメント'),
               ('freeSpace1', 'PC用 フリースペース1'), ('freeSpace2', 'PC用 フリースペース2'),
               ('freeSpace3', 'PC用 フリースペース3'), ('freeSpaceSmartPhone', 'スマートフォン用 フリースペース')]


class CatalogError(Exception):
    pass


# ---------------------------------------------------------------- データを読む
def page_props(page_html, code=''):
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', page_html, re.S)
    if not m:
        raise CatalogError(f'{code}: ページに商品データがありません')
    return json.loads(m.group(1))['props']['pageProps']


def lib_name(url):
    """画像置き場のURL → 手元のファイル名（英数字・- _ . だけ。/ は __ にする）。対象外なら None。"""
    m = LIB_RE.fullmatch(url.strip())
    if not m:
        return None
    name = m.group(1).replace('/', '__')
    if name.startswith('.') or '..' in name:
        return None
    return name


def lib_urls(text):
    return {m.group(0) for m in LIB_RE.finditer(text or '')}


def store_texts(props):
    """1商品のページデータのうち、画像置き場の画像が出てくる文字列をすべて返す。"""
    it = props['item']
    out = [it.get(k) or '' for k, _ in HTML_FIELDS] + [it.get('originalPriceEvidence') or '']
    sd = props.get('storeDesign') or {}
    out.append(sd.get('footerFreeSpace') or '')
    if sd.get('bannerImage'):
        out.append(f'https://shopping.c.yimg.jp/lib/{STORE}/{sd["bannerImage"]}')
    return out


# ---------------------------------------------------------------- HTML を安全な形に作り直す
VOID = {'br', 'img', 'hr', 'wbr'}
ALLOWED = {'a', 'b', 'big', 'blockquote', 'br', 'center', 'dd', 'div', 'dl', 'dt', 'em', 'font', 'h1', 'h2', 'h3',
           'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 's', 'small', 'span', 'strike', 'strong', 'sub',
           'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'wbr', 'caption', 'col',
           'colgroup', 'section', 'article', 'header', 'footer', 'figure', 'figcaption', 'picture'}
DROP_WITH_CONTENT = {'script', 'style', 'noscript', 'iframe', 'object', 'embed', 'form', 'svg', 'template',
                     'select', 'textarea', 'button', 'video', 'audio', 'canvas', 'map', 'head', 'title'}
ATTRS = {'style', 'width', 'height', 'align', 'valign', 'border', 'colspan', 'rowspan', 'cellpadding',
         'cellspacing', 'bgcolor', 'color', 'size', 'face', 'alt', 'title', 'nowrap', 'span'}
CSS_URL_RE = re.compile(r'url\(\s*([\'"]?)(.*?)\1\s*\)', re.I | re.S)


def clean_style(style, img_src):
    def rep(m):
        local = img_src(m.group(2))
        return f'url({local})' if local else 'none'
    s = CSS_URL_RE.sub(rep, style)
    if re.search(r'expression\s*\(|javascript:|@import|behavior\s*:', s, re.I):
        return ''
    return s


class _Sanitizer(HTMLParser):
    def __init__(self, img_src, link_href):
        super().__init__(convert_charrefs=True)
        self.img_src, self.link_href = img_src, link_href
        self.out, self.drop = [], []

    def _attrs(self, tag, attrs):
        out = []
        for k, v in attrs:
            k = k.lower()
            v = '' if v is None else v
            if k == 'style':
                v = clean_style(v, self.img_src)
                if not v:
                    continue
            elif k == 'href' and tag == 'a':
                v = self.link_href(v)
                if not v:
                    continue
            elif k == 'src' and tag == 'img':
                continue          # 下で入れる
            elif k not in ATTRS:
                continue
            out.append(f' {k}="{html.escape(v, quote=True)}"')
        return ''.join(out)

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if self.drop:
            if tag not in VOID and tag == self.drop[-1]:
                self.drop.append(tag)
            return
        if tag in DROP_WITH_CONTENT:
            self.drop.append(tag)
            return
        if tag not in ALLOWED:
            return
        if tag == 'img':
            src = (dict(attrs).get('src') or '').strip()
            if not src:
                return            # src の無い画像は元のページでも何も出ていない
            local = self.img_src(src)
            if not local:
                self.out.append('<span class="nophoto">（画像なし）</span>')
                return
            self.out.append(f'<img src="{html.escape(local, quote=True)}"{self._attrs(tag, attrs)} loading="lazy">')
            return
        self.out.append(f'<{tag}{self._attrs(tag, attrs)}>')

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag.lower() not in VOID and not self.drop and tag.lower() in ALLOWED:
            self.out.append(f'</{tag.lower()}>')

    def handle_endtag(self, tag):
        tag = tag.lower()
        if self.drop:
            if tag == self.drop[-1]:
                self.drop.pop()
            return
        if tag in ALLOWED and tag not in VOID:
            self.out.append(f'</{tag}>')

    def handle_data(self, data):
        if not self.drop:
            self.out.append(html.escape(data, quote=False))


def sanitize(fragment, img_src, link_href):
    """外のサイトを読みに行かない HTML にする。
    img_src(url) → 手元の画像の相対パス or None（None の画像は「（画像なし）」にする）
    link_href(url) → 手元のページの相対パス or None（None のリンクは文字だけ残す）
    script などは中身ごと消し、on〜 などの属性は消す。"""
    p = _Sanitizer(img_src, link_href)
    p.feed(fragment or '')
    p.close()
    return ''.join(p.out)


# ---------------------------------------------------------------- 画像置き場の画像を保存する
def download_assets(urls, dest, wait=0.3, log=print):
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    got, failed = {}, []
    for i, url in enumerate(sorted(urls), 1):
        name = lib_name(url)
        if not name:
            failed.append((url, '対象外のURL'))
            continue
        path = dest / name
        if path.is_file() and fy.image_ext(path.read_bytes()[:16]):
            got[url] = name
            continue
        try:
            status, _ctype, body = fy.get(url)
        except fy.FetchError as e:
            failed.append((url, str(e)))
            continue
        if status != 200 or not fy.image_ext(body[:16]):
            failed.append((url, f'画像ではありません（{status}）'))
        else:
            path.write_bytes(body)
            got[url] = name
        if i % 50 == 0:
            log(f'  {i}/{len(urls)}')
        time.sleep(wait)
    return got, failed


# ---------------------------------------------------------------- ページを作る
CSS = """
:root{--ink:#222;--sub:#666;--line:#ddd;--bg:#fff;--soft:#f6f4ef;--accent:#111}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:'Yu Gothic','YuGothic','Meiryo','Hiragino Sans',sans-serif;line-height:1.7}
a{color:#0b57d0}
.wrap{max-width:1100px;margin:0 auto;padding:16px}
header.top{background:var(--accent);color:#fff;padding:14px 16px}
header.top a{color:#fff}
header.top h1{margin:0;font-size:20px}
header.top p{margin:4px 0 0;font-size:13px;opacity:.85}
.note{background:var(--soft);border:1px solid var(--line);padding:10px 12px;font-size:13px;margin:12px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px}
.card{border:1px solid var(--line);text-decoration:none;color:var(--ink);display:flex;flex-direction:column}
.card img{width:100%;aspect-ratio:1/1;object-fit:cover;display:block;background:#eee}
.card .t{padding:8px;font-size:13px}
.card .code{color:var(--sub);font-size:12px}
.card .name{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.card .price{font-weight:bold;margin-top:4px}
.links{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
.links a{border:1px solid var(--line);padding:6px 10px;text-decoration:none;color:var(--ink);font-size:14px}
h2{font-size:18px;border-left:4px solid var(--accent);padding-left:8px;margin:28px 0 10px}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.gallery a{display:block;border:1px solid var(--line)}
.gallery img{width:100%;display:block}
.gallery .cap{font-size:11px;color:var(--sub);padding:2px 4px}
table.data{border-collapse:collapse;width:100%;font-size:14px}
table.data th,table.data td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
table.data th{background:var(--soft);white-space:nowrap}
table.kv{width:auto;max-width:100%}
.html{border:1px solid var(--line);padding:12px;overflow-x:auto}
.html img{max-width:100%;height:auto}
.nophoto{display:inline-block;color:var(--sub);font-size:12px;border:1px dashed var(--line);padding:2px 6px}
.review{border-bottom:1px solid var(--line);padding:10px 0}
.stars{color:#c58b00;letter-spacing:2px}
.small{font-size:12px;color:var(--sub)}
.back{margin:8px 0;font-size:14px}
@media (max-width:600px){.grid{grid-template-columns:repeat(2,1fr)}.wrap{padding:12px}}
"""


def page(title, body, home_href):
    return ('<!doctype html><html lang="ja"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>{html.escape(title)}</title><style>{CSS}</style></head><body>'
            f'<header class="top"><h1><a href="{home_href}" style="text-decoration:none">Office Casual Bura.bura 商品カタログ</a></h1>'
            '<p>保存したデータだけで表示しています（ネットにつながっていなくても見られます）</p></header>'
            f'<div class="wrap">{body}</div></body></html>')


def yen(v):
    return f'{int(v):,}円' if str(v).strip().isdigit() else ''


def read_csv_any(path):
    raw = Path(path).read_bytes()
    for enc in ('utf-8-sig', 'cp932'):
        try:
            return list(csv.DictReader(io.StringIO(raw.decode(enc), newline='')))
        except UnicodeDecodeError:
            continue
    raise CatalogError(f'{path}: 文字コードを読めません')


def esc(s):
    return html.escape(str(s if s is not None else ''))


def item_page(code, props, item, price, stock, img_src_for, link_href, item_names):
    it = props['item']
    imgs = item['image_files']
    parts = ['<p class="back"><a href="../../index.html">← 商品の一覧へ</a></p>',
             f'<p class="small">商品コード {esc(code)}</p><h1 style="font-size:22px;margin:4px 0">{esc(it.get("name"))}</h1>']
    if it.get('catchCopy'):
        parts.append(f'<p>{esc(it["catchCopy"])}</p>')

    # 価格（閉店セール前の商品CSVの値）
    rows = [('メーカー希望小売価格（original-price）', price.get('original-price')), ('通常価格（price）', price.get('price')),
            ('セール価格（sale-price）', price.get('sale-price')), ('会員価格（member-price）', price.get('member-price'))]
    trs = ''.join(f'<tr><th>{esc(k)}</th><td>{esc(yen(v))}</td></tr>' for k, v in rows if yen(v))
    if trs:
        parts.append('<h2>価格（閉店セール前の商品CSV）</h2>'
                     f'<table class="data kv">{trs}<tr><th>配送グループ（postage-set）</th><td>{esc(price.get("postage-set", ""))}</td></tr></table>')
    if it.get('originalPriceEvidence'):
        ev = sanitize(f'<img src="{esc(it["originalPriceEvidence"])}">', img_src_for, link_href)
        parts.append(f'<p class="small">メーカー希望小売価格の根拠として登録していた画像（originalPriceEvidence）</p><div class="html">{ev}</div>')

    # 画像
    gal = []
    for n, f in enumerate(imgs, 1):
        src = f'../../02_images/{code}/{f}'
        im = item['images'][n - 1] if n - 1 < len(item['images']) else {}
        cap = f'{n}枚目' + (f'（{im.get("color")}）' if im.get('color') else '')
        gal.append(f'<div><a href="{esc(src)}"><img src="{esc(src)}" alt="{esc(cap)}" loading="lazy"></a>'
                   f'<div class="cap">{esc(cap)}</div></div>')
    parts.append(f'<h2>商品画像（{len(imgs)}枚）</h2><div class="gallery">{"".join(gal)}</div>')

    # SKU と在庫
    opt_names = item.get('option_names') or sorted({k for s in item['skus'] for k in s['options']})
    head = ''.join(f'<th>{esc(n)}</th>' for n in opt_names)
    body = ''.join('<tr><td>' + esc(s['sku_code']) + '</td>' + ''.join(f'<td>{esc(s["options"].get(n, ""))}</td>' for n in opt_names)
                   + f'<td>{esc(stock.get(s["sku_code"], ""))}</td></tr>' for s in item['skus'])
    parts.append(f'<h2>SKU と在庫（{len(item["skus"])}件）</h2>'
                 f'<table class="data"><tr><th>SKUコード</th>{head}<th>在庫</th></tr>{body}</table>')

    # カテゴリ・スペック
    spec = ''.join(f'<tr><th>{esc(k)}</th><td>{esc(v)}</td></tr>' for k, v in (item.get('specs') or {}).items())
    parts.append('<h2>カテゴリ・スペック</h2><table class="data">'
                 f'<tr><th>Yahooのカテゴリ</th><td>{esc(" > ".join(item.get("category_path") or []))}</td></tr>{spec}</table>')

    # 説明文・フリースペース
    for key, label in HTML_FIELDS:
        v = it.get(key)
        if v:
            parts.append(f'<h2>{esc(label)}</h2><div class="html">{sanitize(v, img_src_for, link_href)}</div>')

    # レビュー
    rv = props.get('review') or {}
    summ = rv.get('reviewSummary') or {}
    revs = rv.get('itemReviews') or []
    if summ.get('count'):
        shown = []
        for r in revs:
            opts = ' / '.join(f'{o.get("name")}：{o.get("value")}' for o in r.get('subCodeOptions') or [])
            rate = int(r.get('rating') or 0)
            extra = '（動画あり：保存していません）' if r.get('videos') else ''
            extra += '（写真あり：保存していません）' if r.get('images') else ''
            shown.append(f'<div class="review"><span class="stars">{"★" * rate}{"☆" * (5 - rate)}</span> '
                         f'<span class="small">{esc(r.get("postedDate"))}　{esc(opts)}{esc(extra)}</span>'
                         f'<div>{esc(r.get("body"))}</div></div>')
        parts.append(f'<h2>レビュー（平均 {esc(summ.get("average"))}／全{esc(summ.get("count"))}件のうち、ページに出ていた{len(revs)}件）</h2>'
                     + ''.join(shown))
    return page(f'{code} {it.get("name", "")}', ''.join(parts), '../../index.html')


def build(data_dir, yahoo_csv, stock_csv, toppages, assets_dir, out_dir):
    data_dir, out_dir, assets_dir = Path(data_dir), Path(out_dir), Path(assets_dir)
    items = json.loads((data_dir / 'items.json').read_text(encoding='utf-8'))
    codes = [it['code'] for it in items]
    prices = {r['code']: r for r in read_csv_any(yahoo_csv)}
    stock = {r['sub-code']: r['quantity'] for r in read_csv_any(stock_csv)}
    have = {p.name for p in assets_dir.iterdir()} if assets_dir.is_dir() else set()

    def img_src(prefix):
        def f(url):
            name = lib_name(url or '')
            return f'{prefix}assets/{name}' if name and name in have else None
        return f

    def link_href(prefix):
        def f(url):
            m = ITEM_LINK_RE.match((url or '').strip())
            return f'{prefix}{m.group(1)}.html' if m and m.group(1) in codes else None
        return f

    out_items = out_dir / '00_catalog' / 'items'
    out_items.mkdir(parents=True, exist_ok=True)
    out_assets = out_dir / '00_catalog' / 'assets'
    out_assets.mkdir(parents=True, exist_ok=True)
    used_assets = set()

    def tracking(fn):
        def f(url):
            r = fn(url)
            if r:
                used_assets.add(lib_name(url))
            return r
        return f

    first_props = None
    cards = []
    for it in items:
        props = page_props((data_dir / 'pages' / f'{it["code"]}.html').read_text(encoding='utf-8'), it['code'])
        first_props = first_props or props
        html_text = item_page(it['code'], props, it, prices.get(it['code'], {}), stock,
                              tracking(img_src('../')), link_href(''), None)
        (out_items / f'{it["code"]}.html').write_text(html_text, encoding='utf-8')
        main = f'02_images/{it["code"]}/{it["image_files"][0]}' if it['image_files'] else ''
        p = prices.get(it['code'], {})
        total = sum(int(stock.get(s['sku_code'], 0) or 0) for s in it['skus'])
        nrev = ((props.get('review') or {}).get('reviewSummary') or {}).get('count') or 0
        cards.append(f'<a class="card" href="00_catalog/items/{esc(it["code"])}.html">'
                     + (f'<img src="{esc(main)}" alt="" loading="lazy">' if main else '')
                     + f'<div class="t"><div class="code">{esc(it["code"])}</div><div class="name">{esc(it["name"])}</div>'
                     f'<div class="price">{esc(yen(p.get("sale-price")))}</div>'
                     f'<div class="small">SKU {len(it["skus"])}・在庫 {total}・画像 {len(it["image_files"])}枚'
                     + (f'・レビュー {nrev}件' if nrev else '') + '</div></div></a>')

    # トップページ・フッター
    links = []
    for name, path in toppages:
        body = sanitize(Path(path).read_text(encoding='utf-8'), tracking(img_src('')), link_href('items/'))
        (out_dir / '00_catalog' / f'{name}.html').write_text(
            page(name, '<p class="back"><a href="../index.html">← 商品の一覧へ</a></p>' + body, '../index.html'), encoding='utf-8')
        links.append((name, f'00_catalog/{name}.html'))
    sd = (first_props or {}).get('storeDesign') or {}
    if sd.get('footerFreeSpace') or sd.get('bannerImage'):
        body = ''
        if sd.get('bannerImage'):
            body += '<h2>ストアのバナー画像</h2>' + sanitize(f'<img src="https://shopping.c.yimg.jp/lib/{STORE}/{sd["bannerImage"]}">',
                                                             tracking(img_src('')), link_href('items/'))
        if sd.get('footerFreeSpace'):
            body += '<h2>ストアのフッター（全ページの下に出ていた部分）</h2>' + sanitize(sd['footerFreeSpace'], tracking(img_src('')), link_href('items/'))
        (out_dir / '00_catalog' / 'store_footer.html').write_text(
            page('ストアのフッター', '<p class="back"><a href="../index.html">← 商品の一覧へ</a></p>' + body, '../index.html'), encoding='utf-8')
        links.append(('store_footer', '00_catalog/store_footer.html'))

    for name in sorted(used_assets):
        src = assets_dir / name
        (out_assets / name).write_bytes(src.read_bytes())

    label = {'toppage_original': 'トップページ（元のもの）', 'toppage_closing_sale': 'トップページ（閉店セール版）',
             'store_footer': 'ストアのフッター・バナー'}
    link_html = ''.join(f'<a href="{esc(h)}">{esc(label.get(n, n))}</a>' for n, h in links)
    index = page('商品の一覧', f'<div class="note">全{len(items)}商品。商品をクリックすると、画像・価格・SKUと在庫・説明文・レビューが見られます。'
                 '価格は閉店セール前の商品CSVのセール価格です。</div>'
                 f'<div class="links">{link_html}</div><div class="grid">{"".join(cards)}</div>', 'index.html')
    (out_dir / 'index.html').write_text(index, encoding='utf-8')
    return {'items': len(items), 'assets': len(used_assets), 'pages': len(items) + len(links) + 1}


def main(argv=None):
    ap = argparse.ArgumentParser(description='ネット不要の商品カタログを作る')
    ap.add_argument('command', choices=['assets', 'build'])
    ap.add_argument('data', help='fetch_yahoo.py で取り直したデータのフォルダ（items.json, pages/, images/）')
    ap.add_argument('--extra-html', nargs='*', default=[], help='画像置き場の画像を探す追加のHTML（トップページなど）')
    ap.add_argument('--yahoo-csv')
    ap.add_argument('--stock')
    ap.add_argument('--toppage', nargs='*', default=[], help='名前=HTMLファイル')
    ap.add_argument('--out')
    ap.add_argument('--wait', type=float, default=0.3)
    a = ap.parse_args(argv)
    data = Path(a.data)
    try:
        if a.command == 'assets':
            urls = set()
            for p in sorted((data / 'pages').glob('*.html')):
                for t in store_texts(page_props(p.read_text(encoding='utf-8'), p.stem)):
                    urls |= lib_urls(t)
            for f in a.extra_html:
                urls |= lib_urls(Path(f).read_text(encoding='utf-8'))
            got, failed = download_assets(urls, data / 'lib', wait=a.wait)
            print(f'OK  画像置き場の画像 {len(got)}/{len(urls)}枚 → {data / "lib"}')
            for u, why in failed:
                print(f'    取れなかった: {u}（{why}）')
        else:
            top = [tuple(x.split('=', 1)) for x in a.toppage]
            r = build(data, a.yahoo_csv, a.stock, top, data / 'lib', a.out)
            print(f'OK  商品 {r["items"]} / 画像置き場の画像 {r["assets"]}枚 / ページ {r["pages"]} → {a.out}')
    except CatalogError as e:
        print(f'NG  {e}')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
