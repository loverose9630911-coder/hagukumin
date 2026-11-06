"""claude.ai の Artifact（スマホでリンクを開くだけで使えるページ）用に、
index.html / app.css / content.js / app.js を1ファイルにまとめる。

使い方:  python3 tools/build_artifact.py 出力先.html
（fuso-kobai フォルダの中で実行。出力先を省略すると dist/kobai-startbook.html）

Artifact の決まりに合わせて、次のように変えている。
  - <!doctype>・<html>・<head>・<body> は書かない（公開時に自動で付く）
  - Service Worker は使えないので登録しない（KOBAI_NO_SW）
  - 画面の端（ノッチ・ホームバー）の余白を Artifact の方式に合わせる
"""
import os, re, sys

here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, 'dist', 'kobai-startbook.html')

def read(name):
    with open(os.path.join(here, name), encoding='utf-8') as f:
        return f.read()

index = read('index.html')
body = index.split('<body>', 1)[1].split('<script', 1)[0].strip()
css = read('app.css')
for name in ('content.js', 'app.js'):
    if '</script' in read(name).lower():
        sys.exit(name + ' に </script が含まれているため1ファイル化できません')

override = """
/* ── Artifact 用の上書き（画面端の余白） ── */
body::before{content:"";position:fixed;inset:0 0 auto;height:env(safe-area-inset-top,0px);z-index:30;background:var(--brand)}
.topbar{top:env(safe-area-inset-top,0px);padding-top:0;
  padding-left:max(12px,env(safe-area-inset-left,0px));padding-right:max(12px,env(safe-area-inset-right,0px))}
main{padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.tabbar{padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px)}
@media (min-width:720px){main{padding-left:max(24px,env(safe-area-inset-left,0px));padding-right:max(24px,env(safe-area-inset-right,0px))}}
"""

html = (
    '<title>購買スタートブック</title>\n'
    '<meta name="claude:viewport-fit-sides" content="cover">\n'
    '<meta name="description" content="取適法・三菱ふそうの歴史・購買の心得をスマホで学ぶ非公式の学習アプリ">\n'
    '<style>\n' + css + override + '</style>\n'
    + body + '\n'
    '<script>window.KOBAI_NO_SW = true;</script>\n'
    '<script>\n' + read('content.js') + '\n</script>\n'
    '<script>\n' + read('app.js') + '\n</script>\n'
)
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)
print('作成しました:', out, '(' + str(len(html.encode('utf-8'))) + ' バイト)')
