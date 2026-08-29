<?php
/**
 * 入口。
 *
 *   /api/...  → JSON の API（src/Api.php）
 *   それ以外   → 画面のガワ（HTML）を返す。中身は JavaScript が組み立てる。
 *
 * PHP の内蔵サーバー（php -S）ではこのファイルをルーターとして使うので、
 * 実在するファイル（CSS や JS）はそのまま返してもらうようにしている。
 */

declare(strict_types=1);

date_default_timezone_set(getenv('MIKATA_TZ') ?: 'Asia/Tokyo');
mb_internal_encoding('UTF-8');

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

if (PHP_SAPI === 'cli-server') {
    $file = __DIR__ . $path;
    if ($path !== '/' && is_file($file) && realpath($file) !== __FILE__) {
        return false; // CSS・JS・画像は内蔵サーバーにそのまま返してもらう
    }
}

spl_autoload_register(static function (string $class): void {
    if (!str_starts_with($class, 'Mikata\\')) {
        return;
    }
    $file = dirname(__DIR__) . '/src/' . substr($class, 7) . '.php';
    if (is_file($file)) {
        require_once $file;
    }
});

use Mikata\Api;
use Mikata\ApiError;

if (str_starts_with($path, '/api/')) {
    try {
        Api::handle($_SERVER['REQUEST_METHOD'] ?? 'GET', $path);
    } catch (ApiError $e) {
        Api::json(['error' => $e->getMessage()], $e->status());
    } catch (Throwable $e) {
        error_log('[mikata] ' . $e::class . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
        Api::json(['error' => 'サーバー側でエラーが起きました'], 500);
    }
    exit;
}

// 画面のガワ。ここから先は public/assets/js/app.js が組み立てる。
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-cache');
?>
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>ミカタ ― チームと個人のタスクを1枚で</title>
<meta name="description" content="Notion のようなタスク管理と、Slack のような会話をひとつにしたチームタスクアプリ。個人とチームの進み具合・目標値・納期を1枚で見えるようにします。">
<meta name="theme-color" content="#111827">
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
    <img class="boot-mark" src="/assets/icon.svg" width="56" height="56" alt="" aria-hidden="true">
    <p>読みこんでいます…</p>
  </div>
</div>
<noscript>
  <p style="padding:24px;font-family:system-ui">このアプリは JavaScript が必要です。ブラウザの設定で有効にしてください。</p>
</noscript>
<script type="module" src="/assets/js/app.js?v=1"></script>
</body>
</html>
