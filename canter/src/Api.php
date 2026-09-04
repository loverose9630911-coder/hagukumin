<?php
/**
 * JSON API の入口。
 *
 * ワークスペースに属するものは全部 /api/workspaces/{id}/... の形にして、
 * 入口の1か所（workspace()）で「そのワークスペースのメンバーか」を必ず確かめる。
 * 権限チェックの書き忘れが起きにくい形にしてある。
 */

declare(strict_types=1);

namespace Canter;

final class Api
{
    public static function handle(string $method, string $path): void
    {
        $seg = array_values(array_filter(explode('/', trim($path, '/')), static fn(string $s): bool => $s !== ''));
        $seg = array_slice($seg, 1);   // 先頭の "api" を落とす
        $body = self::input();

        // 画面から来た通信だけを受け付ける（他サイトからの勝手な操作よけ）。
        if ($method !== 'GET' && ($_SERVER['HTTP_X_CANTER'] ?? '') === '') {
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
                ? ['user' => null, 'workspaces' => []]
                : ['user' => $user, 'workspaces' => Workspaces::forUser($user['id'])]);
            return;
        }

        // テンプレート・接続できるサービスの一覧。ログインしていなくても読める（秘密は無い）。
        if ($head === 'catalog' && $method === 'GET') {
            self::json([
                'templates'    => Templates::all(),
                'connectors'   => Connections::catalog(),
                'reachability' => Assets::reachability(),
                'limits'       => [
                    'max_nodes'  => Doc::MAX_NODES,
                    'max_bytes'  => Doc::MAX_BYTES,
                    'max_upload' => Assets::MAX_BYTES,
                ],
            ]);
            return;
        }

        if ($head === 'workspaces') {
            self::workspaces($method, array_slice($seg, 1), $body);
            return;
        }

        throw new ApiError('そのURLはありません', 404);
    }

    // ---- /api/auth/* --------------------------------------------------------

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

                $code = trim((string) ($body['join_code'] ?? ''));
                if ($code !== '') {
                    Workspaces::join($user['id'], $code);
                } else {
                    Workspaces::create($user['id'], trim((string) ($body['workspace_name'] ?? '')) ?: ($user['name'] . ' のワークスペース'));
                }

                self::json(['user' => $user, 'workspaces' => Workspaces::forUser($user['id'])]);
                return;

            case 'login':
                $user = Auth::login((string) ($body['login'] ?? ''), (string) ($body['password'] ?? ''));
                Auth::startSession($user['id']);
                self::json(['user' => $user, 'workspaces' => Workspaces::forUser($user['id'])]);
                return;

            case 'logout':
                Auth::endSession();
                self::json(['ok' => true]);
                return;
        }

        throw new ApiError('そのURLはありません', 404);
    }

    // ---- /api/workspaces/* --------------------------------------------------

    private static function workspaces(string $method, array $seg, array $body): void
    {
        $user = Auth::require();

        if ($seg === [] && $method === 'POST') {
            self::json(Workspaces::create($user['id'], (string) ($body['name'] ?? '')), 201);
            return;
        }

        if (($seg[0] ?? '') === 'join' && $method === 'POST') {
            self::json(Workspaces::join($user['id'], (string) ($body['join_code'] ?? '')));
            return;
        }

        $wsId = (int) ($seg[0] ?? 0);
        if ($wsId <= 0) {
            throw new ApiError('そのURLはありません', 404);
        }
        Workspaces::assertMember($wsId, $user['id']);

        $what = $seg[1] ?? '';
        $id   = isset($seg[2]) ? (int) $seg[2] : null;
        $act  = $seg[3] ?? '';

        // ---- 一気読み ----
        if ($what === 'bootstrap' && $method === 'GET') {
            self::json([
                'user'       => $user,
                'workspaces' => Workspaces::forUser($user['id']),
                'workspace'  => Workspaces::get($wsId),
                'members'    => Workspaces::members($wsId),
                'brand'      => Workspaces::brand($wsId),
                'designs'    => Designs::list($wsId),
                'assets'     => Assets::library($wsId),
                'connections'=> Connections::list($wsId),
                'posts'      => Publish::list($wsId, 40),
            ]);
            return;
        }

        // ---- デザイン ----
        if ($what === 'designs') {
            if ($id === null) {
                if ($method === 'GET') {
                    self::json(['designs' => Designs::list($wsId, !empty($_GET['archived']), (string) ($_GET['q'] ?? ''))]);
                    return;
                }
                if ($method === 'POST') {
                    self::json(['design' => Designs::create($wsId, $user['id'], $body)], 201);
                    return;
                }
                throw new ApiError('そのURLはありません', 404);
            }

            if ($act === 'duplicate' && $method === 'POST') {
                self::json(['design' => Designs::duplicate($wsId, $user['id'], $id, (string) ($body['title'] ?? ''))], 201);
                return;
            }
            if ($act === 'versions' && $method === 'GET') {
                self::json(['versions' => Designs::versions($wsId, $id)]);
                return;
            }
            if ($act === 'restore' && $method === 'POST') {
                self::json(['design' => Designs::restore($wsId, $user['id'], $id, (int) ($body['version_id'] ?? 0))]);
                return;
            }

            switch ($method) {
                case 'GET':
                    self::json(['design' => Designs::get($wsId, $id)]);
                    return;
                case 'PATCH':
                    self::json(['design' => Designs::update($wsId, $user['id'], $id, $body)]);
                    return;
                case 'DELETE':
                    Designs::delete($wsId, $id);
                    self::json(['ok' => true]);
                    return;
            }
            throw new ApiError('そのURLはありません', 404);
        }

        // ---- 画像 ----
        if ($what === 'assets') {
            if ($id === null) {
                if ($method === 'GET') {
                    self::json(['assets' => Assets::library($wsId)]);
                    return;
                }
                if ($method === 'POST') {
                    self::json(['asset' => Assets::store(
                        $wsId,
                        $user['id'],
                        (string) ($body['data'] ?? ''),
                        (string) ($body['kind'] ?? 'upload'),
                        (string) ($body['name'] ?? '')
                    )], 201);
                    return;
                }
            } elseif ($method === 'DELETE') {
                Assets::delete($wsId, $id);
                self::json(['ok' => true]);
                return;
            }
            throw new ApiError('そのURLはありません', 404);
        }

        // ---- ブランドキット ----
        if ($what === 'brand') {
            if ($method === 'GET') {
                self::json(['brand' => Workspaces::brand($wsId)]);
                return;
            }
            if ($method === 'PATCH') {
                self::json(['brand' => Workspaces::updateBrand($wsId, $body)]);
                return;
            }
            throw new ApiError('そのURLはありません', 404);
        }

        // ---- 接続 ----
        if ($what === 'connections') {
            if ($id === null) {
                if ($method === 'GET') {
                    self::json(['connections' => Connections::list($wsId)]);
                    return;
                }
                if ($method === 'POST') {
                    self::json(['connection' => Connections::create($wsId, $body)], 201);
                    return;
                }
            } else {
                if ($act === 'verify' && $method === 'POST') {
                    self::json(Connections::verify($wsId, $id));
                    return;
                }
                if ($method === 'PATCH') {
                    self::json(['connection' => Connections::update($wsId, $id, $body)]);
                    return;
                }
                if ($method === 'DELETE') {
                    Connections::delete($wsId, $id);
                    self::json(['ok' => true]);
                    return;
                }
            }
            throw new ApiError('そのURLはありません', 404);
        }

        // ---- 投稿 ----
        if ($what === 'posts') {
            if ($id === null) {
                if ($method === 'GET') {
                    self::json(['posts' => Publish::list($wsId)]);
                    return;
                }
                if ($method === 'POST') {
                    self::json(['post' => Publish::create($wsId, $user['id'], $body)], 201);
                    return;
                }
            } else {
                if ($act === 'run' && $method === 'POST') {
                    self::json(['post' => Publish::run($wsId, $id)]);
                    return;
                }
                switch ($method) {
                    case 'GET':
                        self::json(['post' => Publish::get($wsId, $id)]);
                        return;
                    case 'PATCH':
                        self::json(['post' => Publish::update($wsId, $id, $body)]);
                        return;
                    case 'DELETE':
                        Publish::delete($wsId, $id);
                        self::json(['ok' => true]);
                        return;
                }
            }
            throw new ApiError('そのURLはありません', 404);
        }

        // ---- 時間が来た予約を送る（画面を開いている間、ときどき叩かれる）----
        if ($what === 'tick' && $method === 'POST') {
            self::json(['sent' => Publish::runDue($wsId), 'posts' => Publish::list($wsId, 40)]);
            return;
        }

        throw new ApiError('そのURLはありません', 404);
    }

    // ---- 小物 ---------------------------------------------------------------

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
