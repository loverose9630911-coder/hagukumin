<?php
/**
 * タスク（Notion でいう「データベースの1行」）。
 *
 * ふつうのタスク管理と違うのは、1つのタスクが
 *   ・納期（due_date）と見積工数（estimate_h）＝ スケジュールの材料
 *   ・目標値（target_value）と実績値（actual_value）＝ 数字の材料
 * を両方持っていること。この2つがダッシュボードの可視化のもとになる。
 */

declare(strict_types=1);

namespace Mikata;

final class Tasks
{
    public const STATUSES   = ['todo', 'doing', 'review', 'done'];
    public const PRIORITIES = ['high', 'mid', 'low'];

    /** 変更されたらメンバーに知らせたい項目（タスクのスレッドに自動投稿する）。 */
    private const NOTIFY_FIELDS = ['status', 'assignee_id', 'due_date', 'actual_value'];

    public static function all(int $teamId): array
    {
        $sel = Db::conn()->prepare('SELECT * FROM tasks WHERE team_id = ? ORDER BY sort_order, id');
        $sel->execute([$teamId]);
        return array_map([self::class, 'shape'], $sel->fetchAll());
    }

    public static function get(int $teamId, int $taskId): array
    {
        $sel = Db::conn()->prepare('SELECT * FROM tasks WHERE id = ? AND team_id = ?');
        $sel->execute([$taskId, $teamId]);
        $row = $sel->fetch();
        if (!$row) {
            throw new ApiError('タスクが見つかりません', 404);
        }
        return self::shape($row);
    }

    public static function create(int $teamId, int $userId, array $in): array
    {
        $title = trim((string) ($in['title'] ?? ''));
        if ($title === '') {
            throw new ApiError('タスク名を入れてください', 422);
        }
        if (mb_strlen($title) > 200) {
            throw new ApiError('タスク名は200文字までです', 422);
        }

        $projectId = (int) ($in['project_id'] ?? 0);
        Teams::projectById($teamId, $projectId);

        $status = self::pick((string) ($in['status'] ?? 'todo'), self::STATUSES, 'todo');
        $now    = Clock::now();

        $next = Db::conn()->prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM tasks WHERE team_id = ?');
        $next->execute([$teamId]);

        $ins = Db::conn()->prepare(
            'INSERT INTO tasks
               (team_id, project_id, title, body, status, priority, assignee_id, creator_id,
                due_date, estimate_h, target_value, actual_value, unit, goal_id, sort_order,
                created_at, updated_at, done_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
        );
        $ins->execute([
            $teamId,
            $projectId,
            $title,
            (string) ($in['body'] ?? ''),
            $status,
            self::pick((string) ($in['priority'] ?? 'mid'), self::PRIORITIES, 'mid'),
            self::member($teamId, $in['assignee_id'] ?? null),
            $userId,
            self::date($in['due_date'] ?? null),
            self::num($in['estimate_h'] ?? 0, 0),
            isset($in['target_value']) && $in['target_value'] !== '' ? self::num($in['target_value'], 0) : null,
            self::num($in['actual_value'] ?? 0, 0),
            mb_substr(trim((string) ($in['unit'] ?? '')), 0, 8),
            self::goal($teamId, $in['goal_id'] ?? null),
            (float) $next->fetchColumn(),
            $now,
            $now,
            $status === 'done' ? $now : null,
        ]);

        $task = self::get($teamId, (int) Db::conn()->lastInsertId());
        Chat::system($teamId, $projectId, $task['id'], $userId, 'タスクを作成しました');

        return $task;
    }

    public static function update(int $teamId, int $userId, int $taskId, array $patch): array
    {
        $before = self::get($teamId, $taskId);

        $sets = [];
        $args = [];
        $put  = static function (string $col, mixed $val) use (&$sets, &$args): void {
            $sets[] = "{$col} = ?";
            $args[] = $val;
        };

        if (isset($patch['title'])) {
            $title = trim((string) $patch['title']);
            if ($title === '') {
                throw new ApiError('タスク名を空にはできません', 422);
            }
            $put('title', mb_substr($title, 0, 200));
        }
        if (array_key_exists('body', $patch)) {
            $put('body', (string) $patch['body']);
        }
        if (isset($patch['project_id'])) {
            $projectId = (int) $patch['project_id'];
            Teams::projectById($teamId, $projectId);
            $put('project_id', $projectId);
        }
        if (isset($patch['status'])) {
            $status = self::pick((string) $patch['status'], self::STATUSES, $before['status']);
            $put('status', $status);
            // 完了した日を記録する（消化ペースのグラフに使う）。
            if ($status === 'done' && $before['status'] !== 'done') {
                $put('done_at', Clock::now());
            } elseif ($status !== 'done' && $before['status'] === 'done') {
                $put('done_at', null);
            }
        }
        if (isset($patch['priority'])) {
            $put('priority', self::pick((string) $patch['priority'], self::PRIORITIES, $before['priority']));
        }
        if (array_key_exists('assignee_id', $patch)) {
            $put('assignee_id', self::member($teamId, $patch['assignee_id']));
        }
        if (array_key_exists('due_date', $patch)) {
            $put('due_date', self::date($patch['due_date']));
        }
        if (array_key_exists('estimate_h', $patch)) {
            $put('estimate_h', self::num($patch['estimate_h'], 0));
        }
        if (array_key_exists('target_value', $patch)) {
            $put('target_value', $patch['target_value'] === null || $patch['target_value'] === ''
                ? null
                : self::num($patch['target_value'], 0));
        }
        if (array_key_exists('actual_value', $patch)) {
            $put('actual_value', self::num($patch['actual_value'], 0));
        }
        if (array_key_exists('unit', $patch)) {
            $put('unit', mb_substr(trim((string) $patch['unit']), 0, 8));
        }
        if (array_key_exists('goal_id', $patch)) {
            $put('goal_id', self::goal($teamId, $patch['goal_id']));
        }
        if (array_key_exists('sort_order', $patch)) {
            $put('sort_order', (float) $patch['sort_order']);
        }

        if ($sets === []) {
            return $before;
        }

        $put('updated_at', Clock::now());
        $args[] = $taskId;
        $args[] = $teamId;
        $up = Db::conn()->prepare('UPDATE tasks SET ' . implode(', ', $sets) . ' WHERE id = ? AND team_id = ?');
        $up->execute($args);

        $after = self::get($teamId, $taskId);
        self::announce($teamId, $userId, $before, $after);

        return $after;
    }

    public static function delete(int $teamId, int $taskId): void
    {
        $del = Db::conn()->prepare('DELETE FROM tasks WHERE id = ? AND team_id = ?');
        $del->execute([$taskId, $teamId]);
        if ($del->rowCount() === 0) {
            throw new ApiError('タスクが見つかりません', 404);
        }
    }

    /**
     * 変わったところをタスクのスレッドに書き込む。
     * 「誰かが動かしたこと」がチャンネルにも流れるので、報告のための報告がいらなくなる。
     */
    private static function announce(int $teamId, int $userId, array $before, array $after): void
    {
        $labels = [];
        foreach (self::NOTIFY_FIELDS as $field) {
            if ($before[$field] === $after[$field]) {
                continue;
            }
            $labels[] = match ($field) {
                'status'       => 'ステータスを「' . self::statusLabel($before['status']) . '」→「'
                                  . self::statusLabel($after['status']) . '」に変えました',
                'assignee_id'  => $after['assignee_id'] === null
                                  ? '担当を外しました'
                                  : '担当を ' . Auth::user($after['assignee_id'])['name'] . ' さんにしました',
                'due_date'     => $after['due_date'] === null
                                  ? '納期を未設定にしました'
                                  : '納期を ' . $after['due_date'] . ' にしました',
                'actual_value' => '実績を ' . self::fmt($after['actual_value'])
                                  . ($after['unit'] !== '' ? $after['unit'] : '') . ' に更新しました',
            };
        }

        if ($labels !== []) {
            Chat::system($teamId, $after['project_id'], $after['id'], $userId, implode(' / ', $labels));
        }
    }

    public static function statusLabel(string $status): string
    {
        return match ($status) {
            'todo'   => '未着手',
            'doing'  => '進行中',
            'review' => '確認待ち',
            'done'   => '完了',
            default  => $status,
        };
    }

    private static function fmt(float $v): string
    {
        return rtrim(rtrim(number_format($v, 2, '.', ''), '0'), '.');
    }

    private static function shape(array $r): array
    {
        return [
            'id'           => (int) $r['id'],
            'project_id'   => (int) $r['project_id'],
            'title'        => $r['title'],
            'body'         => $r['body'],
            'status'       => $r['status'],
            'priority'     => $r['priority'],
            'assignee_id'  => $r['assignee_id'] === null ? null : (int) $r['assignee_id'],
            'creator_id'   => (int) $r['creator_id'],
            'due_date'     => $r['due_date'],
            'estimate_h'   => (float) $r['estimate_h'],
            'target_value' => $r['target_value'] === null ? null : (float) $r['target_value'],
            'actual_value' => (float) $r['actual_value'],
            'unit'         => $r['unit'],
            'goal_id'      => $r['goal_id'] === null ? null : (int) $r['goal_id'],
            'sort_order'   => (float) $r['sort_order'],
            'created_at'   => $r['created_at'],
            'updated_at'   => $r['updated_at'],
            'done_at'      => $r['done_at'],
        ];
    }

    private static function pick(string $value, array $allowed, string $fallback): string
    {
        return in_array($value, $allowed, true) ? $value : $fallback;
    }

    private static function num(mixed $value, float $min): float
    {
        $n = is_numeric($value) ? (float) $value : $min;
        return max($min, $n);
    }

    private static function date(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        $s = (string) $value;
        if (!preg_match('/\A\d{4}-\d{2}-\d{2}\z/', $s)) {
            throw new ApiError('納期は 2026-08-31 のような形式で入れてください', 422);
        }
        [$y, $m, $d] = array_map('intval', explode('-', $s));
        if (!checkdate($m, $d, $y)) {
            throw new ApiError('その日付は存在しません', 422);
        }
        return $s;
    }

    /** チームのメンバーでなければ担当にできない。 */
    private static function member(int $teamId, mixed $userId): ?int
    {
        if ($userId === null || $userId === '' || (int) $userId === 0) {
            return null;
        }
        $sel = Db::conn()->prepare('SELECT 1 FROM members WHERE team_id = ? AND user_id = ?');
        $sel->execute([$teamId, (int) $userId]);
        if (!$sel->fetchColumn()) {
            throw new ApiError('その人はこのチームのメンバーではありません', 422);
        }
        return (int) $userId;
    }

    private static function goal(int $teamId, mixed $goalId): ?int
    {
        if ($goalId === null || $goalId === '' || (int) $goalId === 0) {
            return null;
        }
        $sel = Db::conn()->prepare('SELECT 1 FROM goals WHERE id = ? AND team_id = ?');
        $sel->execute([(int) $goalId, $teamId]);
        if (!$sel->fetchColumn()) {
            throw new ApiError('その目標は見つかりません', 422);
        }
        return (int) $goalId;
    }
}
