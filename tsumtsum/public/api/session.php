<?php
/** 新しいゲームを始める（エンジンにセッションを作らせる） */
declare(strict_types=1);

require __DIR__ . '/../../src/App.php';

use Doubutsu\App;

$app = App::boot();
App::requirePost();

$in = App::input();
$height = (float)($in['height'] ?? 1080);
$charId = $app->selectedId();

try {
    $res = $app->engine->newSession($charId, $app->levelOf($charId), $height);
} catch (RuntimeException $e) {
    App::json(['ok' => false, 'error' => 'ゲームエンジンが起動していません（bin/serve で起動してください）'], 503);
}
if (empty($res['ok'])) {
    App::json(['ok' => false, 'error' => $res['error'] ?? 'セッションを作れませんでした'], 500);
}

$_SESSION['engine_session'] = $res['session_id'];
$_SESSION['engine_char'] = $charId;

$character = $app->character($charId);
$res['character'] = $character;
$res['level'] = $app->levelOf($charId);
unset($res['session_id']);          // ブラウザには渡さない（サーバー側だけで持つ）
App::json($res);
