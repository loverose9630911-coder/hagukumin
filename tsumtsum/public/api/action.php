<?php
/**
 * プレイ中の操作をエンジンへ中継する。
 * ブラウザが送れるのは「どのツムをなぞったか」だけで、スコアは送れない。
 */
declare(strict_types=1);

require __DIR__ . '/../../src/App.php';

use Hagukumin\App;

$app = App::boot();
App::requirePost();

$sessionId = $_SESSION['engine_session'] ?? null;
if (!$sessionId) {
    App::json(['ok' => false, 'error' => 'ゲームが始まっていません', 'expired' => true], 409);
}

$in = App::input();
$type = (string)($in['type'] ?? '');

try {
    $res = match ($type) {
        'start' => $app->engine->start($sessionId),
        'state' => $app->engine->state($sessionId),
        'skill' => $app->engine->skill($sessionId),
        'bomb'  => $app->engine->bomb($sessionId, (int)($in['id'] ?? 0)),
        'chain' => $app->engine->chain($sessionId,
            array_map('intval', array_slice((array)($in['ids'] ?? []), 0, 64))),
        default => ['ok' => false, 'error' => 'しらない操作です'],
    };
} catch (RuntimeException $e) {
    App::json(['ok' => false, 'error' => 'エンジンに接続できません'], 503);
}

App::json($res);
