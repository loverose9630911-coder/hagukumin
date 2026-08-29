<?php
/**
 * 目標（目標値と期限）。
 *
 * 目標には「チームの目標」と「個人の目標」があり、同じ形で並べて比べられるようにしている。
 * 実績の数え方は3通り。
 *   tasks      … 紐づけたタスクの実績値を合計する（例: 受注金額）
 *   done_count … 紐づけたタスクのうち完了した数を数える（例: 訪問件数）
 *   manual     … 手で入れた数字をそのまま使う（例: 外部ツールの数字）
 *   children   … 紐づいている個人目標の実績を合計する（例: チーム1200万＝1人400万×3）
 *
 * children があるおかげで「チームの数字は、だれの積み上げでできているのか」を
 * 1つの目標の中で見せられる。個人とチームが別々の数字にならないための仕掛け。
 */

declare(strict_types=1);

namespace Mikata;

final class Goals
{
    public const ROLLUPS = ['tasks', 'done_count', 'manual', 'children'];
    public const SCOPES  = ['team', 'personal'];

    public static function all(int $teamId): array
    {
        $sel = Db::conn()->prepare('SELECT * FROM goals WHERE team_id = ? ORDER BY scope DESC, due_date, id');
        $sel->execute([$teamId]);
        return array_map([self::class, 'shape'], $sel->fetchAll());
    }

    public static function create(int $teamId, int $userId, array $in): array
    {
        $title = trim((string) ($in['title'] ?? ''));
        if ($title === '') {
            throw new ApiError('目標の名前を入れてください', 422);
        }

        $scope = in_array($in['scope'] ?? '', self::SCOPES, true) ? $in['scope'] : 'team';
        $owner = $scope === 'personal'
            ? self::member($teamId, $in['owner_id'] ?? $userId)
            : null;

        $rollup = in_array($in['rollup'] ?? '', self::ROLLUPS, true) ? $in['rollup'] : 'tasks';

        $ins = Db::conn()->prepare(
            'INSERT INTO goals (team_id, title, scope, owner_id, unit, target_value, manual_value, rollup, parent_id, due_date, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)'
        );
        $ins->execute([
            $teamId,
            mb_substr($title, 0, 120),
            $scope,
            $owner,
            mb_substr(trim((string) ($in['unit'] ?? '件')), 0, 8) ?: '件',
            max(0.0, (float) ($in['target_value'] ?? 0)),
            max(0.0, (float) ($in['manual_value'] ?? 0)),
            $rollup,
            self::parent($teamId, $in['parent_id'] ?? null, null, $scope),
            self::date($in['due_date'] ?? null),
            Clock::now(),
        ]);

        return self::get($teamId, (int) Db::conn()->lastInsertId());
    }

    public static function get(int $teamId, int $goalId): array
    {
        $sel = Db::conn()->prepare('SELECT * FROM goals WHERE id = ? AND team_id = ?');
        $sel->execute([$goalId, $teamId]);
        $row = $sel->fetch();
        if (!$row) {
            throw new ApiError('目標が見つかりません', 404);
        }
        return self::shape($row);
    }

    public static function update(int $teamId, int $goalId, array $patch): array
    {
        $current = self::get($teamId, $goalId);

        $sets = [];
        $args = [];
        $put  = static function (string $col, mixed $val) use (&$sets, &$args): void {
            $sets[] = "{$col} = ?";
            $args[] = $val;
        };

        if (isset($patch['title'])) {
            $title = trim((string) $patch['title']);
            if ($title === '') {
                throw new ApiError('目標の名前を空にはできません', 422);
            }
            $put('title', mb_substr($title, 0, 120));
        }
        if (isset($patch['scope']) && in_array($patch['scope'], self::SCOPES, true)) {
            $put('scope', $patch['scope']);
            if ($patch['scope'] === 'team') {
                $put('owner_id', null);
            }
        }
        if (array_key_exists('owner_id', $patch)) {
            $put('owner_id', self::member($teamId, $patch['owner_id']));
        }
        if (isset($patch['unit'])) {
            $put('unit', mb_substr(trim((string) $patch['unit']), 0, 8) ?: '件');
        }
        if (array_key_exists('target_value', $patch)) {
            $put('target_value', max(0.0, (float) $patch['target_value']));
        }
        if (array_key_exists('manual_value', $patch)) {
            $put('manual_value', max(0.0, (float) $patch['manual_value']));
        }
        if (isset($patch['rollup']) && in_array($patch['rollup'], self::ROLLUPS, true)) {
            $put('rollup', $patch['rollup']);
        }
        if (array_key_exists('due_date', $patch)) {
            $put('due_date', self::date($patch['due_date']));
        }
        // 親（チーム目標）に繋ぎ直す。
        // チーム目標に切りかえたときは、親からは自動で切りはなす（親になれるのはチーム目標だけなので）。
        $scope = $patch['scope'] ?? $current['scope'];
        if ($scope === 'team') {
            if (($patch['parent_id'] ?? null) || $current['parent_id'] !== null) {
                $put('parent_id', null);
            }
        } elseif (array_key_exists('parent_id', $patch)) {
            $put('parent_id', self::parent($teamId, $patch['parent_id'], $goalId, $scope));
        }

        if ($sets !== []) {
            $args[] = $goalId;
            $args[] = $teamId;
            $up = Db::conn()->prepare('UPDATE goals SET ' . implode(', ', $sets) . ' WHERE id = ? AND team_id = ?');
            $up->execute($args);
        }

        return self::get($teamId, $goalId);
    }

    public static function delete(int $teamId, int $goalId): void
    {
        $del = Db::conn()->prepare('DELETE FROM goals WHERE id = ? AND team_id = ?');
        $del->execute([$goalId, $teamId]);
        if ($del->rowCount() === 0) {
            throw new ApiError('目標が見つかりません', 404);
        }
    }

    /**
     * 目標ごとの進み具合を計算する。ダッシュボードのゲージはこの結果を描くだけ。
     *
     * @param array $goals Goals::all() の結果
     * @param array $tasks Tasks::all() の結果
     */
    public static function progress(array $goals, array $tasks): array
    {
        // 1周目: タスクから決まるものを先に計算する。
        $done = [];
        foreach ($goals as $goal) {
            $linked = array_values(array_filter($tasks, static fn(array $t): bool => $t['goal_id'] === $goal['id']));

            $current = match ($goal['rollup']) {
                'manual'     => $goal['manual_value'],
                'done_count' => (float) count(array_filter($linked, static fn(array $t): bool => $t['status'] === 'done')),
                'children'   => 0.0, // 2周目で入れる
                default      => array_sum(array_column($linked, 'actual_value')),
            };

            $done[$goal['id']] = $goal + [
                'current_value' => round($current, 2),
                'linked_total'  => count($linked),
                'linked_done'   => count(array_filter($linked, static fn(array $t): bool => $t['status'] === 'done')),
                'contributors'  => [],
            ];
        }

        // 2周目: 子（個人目標）の実績を親（チーム目標）に足しあげる。
        foreach ($done as $child) {
            $parentId = $child['parent_id'];
            if ($parentId === null || !isset($done[$parentId])) {
                continue;
            }
            $done[$parentId]['contributors'][] = [
                'goal_id'       => $child['id'],
                'owner_id'      => $child['owner_id'],
                'title'         => $child['title'],
                'current_value' => $child['current_value'],
                'target_value'  => $child['target_value'],
            ];
            if ($done[$parentId]['rollup'] === 'children') {
                $done[$parentId]['current_value'] = round(
                    $done[$parentId]['current_value'] + $child['current_value'],
                    2
                );
            }
        }

        // 3周目: 達成率とペースを出す（合計が出そろってから）。
        $out = [];
        foreach ($done as $goal) {
            $rate = $goal['target_value'] > 0 ? $goal['current_value'] / $goal['target_value'] : 0.0;
            $out[] = $goal + [
                'rate' => round($rate, 4),
                'pace' => self::pace($goal, $rate),
            ];
        }
        return $out;
    }

    /**
     * 「期限までの日数」に対して、いま何％進んでいるべきかと比べる。
     * 予定より進んでいれば ahead、遅れていれば behind。
     */
    private static function pace(array $goal, float $rate): array
    {
        $due = $goal['due_date'];
        if ($due === null) {
            return ['known' => false, 'expected' => null, 'gap' => null, 'days_left' => null, 'state' => 'nodate'];
        }

        $start = substr($goal['created_at'], 0, 10);
        $today = Clock::today();
        $span  = max(1, Clock::diffDays($start, $due));
        $spent = Clock::diffDays($start, $today);

        $expected  = min(1.0, max(0.0, $spent / $span));
        $daysLeft  = Clock::diffDays($today, $due);
        $gap       = $rate - $expected;

        $state = match (true) {
            $rate >= 1.0    => 'achieved',
            $gap >= 0.05    => 'ahead',
            $gap <= -0.15   => 'behind',
            default         => 'ontrack',
        };
        if ($daysLeft < 0 && $rate < 1.0) {
            $state = 'overdue';
        }

        return [
            'known'     => true,
            'expected'  => round($expected, 4),
            'gap'       => round($gap, 4),
            'days_left' => $daysLeft,
            'state'     => $state,
        ];
    }

    private static function shape(array $r): array
    {
        return [
            'id'           => (int) $r['id'],
            'title'        => $r['title'],
            'scope'        => $r['scope'],
            'owner_id'     => $r['owner_id'] === null ? null : (int) $r['owner_id'],
            'unit'         => $r['unit'],
            'target_value' => (float) $r['target_value'],
            'manual_value' => (float) $r['manual_value'],
            'rollup'       => $r['rollup'],
            'parent_id'    => ($r['parent_id'] ?? null) === null ? null : (int) $r['parent_id'],
            'due_date'     => $r['due_date'],
            'created_at'   => $r['created_at'],
        ];
    }

    /**
     * 親（チーム目標）としてつないでよいか調べる。
     * ・親はチーム目標だけ  ・子は個人目標だけ  ・親子は1段まで  ・自分自身は親にできない
     */
    private static function parent(int $teamId, mixed $parentId, ?int $selfId, string $scope): ?int
    {
        if ($parentId === null || $parentId === '' || (int) $parentId === 0) {
            return null;
        }
        $parentId = (int) $parentId;

        if ($selfId !== null && $parentId === $selfId) {
            throw new ApiError('自分自身を紐づけることはできません', 422);
        }
        if ($scope !== 'personal') {
            throw new ApiError('チーム目標に紐づけられるのは個人目標だけです', 422);
        }

        $sel = Db::conn()->prepare('SELECT scope, parent_id FROM goals WHERE id = ? AND team_id = ?');
        $sel->execute([$parentId, $teamId]);
        $parent = $sel->fetch();

        if (!$parent) {
            throw new ApiError('紐づけ先の目標が見つかりません', 422);
        }
        if ($parent['scope'] !== 'team') {
            throw new ApiError('紐づけ先はチームの目標にしてください', 422);
        }
        if ($parent['parent_id'] !== null) {
            throw new ApiError('紐づけは1段までです', 422);
        }

        // 自分に子がいるなら、さらに親を持つと2段になってしまう。
        if ($selfId !== null) {
            $kids = Db::conn()->prepare('SELECT COUNT(*) FROM goals WHERE parent_id = ?');
            $kids->execute([$selfId]);
            if ((int) $kids->fetchColumn() > 0) {
                throw new ApiError('この目標には別の目標が紐づいているため、さらに紐づけられません', 422);
            }
        }

        return $parentId;
    }

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

    private static function date(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        $s = (string) $value;
        if (!preg_match('/\A\d{4}-\d{2}-\d{2}\z/', $s)) {
            throw new ApiError('期限は 2026-12-31 のような形式で入れてください', 422);
        }
        return $s;
    }
}
