/* 購買スタートブック Service Worker
 * 一度ひらけば電波がなくても読めるように、全ファイルを端末に保存する。
 * 本文を直したら CACHE の番号を上げる（例 v1 → v2）と、利用者の端末も新しい内容に入れ替わる。 */
var CACHE = 'kobai-startbook-v2';
var ASSETS = [
  './', 'index.html', 'app.css', 'app.js', 'content.js', 'manifest.webmanifest',
  'img/icon-192.png', 'img/icon-512.png', 'img/apple-touch-icon.png', 'img/favicon-32.png'
];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
/* 同じサイト内のファイルだけ扱う。ネットにつながれば最新を取り、つながらなければ保存分を返す */
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () {
      return caches.match(e.request, { ignoreSearch: true }).then(function (r) { return r || caches.match('index.html'); });
    })
  );
});
