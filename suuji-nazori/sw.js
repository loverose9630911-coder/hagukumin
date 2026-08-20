/* すうじとなかまたち Service Worker（cache-first・一度ひらけばオフラインで動く） */
var CACHE = 'suuji-v2';
var ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/img/ch-zou.png',
  'assets/img/ch-usagi.png',
  'assets/img/ch-kapibara.png',
  'assets/img/ch-kirin.png',
  'assets/img/ch-panda.png',
  'assets/img/ch-beaver.png',
  'assets/img/ch-kozou.png',
  'assets/img/apple-touch-icon.png',
  'assets/img/favicon-32.png',
  'assets/img/icon-192.png',
  'assets/img/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(function (r) {
      return r || fetch(e.request);
    })
  );
});
