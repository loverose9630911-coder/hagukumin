/* ぞうさんとなかまたち ― オフライン用のキャッシュ
 * 一度ひらけば、あとは機内モードでも遊べます。
 */
var CACHE = 'zousan-5aefb72aa1eb';
var ASSETS = [
    "./",
    "index.html",
    "manifest.webmanifest",
    "assets/css/app.css",
    "assets/js/engine-local.js",
    "assets/js/audio.js",
    "assets/js/client.js",
    "assets/js/shell.js",
    "assets/img/apple-touch-icon.png",
    "assets/img/bomb.png",
    "assets/img/bomb_time.png",
    "assets/img/favicon-32.png",
    "assets/img/icon-192.png",
    "assets/img/icon-512.png",
    "assets/img/tsum_beaver.png",
    "assets/img/tsum_kapibara.png",
    "assets/img/tsum_kirin.png",
    "assets/img/tsum_panda.png",
    "assets/img/tsum_usagi.png",
    "assets/img/tsum_zou.png"
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        return key === CACHE ? null : caches.delete(key);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(function (hit) {
      return hit || fetch(event.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put(event.request, copy); });
        return res;
      }).catch(function () { return caches.match('index.html'); });
    })
  );
});
