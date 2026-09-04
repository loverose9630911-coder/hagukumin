<?php
/**
 * 「このデザインを、ここへ出す」1件ぶんの扱い。
 *
 * ・下書き（draft）→ 予約（scheduled）→ 送信中（sending）→ 済み（done）/ 失敗（failed）
 * ・何が起きたかは post_logs に残す。うまくいかなかったとき、ここだけ見れば分かるようにする。
 * ・予約の実行は runDue()。バックグラウンドの常駐は持たないので、
 *   bin/tick（cron から呼ぶ）と、画面を開いている間の定期確認の2通りから叩く。
 */

declare(strict_types=1);

namespace Canter;

use Canter\Connector\XCom;

final class Publish
{
    public const STATUSES = ['draft', 'scheduled', 'sending', 'done', 'failed'];

    public static function list(int $workspaceId, int $limit = 100): array
    {
        $sel = Db::conn()->prepare(
            'SELECT * FROM posts WHERE workspace_id = ? ORDER BY id DESC LIMIT ?'
        );
        $sel->execute([$workspaceId, $limit]);

        return array_map(static fn(array $r): array => self::pub($r), $sel->fetchAll());
    }

    public static function get(int $workspaceId, int $id): array
    {
        $row = self::row($workspaceId, $id);
        $out = self::pub($row);
        $out['logs'] = self::logs($id);
        return $out;
    }

    public static function create(int $workspaceId, int $userId, array $body): array
    {
        $connectionId = (int) ($body['connection_id'] ?? 0);
        $conn         = Connections::get($workspaceId, $connectionId);
        $connector    = Connections::make($conn['service']);

        $caption = (string) ($body['caption'] ?? '');
        $limit   = $connector::captionLimit();
        if ($limit > 0 && mb_strlen($caption) > $limit) {
            throw new ApiError($conn['name'] . ' の本文は' . $limit . '文字までです（いまは' . mb_strlen($caption) . '文字）', 422);
        }

        $imageId = (int) ($body['image_asset'] ?? 0);
        if ($imageId > 0) {
            Assets::owned($workspaceId, $imageId);
        } elseif ($connector::requiresImage()) {
            throw new ApiError($conn['name'] . ' には画像が必要です', 422);
        }

        $designId = (int) ($body['design_id'] ?? 0);
        if ($designId > 0) {
            Designs::get($workspaceId, $designId);   // 他人のものを指していないか
        }

        $status = (string) ($body['status'] ?? 'draft');
        if (!in_array($status, ['draft', 'scheduled'], true)) {
            $status = 'draft';
        }

        $scheduledAt = self::when($body['scheduled_at'] ?? null);
        if ($status === 'scheduled') {
            if ($scheduledAt === null) {
                throw new ApiError('予約する日時を入れてください', 422);
            }
            if (empty($connector::capabilities()['schedule'])) {
                throw new ApiError($conn['name'] . ' は予約に対応していません', 422);
            }
        }

        $db  = Db::conn();
        $ins = $db->prepare(
            'INSERT INTO posts (workspace_id, design_id, connection_id, service, status, caption,
                                image_asset, options, scheduled_at, user_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $ins->execute([
            $workspaceId,
            $designId > 0 ? $designId : null,
            $connectionId,
            $conn['service'],
            $status,
            $caption,
            $imageId > 0 ? $imageId : null,
            json_encode(self::options($body['options'] ?? []), JSON_UNESCAPED_UNICODE),
            $scheduledAt,
            $userId,
            Clock::now(),
            Clock::now(),
        ]);

        $id = (int) $db->lastInsertId();
        self::log($id, 'info', $status === 'scheduled' ? '予約しました（' . $scheduledAt . '）' : '下書きを作りました');

        return self::get($workspaceId, $id);
    }

    public static function update(int $workspaceId, int $id, array $body): array
    {
        $row = self::row($workspaceId, $id);
        if (in_array($row['status'], ['sending', 'done'], true)) {
            throw new ApiError('送信中または送信済みの投稿は変えられません', 409);
        }

        $caption = array_key_exists('caption', $body) ? (string) $body['caption'] : (string) $row['caption'];
        $conn      = Connections::get($workspaceId, (int) $row['connection_id']);
        $connector = Connections::make($conn['service']);
        $limit     = $connector::captionLimit();
        if ($limit > 0 && mb_strlen($caption) > $limit) {
            throw new ApiError($conn['name'] . ' の本文は' . $limit . '文字までです', 422);
        }

        $status = array_key_exists('status', $body) ? (string) $body['status'] : (string) $row['status'];
        if (!in_array($status, ['draft', 'scheduled'], true)) {
            $status = 'draft';
        }

        $scheduledAt = array_key_exists('scheduled_at', $body)
            ? self::when($body['scheduled_at'])
            : $row['scheduled_at'];

        if ($status === 'scheduled' && $scheduledAt === null) {
            throw new ApiError('予約する日時を入れてください', 422);
        }

        $upd = Db::conn()->prepare(
            'UPDATE posts SET caption = ?, status = ?, scheduled_at = ?, options = ?, error = ?, updated_at = ? WHERE id = ?'
        );
        $upd->execute([
            $caption,
            $status,
            $scheduledAt,
            json_encode(
                array_key_exists('options', $body)
                    ? self::options($body['options'])
                    : (json_decode((string) $row['options'], true) ?: []),
                JSON_UNESCAPED_UNICODE
            ),
            '',
            Clock::now(),
            $id,
        ]);

        return self::get($workspaceId, $id);
    }

    public static function delete(int $workspaceId, int $id): void
    {
        $row = self::row($workspaceId, $id);
        if ($row['status'] === 'sending') {
            throw new ApiError('送信中の投稿は消せません', 409);
        }
        $del = Db::conn()->prepare('DELETE FROM posts WHERE id = ?');
        $del->execute([$id]);
    }

    /**
     * 実際に送る。
     *
     * 送信中（sending）に印を付けてから外に出るので、
     * 予約の確認が重なっても同じものを二重に出さない。
     */
    public static function run(int $workspaceId, int $id): array
    {
        $row = self::row($workspaceId, $id);

        if ($row['status'] === 'done') {
            throw new ApiError('この投稿はもう送信済みです', 409);
        }

        $db    = Db::conn();
        $claim = $db->prepare("UPDATE posts SET status = 'sending', updated_at = ? WHERE id = ? AND status != 'sending'");
        $claim->execute([Clock::now(), $id]);
        if ($claim->rowCount() === 0) {
            throw new ApiError('いま送信中です。少し待ってください', 409);
        }

        $connectionId = (int) $row['connection_id'];
        $service      = (string) $row['service'];
        $artifact     = null;

        try {
            $connector = Connections::make($service);
            $config    = Connections::secretConfig($workspaceId, $connectionId);

            $image = $row['image_asset'] !== null ? Assets::get((int) $row['image_asset']) : null;

            $result = $connector->publish($config, [
                'caption'      => (string) $row['caption'],
                'options'      => json_decode((string) $row['options'], true) ?: [],
                'scheduled_at' => $row['scheduled_at'],
            ], $image);

            // X はトークンを取り直していることがあるので、新しいほうを保存する。
            if ($connector instanceof XCom && $connector->refreshed !== []) {
                Connections::mergeConfig($workspaceId, $connectionId, $connector->refreshed);
                self::log($id, 'info', 'アクセストークンを取り直しました');
            }

            foreach ((array) ($result['logs'] ?? []) as $line) {
                self::log($id, 'info', (string) $line);
            }
            self::log($id, 'info', (string) ($result['message'] ?? '送りました'));

            $artifact = $result['artifact'] ?? null;

            $upd = $db->prepare(
                "UPDATE posts SET status = 'done', external_id = ?, external_url = ?, error = '', updated_at = ? WHERE id = ?"
            );
            $upd->execute([
                (string) ($result['external_id'] ?? ''),
                (string) ($result['external_url'] ?? ''),
                Clock::now(),
                $id,
            ]);
        } catch (\Throwable $e) {
            $message = $e instanceof ApiError ? $e->getMessage() : 'うまくいきませんでした（' . $e::class . '）';
            self::log($id, 'error', $message);

            $upd = $db->prepare("UPDATE posts SET status = 'failed', error = ?, updated_at = ? WHERE id = ?");
            $upd->execute([mb_substr($message, 0, 800), Clock::now(), $id]);

            $out = self::get($workspaceId, $id);
            $out['ok'] = false;
            return $out;
        }

        $out = self::get($workspaceId, $id);
        $out['ok']       = true;
        $out['artifact'] = $artifact;   // note のように「持ち帰るもの」があるときだけ入る
        return $out;
    }

    /**
     * 時間が来た予約を送る。
     * @return array 送ったものの一覧
     */
    public static function runDue(?int $workspaceId = null, int $limit = 5): array
    {
        $sql  = "SELECT id, workspace_id FROM posts WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?";
        $args = [Clock::now()];
        if ($workspaceId !== null) {
            $sql   .= ' AND workspace_id = ?';
            $args[] = $workspaceId;
        }
        $sql   .= ' ORDER BY scheduled_at LIMIT ?';
        $args[] = $limit;

        $sel = Db::conn()->prepare($sql);
        $sel->execute($args);

        $done = [];
        foreach ($sel->fetchAll() as $row) {
            try {
                $done[] = self::run((int) $row['workspace_id'], (int) $row['id']);
            } catch (ApiError $e) {
                // 二重に走ったときなど。次の確認でまた拾う。
                self::log((int) $row['id'], 'error', $e->getMessage());
            }
        }

        return $done;
    }

    public static function logs(int $postId): array
    {
        $sel = Db::conn()->prepare('SELECT * FROM post_logs WHERE post_id = ? ORDER BY id');
        $sel->execute([$postId]);

        return array_map(static fn(array $r): array => [
            'id'         => (int) $r['id'],
            'level'      => $r['level'],
            'message'    => $r['message'],
            'created_at' => $r['created_at'],
        ], $sel->fetchAll());
    }

    public static function log(int $postId, string $level, string $message): void
    {
        $ins = Db::conn()->prepare('INSERT INTO post_logs (post_id, level, message, created_at) VALUES (?, ?, ?, ?)');
        $ins->execute([$postId, $level === 'error' ? 'error' : 'info', mb_substr($message, 0, 800), Clock::now()]);
    }

    // ---- 中身 ---------------------------------------------------------------

    private static function row(int $workspaceId, int $id): array
    {
        $sel = Db::conn()->prepare('SELECT * FROM posts WHERE id = ?');
        $sel->execute([$id]);
        $row = $sel->fetch();
        if (!$row || (int) $row['workspace_id'] !== $workspaceId) {
            throw new ApiError('投稿が見つかりません', 404);
        }
        return $row;
    }

    /** 'YYYY-MM-DD HH:MM' も 'YYYY-MM-DDTHH:MM' も受ける。 */
    private static function when(mixed $v): ?string
    {
        if (!is_string($v) || trim($v) === '') {
            return null;
        }
        $v = str_replace('T', ' ', trim($v));
        $t = strtotime($v);
        if ($t === false) {
            throw new ApiError('日時の書き方が読めませんでした', 422);
        }
        return date('Y-m-d H:i:s', $t);
    }

    private static function options(mixed $in): array
    {
        if (!is_array($in)) {
            return [];
        }
        $out = [];
        foreach (['title'] as $key) {
            if (isset($in[$key]) && is_scalar($in[$key])) {
                $out[$key] = mb_substr(trim((string) $in[$key]), 0, 200);
            }
        }
        return $out;
    }

    private static function pub(array $row): array
    {
        $image = null;
        if ($row['image_asset'] !== null) {
            $sel = Db::conn()->prepare('SELECT token, width, height FROM assets WHERE id = ?');
            $sel->execute([(int) $row['image_asset']]);
            $a = $sel->fetch();
            if ($a) {
                $image = ['url' => '/a/' . $a['token'], 'width' => (int) $a['width'], 'height' => (int) $a['height']];
            }
        }

        return [
            'id'            => (int) $row['id'],
            'design_id'     => $row['design_id'] === null ? null : (int) $row['design_id'],
            'connection_id' => (int) $row['connection_id'],
            'service'       => $row['service'],
            'status'        => $row['status'],
            'caption'       => $row['caption'],
            'options'       => json_decode((string) $row['options'], true) ?: [],
            'image'         => $image,
            'scheduled_at'  => $row['scheduled_at'],
            'external_id'   => $row['external_id'],
            'external_url'  => $row['external_url'],
            'error'         => $row['error'],
            'user_id'       => (int) $row['user_id'],
            'created_at'    => $row['created_at'],
            'updated_at'    => $row['updated_at'],
        ];
    }
}
