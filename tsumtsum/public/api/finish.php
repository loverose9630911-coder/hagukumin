<?php
/** ゲーム終了。エンジンの結果だけを信じて保存する。 */
declare(strict_types=1);

require __DIR__ . '/../../src/App.php';

use Hagukumin\App;

$app = App::boot();
App::requirePost();

$sessionId = $_SESSION['engine_session'] ?? null;
if (!$sessionId) {
    App::json(['ok' => false, 'error' => 'ゲームが始まっていません'], 409);
}

try {
    $res = $app->engine->finish($sessionId);
} catch (RuntimeException $e) {
    App::json(['ok' => false, 'error' => 'エンジンに接続できません'], 503);
}
unset($_SESSION['engine_session']);

if (empty($res['ok'])) {
    App::json(['ok' => false, 'error' => $res['error'] ?? '結果を受け取れませんでした'], 500);
}

$result = $res['result'];
$playerId = (int)$app->player['id'];
$charId = (string)$result['char_id'];

$beforeHigh = (int)$app->player['high_score'];
$beforeLevel = $app->levelOf($charId);

$player = $app->store->recordResult($app->player, $result);
$app->store->addExp($playerId, $charId, (int)$result['exp']);
$app->reloadPlayer();
$afterLevel = $app->levelOf($charId);

App::json([
    'ok' => true,
    'result' => $result,
    'new_high' => $result['score'] > $beforeHigh && $result['score'] > 0,
    'level_up' => $afterLevel > $beforeLevel ? $afterLevel + 1 : null,
    'rank' => $result['score'] > 0 ? $app->store->rankOf((int)$result['score']) : null,
    'player' => [
        'coins' => (int)$player['coins'],
        'high_score' => (int)$player['high_score'],
        'plays' => (int)$player['plays'],
    ],
    'character' => $app->character($charId),
]);
