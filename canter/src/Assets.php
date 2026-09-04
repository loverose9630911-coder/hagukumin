<?php
/**
 * 画像の保管と配信。
 *
 * 取りこんだ素材（upload）と、書き出した PNG（render）の両方をここで扱う。
 * 実体は data/uploads/ に置き、DB には場所と大きさだけを持つ。
 *
 * 【配信 URL について】
 * /a/{token} は**ログインなしで開ける**。Instagram・Threads・Notion は
 * 「画像そのもの」ではなく「画像の URL」を受け取る作りなので、
 * 相手のサーバーから取りに来られる必要があるため。
 * そのぶん token は 32桁のランダムな文字列にして、総当たりでは当たらないようにしている。
 */

declare(strict_types=1);

namespace Canter;

final class Assets
{
    /** 受け付ける画像の種類。SVG は中に script を書けてしまうので入れない。 */
    private const MIME = [
        'image/png'  => 'png',
        'image/jpeg' => 'jpg',
        'image/webp' => 'webp',
        'image/gif'  => 'gif',
    ];

    public const MAX_BYTES = 12 * 1024 * 1024;   // 1枚 12MB まで

    /**
     * data URL（data:image/png;base64,...）または生の base64 を受け取って保存する。
     */
    public static function store(int $workspaceId, int $userId, string $data, string $kind = 'upload', string $name = ''): array
    {
        $mime = '';
        if (preg_match('#\Adata:([-\w.+/]+);base64,#', $data, $m) === 1) {
            $mime = strtolower($m[1]);
            $data = substr($data, strlen($m[0]));
        }

        $bin = base64_decode(preg_replace('/\s+/', '', $data) ?? '', true);
        if ($bin === false || $bin === '') {
            throw new ApiError('画像を読みこめませんでした', 422);
        }
        if (strlen($bin) > self::MAX_BYTES) {
            throw new ApiError('画像が大きすぎます（12MB まで）', 413);
        }

        // 自己申告の種類は当てにせず、中身から判定する。
        $info = @getimagesizefromstring($bin);
        if ($info === false || !isset($info['mime']) || !isset(self::MIME[$info['mime']])) {
            throw new ApiError('PNG・JPEG・WebP・GIF のいずれかにしてください', 422);
        }
        $mime = $info['mime'];
        $ext  = self::MIME[$mime];

        $token = bin2hex(random_bytes(16));
        $dir   = self::dir();
        $path  = $dir . '/' . $token . '.' . $ext;
        if (file_put_contents($path, $bin, LOCK_EX) === false) {
            throw new ApiError('画像を保存できませんでした', 500);
        }
        @chmod($path, 0644);

        $ins = Db::conn()->prepare(
            'INSERT INTO assets (workspace_id, token, kind, name, mime, bytes, width, height, path, user_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $ins->execute([
            $workspaceId,
            $token,
            $kind === 'render' ? 'render' : 'upload',
            mb_substr(trim($name), 0, 80),
            $mime,
            strlen($bin),
            (int) $info[0],
            (int) $info[1],
            basename($path),
            $userId,
            Clock::now(),
        ]);

        return self::get((int) Db::conn()->lastInsertId());
    }

    public static function get(int $id): array
    {
        $sel = Db::conn()->prepare('SELECT * FROM assets WHERE id = ?');
        $sel->execute([$id]);
        $row = $sel->fetch();
        if (!$row) {
            throw new ApiError('画像が見つかりません', 404);
        }
        return self::pub($row);
    }

    /** ワークスペースのものであることまで確かめて取り出す。 */
    public static function owned(int $workspaceId, int $id): array
    {
        $a = self::get($id);
        if ($a['workspace_id'] !== $workspaceId) {
            throw new ApiError('この画像は使えません', 403);
        }
        return $a;
    }

    /** 素材ライブラリの一覧（書き出した PNG は出さない）。 */
    public static function library(int $workspaceId, int $limit = 120): array
    {
        $sel = Db::conn()->prepare(
            'SELECT * FROM assets WHERE workspace_id = ? AND kind = ? ORDER BY id DESC LIMIT ?'
        );
        $sel->execute([$workspaceId, 'upload', $limit]);

        return array_map(static fn(array $r): array => self::pub($r), $sel->fetchAll());
    }

    public static function delete(int $workspaceId, int $id): void
    {
        $a = self::owned($workspaceId, $id);
        $file = self::dir() . '/' . basename($a['path']);
        if (is_file($file)) {
            @unlink($file);
        }
        $del = Db::conn()->prepare('DELETE FROM assets WHERE id = ?');
        $del->execute([$id]);
    }

    /** 画像そのものを返す（/a/{token}）。 */
    public static function serve(string $token): void
    {
        if (!preg_match('/\A[0-9a-f]{32}\z/', $token)) {
            http_response_code(404);
            echo '見つかりません';
            return;
        }

        $sel = Db::conn()->prepare('SELECT * FROM assets WHERE token = ?');
        $sel->execute([$token]);
        $row = $sel->fetch();
        $file = $row ? self::dir() . '/' . basename((string) $row['path']) : '';

        if (!$row || !is_file($file)) {
            http_response_code(404);
            echo '見つかりません';
            return;
        }

        header('Content-Type: ' . $row['mime']);
        header('Content-Length: ' . (string) filesize($file));
        header('Cache-Control: public, max-age=31536000, immutable');
        // 中身が画像として解釈されない形で降ってきたときに実行されないようにしておく。
        header('X-Content-Type-Options: nosniff');
        header('Content-Disposition: inline');
        readfile($file);
    }

    /** 外から見える URL。Instagram などに渡すのはこれ。 */
    public static function publicUrl(array $asset): string
    {
        return rtrim(self::baseUrl(), '/') . '/a/' . $asset['token'];
    }

    /**
     * 外から見えるアドレス。
     * CANTER_PUBLIC_URL があればそれを使う。無ければリクエストから組み立てる
     * （手元で動かしているうちは localhost になるので、外部サービスからは取りに来られない）。
     */
    public static function baseUrl(): string
    {
        $env = getenv('CANTER_PUBLIC_URL');
        if (is_string($env) && $env !== '') {
            return rtrim($env, '/');
        }
        $scheme = ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https'
            || ($_SERVER['HTTPS'] ?? '') !== '' ? 'https' : 'http';
        $host = $_SERVER['HTTP_HOST'] ?? 'localhost:8080';
        return $scheme . '://' . $host;
    }

    /** そのアドレスが外部サービスから取りに来られるか。ダメなら理由を返す。 */
    public static function reachability(): array
    {
        $base = self::baseUrl();
        $host = parse_url($base, PHP_URL_HOST) ?: '';
        $bad  = $host === 'localhost'
            || $host === '127.0.0.1'
            || $host === '::1'
            || preg_match('/\A(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/', $host) === 1;

        return [
            'base'   => $base,
            'public' => !$bad,
            'reason' => $bad
                ? 'いまのアドレス（' . $base . '）は外から見えないため、Instagram・Threads・Notion には画像を渡せません。'
                    . 'CANTER_PUBLIC_URL に外から見えるアドレスを入れて、インターネット上に置いてください。'
                : '',
        ];
    }

    private static function dir(): string
    {
        $dir = Db::dataDir() . '/uploads';
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        return $dir;
    }

    private static function pub(array $row): array
    {
        return [
            'id'           => (int) $row['id'],
            'workspace_id' => (int) $row['workspace_id'],
            'token'        => $row['token'],
            'kind'         => $row['kind'],
            'name'         => $row['name'],
            'mime'         => $row['mime'],
            'bytes'        => (int) $row['bytes'],
            'width'        => (int) $row['width'],
            'height'       => (int) $row['height'],
            'path'         => $row['path'],
            'url'          => '/a/' . $row['token'],
            'created_at'   => $row['created_at'],
        ];
    }
}
