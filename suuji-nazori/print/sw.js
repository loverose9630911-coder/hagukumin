/*
 * おもいでプリント Service Worker（/print/ の中だけを受け持つ）
 *
 * ・一度ひらくと画面のファイルを端末に保存し、次からは保存分ですぐ立ち上がる（電波がなくても開ける）
 * ・裏で最新版を取りに行き、新しい版は「次にひらいたとき」に反映される
 * ・写真は扱わない（写真はブラウザの中の blob: で、ここは通らない）
 *
 * 画面のファイルを足したり消したりしたときだけ、ASSETS と CACHE の番号を変える。
 */
var CACHE = 'omoide-v1';
var PREFIX = 'omoide-';
var ASSETS = [
  './',
  'index.html',
  'core.js',
  'app.js',
  'manifest.webmanifest',
  'img/icon-192.png',
  'img/icon-512.png',
  'img/apple-touch-icon.png',
  'img/favicon-32.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  // 消すのは、このアプリの古い保存分だけ（すうじ・ひらがなアプリの保存分にはさわらない）
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k.indexOf(PREFIX) === 0 && k !== CACHE; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf(new URL('./', self.location).pathname) !== 0) return;

  // 保存分があればすぐ返し、裏で最新版に入れかえる（次にひらいたときに反映）
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(req, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') c.put(req, res.clone());
        return res;
      }).catch(function () {
        if (hit) return hit;
        if (req.mode === 'navigate') return c.match('./');
        return Response.error();
      });
      if (hit) { e.waitUntil(net.catch(function () {})); return hit; }
      return net;
    });
  }));
});
