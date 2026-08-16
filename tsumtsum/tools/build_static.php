<?php
/**
 * 静的サイト（オフライン PWA）版を dist/ に書き出す。
 *
 *   php tools/build_static.php
 *
 * できあがった dist/ フォルダをまるごと Netlify にドラッグ＆ドロップすれば公開できる。
 * サーバー（PHP / Python）は要らず、ゲームのルールはブラウザ内エンジン
 * （assets/js/engine-local.js）が Python と同じ手順・同じ数値で動かす。
 */

declare(strict_types=1);

$root = dirname(__DIR__);
$dist = $root . '/dist';

$configPath = $root . '/public/assets/config.json';
$spritesPath = $root . '/public/assets/sprites.json';
foreach ([$configPath, $spritesPath] as $need) {
    if (!is_file($need)) {
        fwrite(STDERR, basename($need) . " がありません。先に `make assets` を実行してください。\n");
        exit(1);
    }
}
$config = json_decode((string)file_get_contents($configPath), true);
$sprites = json_decode((string)file_get_contents($spritesPath), true);

/* ---------------------------------------------------------------- 出力先 */

rrmdir($dist);
mkdir($dist . '/assets/js', 0775, true);
mkdir($dist . '/assets/css', 0775, true);
mkdir($dist . '/assets/img', 0775, true);

$jsFiles = ['engine-local.js', 'audio.js', 'client.js', 'shell.js'];
foreach ($jsFiles as $name) {
    copy($root . '/public/assets/js/' . $name, $dist . '/assets/js/' . $name);
}
copy($root . '/public/assets/css/app.css', $dist . '/assets/css/app.css');

$images = [];
foreach (glob($root . '/public/assets/img/*.png') as $png) {
    copy($png, $dist . '/assets/img/' . basename($png));
    $images[] = 'assets/img/' . basename($png);
}

/* ---------------------------------------------------------------- index.html */

$boot = [
    'characters' => $config['characters'],
    'field' => $config['field'],
    'rules' => $config['rules'],
    'sprites' => $sprites,
];
$bootJson = json_encode($boot, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG);
$configJson = json_encode($config, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG);
$rules = $config['rules'];

$scripts = '';
foreach ($jsFiles as $name) {
    $scripts .= '<script src="assets/js/' . $name . '"></script>' . "\n";
}

$html = <<<HTML
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#8FD3F4">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="ぞうさんとなかまたち">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="description" content="ぞうさんとなかまたち ― 自作の どうぶつキャラで つなげて消す パズルゲーム。">
<title>ぞうさんとなかまたち</title>
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="assets/img/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png">
<link rel="stylesheet" href="assets/css/app.css">
</head>
<body class="shell">
<div id="stage">
  <canvas id="cv"></canvas>

  <div id="hud">
    <div class="hud-top">
      <div class="hud-left">
        <div class="score-label">SCORE</div>
        <div class="score-value" id="hud-score">0</div>
        <div class="combo" id="hud-combo">
          <span class="combo-num" id="hud-combo-num">0</span><span class="combo-txt">Combo</span>
        </div>
      </div>
      <div class="hud-right">
        <div class="hud-buttons">
          <button class="icon-btn" id="btn-sound" aria-label="おとの オンオフ">♪</button>
          <button class="icon-btn" id="btn-quit" aria-label="やめる">×</button>
        </div>
        <div class="timer" id="hud-timer">
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <circle class="t-bg" cx="50" cy="50" r="42"></circle>
            <circle class="t-fg" id="hud-timer-arc" cx="50" cy="50" r="42"></circle>
          </svg>
          <span id="hud-time">60</span>
        </div>
      </div>
    </div>

    <div class="fever-wrap">
      <div class="fever-label">FEVER</div>
      <div class="fever-bar"><i id="hud-fever-bar"></i></div>
    </div>

    <button class="skill-btn locked" id="btn-skill">
      <span class="skill-ring"><svg viewBox="0 0 100 100" aria-hidden="true">
        <circle class="s-bg" cx="50" cy="50" r="44"></circle>
        <circle class="s-fg" id="hud-skill-arc" cx="50" cy="50" r="44"></circle>
      </svg></span>
      <span class="skill-icon" id="hud-skill-icon"></span>
      <span class="skill-text" id="hud-skill-text">スキル</span>
    </button>
  </div>

  <section class="screen center" id="scr-title">
    <div class="title-deco" id="title-deco"></div>
    <h1 class="logo"><span>ぞうさんと</span><em>なかまたち</em></h1>
    <p class="tagline">つないで、はじけて、なかよくなろう！</p>
    <div class="stat-row">
      <div><b id="t-high">0</b><span>ハイスコア</span></div>
      <div><b id="t-coin">0</b><span>コイン</span></div>
      <div><b id="t-plays">0</b><span>プレイ</span></div>
    </div>
    <div class="picked" id="picked"></div>
    <div class="btn-col">
      <button class="btn primary" id="btn-play">ゲームスタート</button>
      <button class="btn" id="btn-chars">キャラクター</button>
      <button class="btn" id="btn-rank">ランキング</button>
      <button class="btn ghost" id="btn-help">あそびかた</button>
    </div>
    <form class="name-form" id="name-form">
      <label for="name-input">なまえ</label>
      <input type="text" id="name-input" maxlength="12" value="ななしさん">
      <button type="submit">かえる</button>
    </form>
  </section>

  <section class="screen" id="scr-chars">
    <header class="sc-head">
      <button class="back" id="btn-back-chars">‹</button>
      <h2>キャラクター</h2>
      <div class="coin-pill"><i></i><span id="s-coin">0</span></div>
    </header>
    <div class="char-list" id="char-list"></div>
    <div class="sc-foot"><button class="btn primary" id="btn-play2">このキャラで あそぶ</button></div>
  </section>

  <section class="screen" id="scr-rank">
    <header class="sc-head">
      <button class="back" id="btn-back-rank">‹</button>
      <h2>ランキング</h2>
      <div style="width:44px"></div>
    </header>
    <div id="rank-body" style="flex:1;overflow-y:auto"></div>
  </section>

  <section class="screen" id="scr-help">
    <header class="sc-head">
      <button class="back" id="btn-back-help">‹</button>
      <h2>あそびかた</h2>
      <div style="width:44px"></div>
    </header>
    <div class="help-body">
      <div class="help-item"><b>1. なぞって つなげる</b>
        <p>おなじ どうぶつの ツムを <b>3こ いじょう</b> なぞって はなすと 消えます。となり どうしの ツムだけ つながります。</p></div>
      <div class="help-item"><b>2. コンボを つなげる</b>
        <p>つづけて 消すと コンボが ふえて、スコアの ばいりつが アップ。{$rules['combo_hold']}びょう いないに つぎを 消そう！</p></div>
      <div class="help-item"><b>3. ボムを つくる</b>
        <p><b>{$rules['bomb_chain']}こ いじょう</b> つなげると ボムが でます。タップすると まわりの ツムを まとめて 消します。<br>
        <b>{$rules['time_bomb_chain']}こ いじょう</b> なら タイムボム！ こわすと のこり じかんが +{$rules['time_bomb_bonus']}びょう。</p></div>
      <div class="help-item"><b>4. スキルを つかう</b>
        <p>えらんだ どうぶつの ツムを 消すと、みぎ下の スキルゲージが たまります。光ったら タップして はつどう！</p></div>
      <div class="help-item"><b>5. フィーバー</b>
        <p>ツムを 消すと 上の ゲージが たまり、まんタンで <b>FEVER</b>！ {$rules['fever_time']}びょうかん スコアが 2ばいに なります。</p></div>
      <div class="help-item"><b>6. コインで なかまを ふやす</b>
        <p>あそぶと もらえる コインで、あたらしい どうぶつを おむかえ できます。つかうほど レベルが 上がって スキルが つよくなります。</p></div>
    </div>
  </section>

  <section class="screen dim" id="scr-result">
    <div class="panel result">
      <div class="res-badge" id="res-badge">RESULT</div>
      <div class="res-score" id="res-score">0</div>
      <div class="res-char" id="res-char"></div>
      <ul class="res-list">
        <li><span>さいだい コンボ</span><b id="res-combo">0</b></li>
        <li><span>消した ツム</span><b id="res-tsum">0</b></li>
        <li><span>フィーバー</span><b id="res-fever">0</b></li>
        <li><span>スキル はつどう</span><b id="res-skill">0</b></li>
        <li><span>ランキング</span><b id="res-rank">-</b></li>
        <li class="coin"><span>もらえる コイン</span><b id="res-coin">0</b></li>
      </ul>
      <div class="res-level" id="res-level"></div>
      <div class="btn-col">
        <button class="btn primary" id="btn-retry">もういちど</button>
        <button class="btn ghost" id="btn-home">ホームへ</button>
      </div>
    </div>
  </section>

  <div id="toast"></div>
</div>

<script>
window.SHELL_MODE = true;
window.CONFIG = {$configJson};
window.BOOT = {$bootJson};
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () { /* オフライン化できなくても遊べる */ });
  });
}
</script>
{$scripts}
</body>
</html>

HTML;

file_put_contents($dist . '/index.html', $html);

/* ---------------------------------------------------------------- manifest */

$manifest = [
    'name' => 'ぞうさんとなかまたち',
    'short_name' => 'ぞうさん',
    'description' => '自作の どうぶつキャラで つなげて消す パズルゲーム。',
    'lang' => 'ja',
    'start_url' => './index.html',
    'scope' => './',
    'display' => 'fullscreen',
    'orientation' => 'portrait',
    'background_color' => '#221D30',
    'theme_color' => '#8FD3F4',
    'icons' => [
        ['src' => 'assets/img/icon-192.png', 'sizes' => '192x192', 'type' => 'image/png', 'purpose' => 'any'],
        ['src' => 'assets/img/icon-512.png', 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'any'],
        ['src' => 'assets/img/icon-512.png', 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'maskable'],
    ],
];
file_put_contents($dist . '/manifest.webmanifest',
    json_encode($manifest, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT) . "\n");

/* ---------------------------------------------------------------- Service Worker */

$assets = array_merge(
    ['./', 'index.html', 'manifest.webmanifest', 'assets/css/app.css'],
    array_map(fn($n) => 'assets/js/' . $n, $jsFiles),
    $images
);
// 中身が変わったら自動でキャッシュを入れ替えるためのハッシュ
$stamp = substr(hash('sha256', implode('|', array_map(
    fn($f) => is_file($dist . '/' . $f) ? (string)filesize($dist . '/' . $f) : $f, $assets))), 0, 12);
$assetList = json_encode($assets, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);

$sw = <<<JS
/* ぞうさんとなかまたち ― オフライン用のキャッシュ
 * 一度ひらけば、あとは機内モードでも遊べます。
 */
var CACHE = 'zousan-{$stamp}';
var ASSETS = {$assetList};

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

JS;
file_put_contents($dist . '/sw.js', $sw);

/* ---------------------------------------------------------------- おわり */

$total = 0;
foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dist)) as $file) {
    if ($file->isFile()) {
        $total += $file->getSize();
    }
}
printf("dist/ を作りました（%d ファイル / %.1f MB）\n",
    iterator_count(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dist,
        FilesystemIterator::SKIP_DOTS))), $total / 1024 / 1024);
echo "そのまま Netlify にドラッグ＆ドロップすれば公開できます。\n";


function rrmdir(string $dir): void
{
    if (!is_dir($dir)) {
        return;
    }
    $items = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($items as $item) {
        $item->isDir() ? rmdir($item->getPathname()) : unlink($item->getPathname());
    }
    rmdir($dir);
}
