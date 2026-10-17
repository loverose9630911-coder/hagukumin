"""page.html（アプリ本体）から、ホーム画面に置ける版の index.html と sw.js を作る。

page.html は claude.ai のリンク版と同じ中身。直すときは page.html だけを直し、
このスクリプトを実行する。

使い方:
  python3 build.py           index.html と sw.js を書き出す
  python3 build.py --check   書き出し済みのものが page.html と合っているか確かめる（合っていなければ終了コード1）
"""
import hashlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(HERE, "page.html")
INDEX = os.path.join(HERE, "index.html")
SW = os.path.join(HERE, "sw.js")

HEAD = """<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="description" content="購買管理スタッフとして入社後1年の進め方と、取適法の浸透プラン">
<meta name="theme-color" content="#EEF1F5" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#11161D" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="購買プラン">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<link rel="icon" type="image/png" href="icons/icon-192.png">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style>
"""

REGISTER_SW = """<script>
if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
  navigator.serviceWorker.register("sw.js").catch(function () {});
}
</script>
"""

SW_TEMPLATE = """// ホーム画面版のオフライン対応。build.py が書き出すので、直接は直さない。
const VERSION = "kobai-plan-__VERSION__";
const PRECACHE = ["./", "index.html", "manifest.webmanifest", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png"];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // 画面本体：電波があれば最新を取り、なければ保存しておいたものを出す
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put("index.html", copy)); return res; })
        .catch(() => caches.match("index.html"))
    );
    return;
  }

  // 文字のフォント：保存しておいたものを先に出し、裏で新しくする
  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.open(VERSION).then((c) => c.match(req).then((hit) => {
        const net = fetch(req).then((res) => { c.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || net;
      }))
    );
    return;
  }

  // アイコンなど同じサイトのファイル
  if (url.origin === self.location.origin) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});
"""


def render():
    page = open(PAGE, encoding="utf-8").read()
    cut = page.find("</style>")
    if not page.startswith("<title>") or cut < 0:
        sys.exit("page.html の先頭が <title> で始まり、<style> を含む形になっていません")
    cut += len("</style>")
    head_part, body_part = page[:cut], page[cut:]
    index = HEAD + head_part + "\n</head>\n<body>" + body_part.rstrip("\n") + "\n" + REGISTER_SW + "</body>\n</html>\n"
    version = hashlib.sha256(index.encode("utf-8")).hexdigest()[:12]
    sw = SW_TEMPLATE.replace("__VERSION__", version)
    return index, sw


def main():
    index, sw = render()
    if "--check" in sys.argv:
        stale = [p for p, want in ((INDEX, index), (SW, sw))
                 if not os.path.exists(p) or open(p, encoding="utf-8").read() != want]
        if stale:
            print("古いまま:", ", ".join(os.path.basename(p) for p in stale), "→ python3 build.py を実行してください")
            sys.exit(1)
        print("index.html と sw.js は page.html と合っています")
        return
    for path, text in ((INDEX, index), (SW, sw)):
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        print("wrote", os.path.basename(path))


if __name__ == "__main__":
    main()
