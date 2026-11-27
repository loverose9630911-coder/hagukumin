"""offline_catalog.py のテスト。  実行:  python3 -m unittest discover -s yahoo-backup -p 'test_*.py'"""
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import offline_catalog as oc  # noqa: E402

LIB = 'https://shopping.c.yimg.jp/lib/comburabura/'


def local_img(url):
    name = oc.lib_name(url)
    return f'assets/{name}' if name in ('a.jpg', 'bg.png') else None


def local_link(url):
    m = oc.ITEM_LINK_RE.match(url)
    return f'items/{m.group(1)}.html' if m and m.group(1) == 'bura00001' else None


def remote_refs(text):
    """src / href / url() のうち、http で始まるもの（外のサイトを読みに行くもの）"""
    return re.findall(r'(?:src|href)\s*=\s*["\']?\s*(?:https?:)?//', text, re.I) + re.findall(r'url\(\s*["\']?\s*(?:https?:)?//', text, re.I)


class LibNameTest(unittest.TestCase):
    def test_store_image_url_becomes_plain_file_name(self):
        self.assertEqual(oc.lib_name(LIB + 'magnet_168631463600.png'), 'magnet_168631463600.png')
        self.assertEqual(oc.lib_name(LIB + 'sub/dir/x.jpg'), 'sub__dir__x.jpg')

    def test_other_urls_are_not_taken(self):
        self.assertIsNone(oc.lib_name('https://shopping.c.yimg.jp/lib/otherstore/x.jpg'))
        self.assertIsNone(oc.lib_name('https://s.yimg.jp/images/x.png'))
        self.assertIsNone(oc.lib_name(LIB + '../x.png'))

    def test_urls_are_found_in_text(self):
        t = f'<img src="{LIB}a.jpg"><div style="background:url({LIB}bg.png)"></div><img src="https://s.yimg.jp/z.png">'
        self.assertEqual(oc.lib_urls(t), {LIB + 'a.jpg', LIB + 'bg.png'})


class SanitizeTest(unittest.TestCase):
    def s(self, h):
        return oc.sanitize(h, local_img, local_link)

    def test_store_image_points_to_the_saved_file(self):
        self.assertEqual(self.s(f'<img src="{LIB}a.jpg" width="100">'), '<img src="assets/a.jpg" width="100" loading="lazy">')

    def test_image_that_was_not_saved_is_shown_as_missing(self):
        out = self.s('<p><img src="https://s.yimg.jp/z.png">あ</p>')
        self.assertIn('（画像なし）', out)
        self.assertEqual(remote_refs(out), [])

    def test_scripts_frames_and_event_handlers_are_removed(self):
        out = self.s('<div onclick="x()">A<script>alert(1)</script><iframe src="https://e.com"></iframe>B</div>')
        self.assertEqual(out, '<div>AB</div>')

    def test_product_link_becomes_local_and_other_links_keep_only_text(self):
        out = self.s('<a href="https://store.shopping.yahoo.co.jp/comburabura/bura00001.html" target="_blank">商品</a>'
                     '<a href="https://store.shopping.yahoo.co.jp/comburabura/guide.html">ガイド</a>')
        self.assertEqual(out, '<a href="items/bura00001.html">商品</a><a>ガイド</a>')

    def test_background_images_in_style_are_saved_ones_or_none(self):
        out = self.s(f'<div style="background:url(\'{LIB}bg.png\');color:red"></div><div style="background:url(https://x.jp/y.png)"></div>')
        self.assertEqual(out, '<div style="background:url(assets/bg.png);color:red"></div><div style="background:none"></div>')

    def test_text_is_escaped(self):
        self.assertEqual(self.s('a &lt;b&gt; &amp; c'), 'a &lt;b&gt; &amp; c')

    def test_image_without_src_is_dropped_silently(self):
        self.assertEqual(self.s('<a><img href="https://x.jp/y" style="display:block"></a>'), '<a></a>')

    def test_unknown_tags_are_dropped_but_text_is_kept(self):
        self.assertEqual(self.s('<marquee>文字</marquee><br>'), '文字<br>')


def next_data(item, review=None, store_design=None):
    props = {'item': item, 'review': review or {'reviewSummary': {'count': 0}, 'itemReviews': []},
             'storeDesign': store_design or {}}
    return '<html><script id="__NEXT_DATA__" type="application/json">' + json.dumps({'props': {'pageProps': props}}).replace('</', '<\\/') + '</script></html>'


class BuildTest(unittest.TestCase):
    def setUp(self):
        self.d = Path(tempfile.mkdtemp())
        data = self.d / 'data'
        (data / 'pages').mkdir(parents=True)
        (data / 'lib').mkdir()
        (data / 'lib' / 'a.jpg').write_bytes(b'\xff\xd8\xffA')
        (data / 'lib' / 'unused.jpg').write_bytes(b'\xff\xd8\xffU')
        items = [{'code': 'bura00001', 'name': 'ニット', 'images': [{'file': 'bura00001_01.jpg', 'color': None}],
                  'image_files': ['bura00001_01.jpg'], 'skus': [{'sku_code': 'b1-m', 'options': {'カラー': '黒', 'サイズ': 'M'}}],
                  'option_names': ['カラー', 'サイズ'], 'category_path': ['ファッション'], 'specs': {'素材': '綿'}}]
        (data / 'items.json').write_text(json.dumps(items, ensure_ascii=False), encoding='utf-8')
        review = {'reviewSummary': {'count': 3, 'average': 4.5},
                  'itemReviews': [{'rating': 5, 'postedDate': '2024/7/7', 'body': '良い<b>', 'subCodeOptions': [{'name': 'カラー', 'value': '黒'}],
                                   'videos': [{'thumbnailUrl': 'https://yvpub.c.yimg.jp/t.jpg'}], 'maskYid': 'ma0****'}]}
        item = {'name': 'ニット', 'catchCopy': '暖かい', 'originalPriceEvidence': f'{LIB}a.jpg', 'information': f'説明<br><img src="{LIB}a.jpg"><script>x</script>',
                'freeSpace1': '<a href="https://store.shopping.yahoo.co.jp/comburabura/bura00001.html">自分</a><img src="https://s.yimg.jp/q.png">'}
        (data / 'pages' / 'bura00001.html').write_text(
            next_data(item, review, {'footerFreeSpace': f'<img src="{LIB}a.jpg">', 'bannerImage': 'a.jpg'}), encoding='utf-8')
        (self.d / 'y.csv').write_bytes('code,original-price,price,sale-price,member-price,postage-set\r\nbura00001,5970,2580,1380,,14\r\n'.encode('cp932'))
        (self.d / 's.csv').write_text('code,sub-code,quantity\nbura00001,b1-m,7\n', encoding='utf-8')
        (self.d / 'top.html').write_text(f'<div><img src="{LIB}a.jpg"><a href="https://store.shopping.yahoo.co.jp/comburabura/bura00001.html">x</a></div>', encoding='utf-8')
        self.r = oc.build(data, self.d / 'y.csv', self.d / 's.csv', [('toppage_original', self.d / 'top.html')], data / 'lib', self.d / 'out')
        self.out = self.d / 'out'

    def all_html(self):
        return {p: p.read_text(encoding='utf-8') for p in self.out.rglob('*.html')}

    def test_no_page_reads_anything_from_the_internet(self):
        for p, t in self.all_html().items():
            self.assertEqual(remote_refs(t), [], p)
            self.assertNotIn('<script', t, p)

    def test_every_local_reference_exists_when_images_folder_is_next_to_it(self):
        img = self.out / '02_images' / 'bura00001'
        img.mkdir(parents=True)
        (img / 'bura00001_01.jpg').write_bytes(b'\xff\xd8\xff')
        for p, t in self.all_html().items():
            for ref in re.findall(r'(?:src|href)="([^"#]+)"', t):
                self.assertTrue((p.parent / ref).resolve().is_file(), f'{p.name}: {ref}')

    def test_item_page_has_prices_stock_reviews_and_description(self):
        t = (self.out / '00_catalog' / 'items' / 'bura00001.html').read_text(encoding='utf-8')
        for s in ('5,970円', '1,380円', '<td>7</td>', '★★★★★', '良い&lt;b&gt;', '全3件のうち、ページに出ていた1件', '動画あり：保存していません',
                  '暖かい', '素材', '<img src="../assets/a.jpg"', '<a href="bura00001.html">自分</a>', 'originalPriceEvidence', '（画像なし）'):
            self.assertIn(s, t)
        self.assertNotIn('ma0****', t)

    def test_only_used_store_images_are_copied(self):
        self.assertEqual(sorted(p.name for p in (self.out / '00_catalog' / 'assets').iterdir()), ['a.jpg'])

    def test_index_links_to_items_and_extra_pages(self):
        t = (self.out / 'index.html').read_text(encoding='utf-8')
        self.assertIn('00_catalog/items/bura00001.html', t)
        self.assertIn('00_catalog/toppage_original.html', t)
        self.assertIn('00_catalog/store_footer.html', t)


if __name__ == '__main__':
    unittest.main()
