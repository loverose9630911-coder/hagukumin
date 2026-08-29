<?php
/**
 * JSON API の入口。
 *
 * URL は /api/... の形。チームに属するものは全て /api/teams/{id}/... にして、
 * 入口の1か所（team()）で「そのチームのメンバーかどうか」を必ず確かめる。
 * 権限チェックの書き忘れが起きにくい形にしてある。
 */

declare(strict_types=1);

namespace Mikata;

final class Api
{
    public static function handle(string $method, string $path): void
    {
        $seg  = array_values(array_filter(explode('/', trim($path, '/')), static fn(string $s): bool => $s !== ''));
        $seg  = array_slice($seg, 1); // 先頭の "api" を落とす
        $body = self::input();

        // 画面から来た通信だけを受け付ける（他サイトからの勝手な操作よけ）。
        if ($method !== 'GET' && ($_SERVER['HTTP_X_MIKATA'] ?? '') === '') {
            throw new ApiError('不正なリクエストです', 400);
        }

        $head = $seg[0] ?? '';

        if ($head === 'auth') {
            self::auth($method, $seg[1] ?? '', $body);
            return;
        }

        if ($head === 'me' && $method === 'GET') {
            $user = Auth::current();
            self::json($user === null
                ? ['user' => null, 'teams' => []]
                : ['user' => $user, 'teams' => Teams::forUser($user['id'])]);
            return;
        }

        if ($head === 'teams') {
            self::teams($method, array_slice($seg, 1), $body);
            return;
        }

        throw new ApiError('そのURLはありません', 404);
    }

    // ---- /api/auth/* ------------------------------------------------------

    private static function auth(string $method, string $action, array $body): void
    {
        if ($method !== 'POST') {
            throw new ApiError('そのURLはありません', 404);
        }

        switch ($action) {
            case 'register':
                $user = Auth::register(
                    (string) ($body['login'] ?? ''),
                    (string) ($body['name'] ?? ''),
                    (string) ($body['password'] ?? '')
                );
                Auth::startSession($user['id']);

                // 登録と同時にチームを作る／参加する。
                $code = trim((string) ($body['join_code'] ?? ''));
                if ($code !== '') {
                    Teams::join($user['id'], $code);
                } else {
                    Teams::create($user['id'], trim((string) ($body['team_name'] ?? '')) ?: ($user['name'] . ' のチーム'));
                }

                self::json(['user' => $user, 'teams' => Teams::forUser($user['id'])]);
                return;

            case 'login':
                $user = Auth::login((string) ($body['login'] ?? ''), (string) ($body['password'] ?? ''));
                Auth::startSession($user['id']);
                self::json(['user' => $user, 'teams' => Teams::forUser($user['id'])]);
                return;

            case 'logout':
                Auth::endSession();
                self::json(['ok' => true]);
                return;
        }

        throw new ApiError('そのURLはありません', 404);
    }

    // ---- /api/teams/* -----------------------------------------------------

    private static function teams(string $method, array $seg, array $body): void
    {
        $user = Auth::require();

        // POST /api/teams … チームを新しく作る
        if ($seg === [] && $method === 'POST') {
            self::json(Teams::create($user['id'], (string) ($body['name'] ?? '')));
            return;
        }

        // POST /api/teams/join … 参加コードで入る
        if (($seg[0] ?? '') === 'join' && $method === 'POST') {
            self::json(Teams::join($user['id'], (string) ($body['join_code'] ?? '')));
            return;
        }

        $teamId = (int) ($seg[0] ?? 0);
        if ($teamId <= 0) {
            throw new ApiError('そのURLはありません', 404);
        }
        Teams::assertMember($teamId, $user['id']);

        $what = $seg[1] ?? '';
        $id   = isset($seg[2]) ? (int) $seg[2] : null;

        switch ("{$method} {$what}") {
            case 'GET bootstrap':
                self::json(self::bootstrap($teamId, $user));
                return;

            case 'GET metrics':
                self::json(Metrics::build($teamId, $user['id']));
                return;

            // --- タスク ---
            case 'GET tasks':
                self::json(['tasks' => Tasks::all($teamId)]);
                return;
            case 'POST tasks':
                self::json(['task' => Tasks::create($teamId, $user['id'], $body)], 201);
                return;
            case 'PATCH tasks':
                self::json(['task' => Tasks::update($teamId, $user['id'], self::need($id), $body)]);
                return;
            case 'DELETE tasks':
                Tasks::delete($teamId, self::need($id));
                self::json(['ok' => true]);
                return;

            // --- 目標 ---
            case 'GET goals':
                self::json(['goals' => Goals::progress(Goals::all($teamId), Tasks::all($teamId))]);
                return;
            case 'POST goals':
                self::json(['goal' => Goals::create($teamId, $user['id'], $body)], 201);
                return;
            case 'PATCH goals':
                self::json(['goal' => Goals::update($teamId, self::need($id), $body)]);
                return;
            case 'DELETE goals':
                Goals::delete($teamId, self::need($id));
                self::json(['ok' => true]);
                return;

            // --- プロジェクト（チャンネル） ---
            case 'POST projects':
                self::json(['project' => Teams::createProject($teamId, $body)], 201);
                return;
            case 'PATCH projects':
                self::json(['project' => Teams::updateProject($teamId, self::need($id), $body)]);
                return;

            // --- メンバー ---
            case 'GET members':
                self::json(['members' => Teams::members($teamId)]);
                return;
            case 'PATCH members':
                self::json(['members' => Teams::updateMember($teamId, $user['id'], self::need($id), $body)]);
                return;

            // --- 会話 ---
            case 'GET messages':
                $taskId = (int) ($_GET['task'] ?? 0);
                if ($taskId > 0) {
                    self::json(['messages' => Chat::thread($teamId, $taskId)]);
                    return;
                }
                $before = (int) ($_GET['before'] ?? 0);
                self::json([
                    'messages' => Chat::channel(
                        $teamId,
                        (int) ($_GET['project'] ?? 0),
                        $before > 0 ? $before : null
                    ),
                ]);
                return;
            case 'POST messages':
                self::json(['message' => Chat::post($teamId, $user['id'], $body)], 201);
                return;

            case 'POST read':
                Chat::markRead(
                    $teamId,
                    $user['id'],
                    (int) ($body['project_id'] ?? 0),
                    isset($body['message_id']) ? (int) $body['message_id'] : null
                );
                self::json(['unread' => Chat::unread($teamId, $user['id'])]);
                return;

            // 画面を開いている間、少しずつ新着だけを取りにくる。
            case 'GET sync':
                $since = (int) ($_GET['since'] ?? 0);
                self::json([
                    'messages'  => Chat::since($teamId, $since),
                    'latest_id' => Chat::latestId($teamId),
                    'unread'    => Chat::unread($teamId, $user['id']),
                    'mentions'  => Chat::mentions($teamId, $user['id'], $user['login']),
                ]);
                return;
        }

        throw new ApiError('そのURLはありません', 404);
    }

    /** 画面を開いたときの1回だけの読み込み。これだけで全部そろう。 */
    private static function bootstrap(int $teamId, array $user): array
    {
        $tasks = Tasks::all($teamId);

        return [
            'user'      => $user,
            'teams'     => Teams::forUser($user['id']),
            'team'      => Teams::get($teamId),
            'members'   => Teams::members($teamId),
            'projects'  => Teams::projects($teamId),
            'tasks'     => $tasks,
            'goals'     => Goals::progress(Goals::all($teamId), $tasks),
            'metrics'   => Metrics::build($teamId, $user['id']),
            'unread'    => Chat::unread($teamId, $user['id']),
            'latest_id' => Chat::latestId($teamId),
        ];
    }

    // ---- 小物 -------------------------------------------------------------

    private static function need(?int $id): int
    {
        if ($id === null || $id <= 0) {
            throw new ApiError('IDが足りません', 400);
        }
        return $id;
    }

    private static function input(): array
    {
        $raw = file_get_contents('php://input');
        if ($raw === false || trim($raw) === '') {
            return [];
        }
        $data = json_decode($raw, true);
        if (!is_array($data)) {
            throw new ApiError('送られてきたデータが読めませんでした', 400);
        }
        return $data;
    }

    public static function json(mixed $data, int $status = 200): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
}
