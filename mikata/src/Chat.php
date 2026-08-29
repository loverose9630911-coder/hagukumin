<?php
/**
 * 会話（Slack でいうチャンネルとスレッド）。
 *
 * メッセージは必ずプロジェクト（＝チャンネル）に属する。
 * task_id が入っているものは「そのタスクのスレッド」の発言で、
 * チャンネルの流れにも小さく顔を出す。だから
 * 「タスクを動かす → メンバーに伝わる」が1つの場所でつながる。
 */

declare(strict_types=1);

namespace Mikata;

final class Chat
{
    public const PAGE = 200;

    public static function post(int $teamId, int $userId, array $in): array
    {
        $body = trim((string) ($in['body'] ?? ''));
        if ($body === '') {
            throw new ApiError('メッセージが空です', 422);
        }
        if (mb_strlen($body) > 4000) {
            throw new ApiError('メッセージは4000文字までです', 422);
        }

        $taskId = isset($in['task_id']) && $in['task_id'] !== null && (int) $in['task_id'] !== 0
            ? (int) $in['task_id']
            : null;

        if ($taskId !== null) {
            // タスクのスレッドに書くときは、チャンネルはタスクのものに合わせる。
            $projectId = Tasks::get($teamId, $taskId)['project_id'];
        } else {
            $projectId = (int) ($in['project_id'] ?? 0);
            Teams::projectById($teamId, $projectId);
        }

        return self::insert($teamId, $projectId, $taskId, $userId, $body, 'chat');
    }

    /** タスクが動いたときに自動で流れる1行。 */
    public static function system(int $teamId, int $projectId, ?int $taskId, int $userId, string $body): array
    {
        return self::insert($teamId, $projectId, $taskId, $userId, $body, 'system');
    }

    /** チャンネルの流れ。$beforeId を渡すと、それより古いものを遡って読める。 */
    public static function channel(int $teamId, int $projectId, ?int $beforeId = null, int $limit = self::PAGE): array
    {
        Teams::projectById($teamId, $projectId);

        $sql  = 'SELECT * FROM messages WHERE project_id = ?';
        $args = [$projectId];
        if ($beforeId !== null) {
            $sql   .= ' AND id < ?';
            $args[] = $beforeId;
        }
        $sql .= ' ORDER BY id DESC LIMIT ' . max(1, min(500, $limit));

        $sel = Db::conn()->prepare($sql);
        $sel->execute($args);

        return array_map([self::class, 'shape'], array_reverse($sel->fetchAll()));
    }

    /** 1つのタスクのスレッド。 */
    public static function thread(int $teamId, int $taskId): array
    {
        Tasks::get($teamId, $taskId);
        $sel = Db::conn()->prepare('SELECT * FROM messages WHERE task_id = ? ORDER BY id');
        $sel->execute([$taskId]);
        return array_map([self::class, 'shape'], $sel->fetchAll());
    }

    /** ポーリング用。チーム全体で $sinceId より新しいものを返す。 */
    public static function since(int $teamId, int $sinceId, int $limit = self::PAGE): array
    {
        $sel = Db::conn()->prepare(
            'SELECT * FROM messages WHERE team_id = ? AND id > ? ORDER BY id LIMIT ' . max(1, min(500, $limit))
        );
        $sel->execute([$teamId, $sinceId]);
        return array_map([self::class, 'shape'], $sel->fetchAll());
    }

    public static function latestId(int $teamId): int
    {
        $sel = Db::conn()->prepare('SELECT COALESCE(MAX(id), 0) FROM messages WHERE team_id = ?');
        $sel->execute([$teamId]);
        return (int) $sel->fetchColumn();
    }

    /** チャンネルごとの未読数（自分の発言は数えない）。 */
    public static function unread(int $teamId, int $userId): array
    {
        $sel = Db::conn()->prepare(
            'SELECT m.project_id, COUNT(*) AS n
             FROM messages m
             LEFT JOIN reads r ON r.project_id = m.project_id AND r.user_id = ?
             WHERE m.team_id = ? AND m.user_id <> ? AND m.id > COALESCE(r.last_message_id, 0)
             GROUP BY m.project_id'
        );
        $sel->execute([$userId, $teamId, $userId]);

        $out = [];
        foreach ($sel->fetchAll() as $row) {
            $out[(string) (int) $row['project_id']] = (int) $row['n'];
        }
        return $out;
    }

    public static function markRead(int $teamId, int $userId, int $projectId, ?int $messageId = null): void
    {
        Teams::projectById($teamId, $projectId);

        if ($messageId === null) {
            $sel = Db::conn()->prepare('SELECT COALESCE(MAX(id), 0) FROM messages WHERE project_id = ?');
            $sel->execute([$projectId]);
            $messageId = (int) $sel->fetchColumn();
        }

        $up = Db::conn()->prepare(
            'INSERT INTO reads (user_id, project_id, last_message_id) VALUES (?, ?, ?)
             ON CONFLICT(user_id, project_id)
             DO UPDATE SET last_message_id = MAX(last_message_id, excluded.last_message_id)'
        );
        $up->execute([$userId, $projectId, $messageId]);
    }

    /** 自分あてのメンションのうち、まだ読んでいないもの。 */
    public static function mentions(int $teamId, int $userId, string $login): array
    {
        $sel = Db::conn()->prepare(
            "SELECT m.* FROM messages m
             LEFT JOIN reads r ON r.project_id = m.project_id AND r.user_id = ?
             WHERE m.team_id = ? AND m.user_id <> ? AND m.kind = 'chat'
               AND m.id > COALESCE(r.last_message_id, 0)
               AND (m.body LIKE ? OR m.body LIKE ?)
             ORDER BY m.id DESC LIMIT 30"
        );
        $needle = '@' . $login;
        $sel->execute([$userId, $teamId, $userId, $needle . '%', '%' . $needle . '%']);

        return array_map([self::class, 'shape'], $sel->fetchAll());
    }

    private static function insert(
        int $teamId,
        int $projectId,
        ?int $taskId,
        int $userId,
        string $body,
        string $kind
    ): array {
        $ins = Db::conn()->prepare(
            'INSERT INTO messages (team_id, project_id, task_id, user_id, body, kind, created_at)
             VALUES (?,?,?,?,?,?,?)'
        );
        $ins->execute([$teamId, $projectId, $taskId, $userId, $body, $kind, Clock::now()]);

        $sel = Db::conn()->prepare('SELECT * FROM messages WHERE id = ?');
        $sel->execute([(int) Db::conn()->lastInsertId()]);

        return self::shape($sel->fetch());
    }

    private static function shape(array $r): array
    {
        return [
            'id'         => (int) $r['id'],
            'project_id' => (int) $r['project_id'],
            'task_id'    => $r['task_id'] === null ? null : (int) $r['task_id'],
            'user_id'    => (int) $r['user_id'],
            'body'       => $r['body'],
            'kind'       => $r['kind'],
            'created_at' => $r['created_at'],
        ];
    }
}
