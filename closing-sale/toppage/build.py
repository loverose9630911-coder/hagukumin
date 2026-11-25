"""ストアのトップページのコードを作る。

original.html（今のコード）の
  1. LINE の画像の部分を、閉店セールの表示（sale-block.html）に差し替え
  2. 「もっと見る」のリンク先を、母の日特集ページからストアの商品一覧に直す
の2か所だけを変えて toppage.html に書き出す。ほかは1文字も変えない。

使い方:  python3 closing-sale/toppage/build.py
検査に外れたら toppage.html は書き出さず、終了コード 1。
"""
from html.parser import HTMLParser
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent

# 1. LINE の画像の部分（今のコードにある文字列そのまま）
LINE_BLOCK = (
    '<div style="text-align:center;"><div style="margin:0px;">'
    '<img src="https://shopping.c.yimg.jp/lib/comburabura/yahooline.png" style="max-width:100%;">'
    '</div></div>'
)

# 2. 「もっと見る」ボタン（今のコード）と、直したもの
MORE_OLD = (
    '<a href="https://shopping.yahoo.co.jp/promotion/event/seasonal/mothersday/" style="display:block; margin:16px;">'
    '<img href="https://store.shopping.yahoo.co.jp/comburabura/search.html?X=99&used=&uIv=on#CentSrchFilter1" style="display:block; margin:0px;">'
    '<img src="https://shopping.c.yimg.jp/lib/comburabura/magnet_common_bt_more.png" style="max-width:100%;"></a>'
)
MORE_NEW = (
    '<a href="https://store.shopping.yahoo.co.jp/comburabura/search.html?X=99&used=&uIv=on#CentSrchFilter1" style="display:block; margin:16px;">'
    '<img src="https://shopping.c.yimg.jp/lib/comburabura/magnet_common_bt_more.png" style="max-width:100%;"></a>'
)

REQUIRED_TEXT = [
    'CLOSING SALE', '閉店セール', '全商品', '1円', '＋送料1,000円', '（1点ごと）',
    'お支払いは1点につき1,001円', '11.25 WED', '11.30 MON', '17:00', 'まで',
    '長い間ありがとうございました', 'Office Casual Bura.bura', '商品一覧を見る',
]
FORBIDDEN_TEXT = ['1,500', '1,501', '11.24', 'TUE', '15:00']
FORBIDDEN_IN_BLOCK = ['<script', '<style', '<link', 'class=', ' id=', 'javascript:']
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'}


class Checker(HTMLParser):
    """開きタグと閉じタグの対応、本文の文字を集める。"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.problems, self.text = [], [], []

    def handle_starttag(self, tag, attrs):
        if tag == 'img' and not dict(attrs).get('src'):
            self.problems.append('src の無い img がある')
        if tag not in VOID:
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if not self.stack or self.stack[-1] != tag:
            self.problems.append(f'閉じタグが合わない: </{tag}>（開いているのは {self.stack[-1:] or "なし"}）')
            return
        self.stack.pop()

    def handle_data(self, data):
        self.text.append(data)


def check_html(html, label):
    c = Checker()
    c.feed(html)
    c.close()
    problems = [f'{label}: {p}' for p in c.problems]
    if c.stack:
        problems.append(f'{label}: 閉じていないタグ {c.stack}')
    return problems, ''.join(c.text)


def main():
    original = (HERE / 'original.html').read_text(encoding='utf-8').rstrip('\n')
    block_src = (HERE / 'sale-block.html').read_text(encoding='utf-8').strip()
    # 改行と字下げは読みやすさのためだけなので、タグの間の改行ごと取り除く
    block = re.sub(r'>\s*\n\s*<', '><', block_src)

    problems = []
    for name, s in (('LINE の部分', LINE_BLOCK), ('もっと見る', MORE_OLD)):
        n = original.count(s)
        if n != 1:
            problems.append(f'今のコードに「{name}」がちょうど1か所ありません（{n}か所）')
    if problems:
        print('NG'); [print('  -', p) for p in problems]; return 1

    out = original.replace(LINE_BLOCK, block).replace(MORE_OLD, MORE_NEW)

    # 変えたのは2か所だけ（元に戻すと今のコードと完全に一致する）
    if out.replace(block, LINE_BLOCK).replace(MORE_NEW, MORE_OLD) != original:
        problems.append('2か所以外にも変わったところがある')
    for s in ('yahooline.png', 'mothersday', '<img href'):
        if s in out:
            problems.append(f'残っていてはいけないものがある: {s}')
    for s in FORBIDDEN_IN_BLOCK:
        if s in block:
            problems.append(f'セールの表示に使えない書き方がある: {s}')

    p1, block_text = check_html(block, 'セールの表示')
    p2, _ = check_html(out, 'ページ全体')
    problems += p1 + p2
    flat = block_text.replace('\n', '')
    for t in REQUIRED_TEXT:
        if t not in flat:
            problems.append(f'文言が見つからない: {t}')
    for t in FORBIDDEN_TEXT:
        if t in out:
            problems.append(f'入れてはいけない文言がある: {t}')

    if problems:
        print('NG（toppage.html は書き出していません）')
        for p in problems:
            print('  -', p)
        return 1
    (HERE / 'toppage.html').write_text(out + '\n', encoding='utf-8')
    print(f'OK  toppage.html を書き出しました（{len(out):,}文字。変えたのは LINE の部分と「もっと見る」の2か所）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
