<?php
/**
 * 入口。
 *
 *   /api/...   → JSON の API（src/Api.php）
 *   /a/{token} → 画像そのもの（ログイン不要。外部サービスが取りに来るため）
 *   それ以外    → 画面のガワ（HTML）。中身は JavaScript が組み立てる。
 *
 * PHP の内蔵サーバー（php -S）ではこのファイルをルーターとして使うので、
 * 実在するファイル（CSS や JS）はそのまま返してもらうようにしている。
 */

declare(strict_types=1);

date_default_timezone_set(getenv('CANTER_TZ') ?: 'Asia/Tokyo');
mb_internal_encoding('UTF-8');

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

if (PHP_SAPI === 'cli-server') {
    $file = __DIR__ . $path;
    if ($path !== '/' && is_file($file) && realpath($file) !== __FILE__) {
        return false;   // CSS・JS・画像は内蔵サーバーにそのまま返してもらう
    }
}

spl_autoload_register(static function (string $class): void {
    if (!str_starts_with($class, 'Canter\\')) {
        return;
    }
    $rel  = str_replace('\\', '/', substr($class, 7));
    $file = dirname(__DIR__) . '/src/' . $rel . '.php';
    if (is_file($file)) {
        require_once $file;
    }
});

use Canter\Api;
use Canter\ApiError;
use Canter\Assets;

if (str_starts_with($path, '/api/')) {
    try {
        Api::handle($_SERVER['REQUEST_METHOD'] ?? 'GET', $path);
    } catch (ApiError $e) {
        Api::json(['error' => $e->getMessage()], $e->status());
    } catch (Throwable $e) {
        error_log('[canter] ' . $e::class . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
        Api::json(['error' => 'サーバー側でエラーが起きました'], 500);
    }
    exit;
}

// 画像そのもの。Instagram・Threads・Notion がここに取りに来る。
if (preg_match('#\A/a/([0-9a-f]{32})\z#', $path, $m) === 1) {
    Assets::serve($m[1]);
    exit;
}

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-cache');
?>
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>canter ― つくって、そのまま出す</title>
<meta name="description" content="イラストレーターのような正確さと、キャンバのような手軽さを1つにしたデザイン道具。作った絵を Instagram・X・Threads・Notion・note・ミカタへそのまま出せます。">
<meta name="theme-color" content="#1f2430">
<meta name="color-scheme" content="light dark">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
<link rel="icon" href="/assets/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="stylesheet" href="/assets/css/app.css?v=1">
</head>
<body>
<div id="app" class="app-boot">
  <div class="boot">
    <img class="boot-mark" src="/assets/icon.svg" width="64" height="64" alt="" aria-hidden="true">
    <p>読みこんでいます…</p>
  </div>
</div>
<noscript>
  <p style="padding:24px;font-family:system-ui">この道具は JavaScript が必要です。ブラウザの設定で有効にしてください。</p>
</noscript>
<script type="module" src="/assets/js/app.js?v=1"></script>
</body>
</html>
