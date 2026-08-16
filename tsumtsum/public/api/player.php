<?php
/** キャラの購入・選択・なまえの変更 */
declare(strict_types=1);

require __DIR__ . '/../../src/App.php';

use Hagukumin\App;

$app = App::boot();
App::requirePost();

$in = App::input();
$action = (string)($in['action'] ?? '');
$playerId = (int)$app->player['id'];

switch ($action) {
    case 'buy':
        $char = $app->character((string)($in['char_id'] ?? ''));
        if (!$char) {
            App::json(['ok' => false, 'error' => 'そのキャラは いません'], 400);
        }
        if ($app->store->owns($playerId, $char['id'])) {
            App::json(['ok' => false, 'error' => 'すでに おむかえずみです'], 409);
        }
        if (!$app->store->buy($playerId, $char['id'], (int)$char['price'])) {
            App::json(['ok' => false, 'error' => 'コインが たりません'], 402);
        }
        $app->store->select($playerId, $char['id']);
        $app->reloadPlayer();
        App::json(['ok' => true, 'coins' => (int)$app->player['coins'],
                   'message' => $char['name'] . 'を おむかえしました！']);

    case 'select':
        $char = $app->character((string)($in['char_id'] ?? ''));
        if (!$char || !$app->store->owns($playerId, $char['id'])) {
            App::json(['ok' => false, 'error' => 'そのキャラは まだ つかえません'], 403);
        }
        $app->store->select($playerId, $char['id']);
        App::json(['ok' => true, 'selected' => $char['id']]);

    case 'rename':
        $app->store->rename($playerId, (string)($in['name'] ?? ''));
        $app->reloadPlayer();
        App::json(['ok' => true, 'name' => $app->player['name']]);

    default:
        App::json(['ok' => false, 'error' => 'しらない操作です'], 400);
}
