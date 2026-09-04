<?php
/**
 * ミカタ（同じリポジトリにあるチームタスクのアプリ）。
 *
 * 「作ったら終わり」にしないための出し先。
 * デザインを1枚出すたびに、ミカタ側に
 *   ・制作タスク（誰が・いつまでに・どこまで）を立てる
 *   ・チャンネルに1行流す
 * のどちらか（または両方）を行う。
 *
 * 【つなぎ方】
 * ミカタは Cookie でログイン状態を持ち、更新のときは X-Mikata ヘッダを求める作りなので、
 * ここでも同じことをする。投稿のたびにログインし直す（状態を持たないぶん、確実）。
 *
 * ミカタ側の API（mikata/src/Api.php）
 *   POST /api/auth/login              {login, password}          → Set-Cookie
 *   GET  /api/teams/{id}/bootstrap                               → プロジェクト一覧など
 *   POST /api/teams/{id}/tasks        {title, project_id, ...}
 *   POST /api/teams/{id}/messages     {project_id, body}
 */

declare(strict_types=1);

namespace Canter\Connector;

use Canter\ApiError;
use Canter\Assets;
use Canter\Http;

final class Mikata extends Connector
{
    public static function service(): string
    {
        return 'mikata';
    }

    public static function label(): string
    {
        return 'ミカタ';
    }

    public static function capabilities(): array
    {
        return ['image' => true, 'text' => true, 'schedule' => true];
    }

    public static function requiresImage(): bool
    {
        return false;
    }

    public static function fields(): array
    {
        return [
            [
                'key' => 'base_url', 'label' => 'ミカタのアドレス', 'type' => 'url', 'required' => true,
                'default' => 'http://localhost:8080',
                'help' => '末尾の / は要りません。Render に置いているなら https://…onrender.com のような形。',
            ],
            ['key' => 'login',    'label' => 'ログインID',   'type' => 'text',     'required' => true],
            ['key' => 'password', 'label' => 'パスワード',   'type' => 'password', 'required' => true],
            [
                'key' => 'team_id', 'label' => 'チームID', 'type' => 'text', 'required' => false,
                'help' => '空にすると、いちばん最初のチームを使います。',
            ],
            [
                'key' => 'project_id', 'label' => 'プロジェクトID', 'type' => 'text', 'required' => false,
                'help' => '空にすると、いちばん最初のプロジェクト（チャンネル）を使います。',
            ],
            [
                'key' => 'mode', 'label' => '何をするか', 'type' => 'select', 'required' => true, 'default' => 'task',
                'options' => [
                    ['value' => 'task',    'label' => '制作タスクを立てる'],
                    ['value' => 'message', 'label' => 'チャンネルに流す'],
                    ['value' => 'both',    'label' => '両方する'],
                ],
            ],
        ];
    }

    public function verify(array $config): array
    {
        $base = self::base($config, 'base_url', '');
        if ($base === '') {
            return self::ng('ミカタのアドレスを入れてください');
        }

        try {
            [$cookie, $me] = $this->login($config);
        } catch (ApiError $e) {
            return self::ng($e->getMessage());
        }

        $team = $this->pickTeam($config, $me);
        if ($team === null) {
            return self::ng('このログインIDが入っているチームがありません。ミカタ側でチームを作るか、参加コードで入ってください。');
        }

        $boot = Http::get($base . '/api/teams/' . $team['id'] . '/bootstrap', ['cookie' => $cookie]);
        if ($boot['status'] !== 200) {
            return self::ng('チームの中身を読めませんでした：' . Http::errorMessage($boot));
        }

        $projects = array_values(array_filter(
            (array) ($boot['json']['projects'] ?? []),
            static fn(array $p): bool => empty($p['archived'])
        ));

        return self::ok(
            [
                'user'     => $me['user']['name'] ?? '',
                'team'     => $team['name'],
                'team_id'  => $team['id'],
                'projects' => array_map(
                    static fn(array $p): array => ['id' => $p['id'], 'name' => $p['name']],
                    $projects
                ),
            ],
            'つながりました（' . $team['name'] . ' / ' . count($projects) . 'プロジェクト）'
        );
    }

    public function publish(array $config, array $post, ?array $image): array
    {
        $base = self::base($config, 'base_url', '');
        $mode = (string) ($config['mode'] ?? 'task');
        $logs = [];

        [$cookie, $me] = $this->login($config);

        $team = $this->pickTeam($config, $me);
        if ($team === null) {
            throw new ApiError('チームが見つかりません', 422);
        }

        $boot = Http::get($base . '/api/teams/' . $team['id'] . '/bootstrap', ['cookie' => $cookie]);
        if ($boot['status'] !== 200) {
            throw new ApiError('チームの中身を読めませんでした：' . Http::errorMessage($boot), 502);
        }

        $projectId = $this->pickProject($config, (array) ($boot['json']['projects'] ?? []));
        $logs[]    = 'チーム ' . $team['name'] . ' / プロジェクト ' . $projectId . ' に出します';

        $caption = trim((string) ($post['caption'] ?? ''));
        $title   = trim((string) ($post['options']['title'] ?? '')) ?: (self::firstLine($caption) ?: 'canter のデザイン');
        $link    = $image !== null ? Assets::publicUrl($image) : '';

        $bodyLines = [];
        if ($caption !== '') {
            $bodyLines[] = $caption;
        }
        if ($link !== '') {
            $bodyLines[] = '画像: ' . $link;
        }
        $body = implode("\n\n", $bodyLines);

        $taskId = 0;
        $url    = '';

        if ($mode === 'task' || $mode === 'both') {
            $payload = [
                'title'      => mb_substr($title, 0, 200),
                'project_id' => $projectId,
                'body'       => $body,
                'status'     => 'todo',
                'priority'   => 'mid',
            ];
            if (!empty($post['scheduled_at'])) {
                $payload['due_date'] = substr((string) $post['scheduled_at'], 0, 10);
            }

            $res = Http::post($base . '/api/teams/' . $team['id'] . '/tasks', [
                'json'    => $payload,
                'cookie'  => $cookie,
                'headers' => ['X-Mikata: 1'],
            ]);
            if ($res['status'] !== 201 && $res['status'] !== 200) {
                throw new ApiError('タスクを作れませんでした：' . Http::errorMessage($res), 502);
            }

            $taskId = (int) ($res['json']['task']['id'] ?? 0);
            $logs[] = 'タスクを立てました（#' . $taskId . '）';
            $url    = $base . '/#/board';
        }

        if ($mode === 'message' || $mode === 'both') {
            $msg = $body !== '' ? $body : $title;
            if ($taskId > 0) {
                $msg = 'デザインができました：' . $title . ($link !== '' ? "\n" . $link : '');
            }

            $res = Http::post($base . '/api/teams/' . $team['id'] . '/messages', [
                'json'    => ['project_id' => $projectId, 'body' => mb_substr($msg, 0, 4000)],
                'cookie'  => $cookie,
                'headers' => ['X-Mikata: 1'],
            ]);
            if ($res['status'] !== 201 && $res['status'] !== 200) {
                throw new ApiError('チャンネルに流せませんでした：' . Http::errorMessage($res), 502);
            }
            $logs[] = 'チャンネルに流しました';
            if ($url === '') {
                $url = $base . '/#/channel/' . $projectId;
            }
        }

        return [
            'external_id'  => $taskId > 0 ? (string) $taskId : '',
            'external_url' => $url,
            'message'      => 'ミカタに送りました',
            'logs'         => $logs,
        ];
    }

    // ---- 中身 ---------------------------------------------------------------

    /** @return array{0:string, 1:array} Cookie 文字列と /api/auth/login の答え */
    private function login(array $config): array
    {
        $base = self::base($config, 'base_url', '');
        if ($base === '') {
            throw new ApiError('ミカタのアドレスを入れてください', 422);
        }

        $res = Http::post($base . '/api/auth/login', [
            'json'    => [
                'login'    => self::need($config, 'login', 'ログインID'),
                'password' => self::need($config, 'password', 'パスワード'),
            ],
            'headers' => ['X-Mikata: 1'],
        ]);

        if ($res['status'] !== 200) {
            throw new ApiError('ミカタにログインできませんでした：' . Http::errorMessage($res), 502);
        }

        $cookie = '';
        foreach ($res['headers']['set-cookie'] ?? [] as $line) {
            if (preg_match('/mikata_session=([^;]+)/', $line, $m) === 1) {
                $cookie = 'mikata_session=' . $m[1];
            }
        }
        if ($cookie === '') {
            throw new ApiError('ミカタからログイン状態を受け取れませんでした', 502);
        }

        return [$cookie, (array) $res['json']];
    }

    private function pickTeam(array $config, array $me): ?array
    {
        $teams = (array) ($me['teams'] ?? []);
        if ($teams === []) {
            return null;
        }

        $want = (int) ($config['team_id'] ?? 0);
        if ($want > 0) {
            foreach ($teams as $t) {
                if ((int) ($t['id'] ?? 0) === $want) {
                    return $t;
                }
            }
            throw new ApiError('チームID ' . $want . ' に入っていません', 422);
        }

        return $teams[0];
    }

    private function pickProject(array $config, array $projects): int
    {
        $live = array_values(array_filter($projects, static fn(array $p): bool => empty($p['archived'])));
        if ($live === []) {
            throw new ApiError('ミカタ側にプロジェクト（チャンネル）がありません', 422);
        }

        $want = (int) ($config['project_id'] ?? 0);
        if ($want > 0) {
            foreach ($live as $p) {
                if ((int) ($p['id'] ?? 0) === $want) {
                    return $want;
                }
            }
            throw new ApiError('プロジェクトID ' . $want . ' が見つかりません', 422);
        }

        return (int) $live[0]['id'];
    }

    private static function firstLine(string $text): string
    {
        $line = strtok(trim($text), "\n");
        return $line === false ? '' : mb_substr($line, 0, 120);
    }
}
