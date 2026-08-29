<?php
/**
 * 可視化のための集計。ダッシュボードのグラフは全てここの計算結果を描いているだけ。
 *
 * このアプリでいちばん大事なのは「個人」と「チーム」を"同じものさし"で出すこと。
 * そのため personSummary() を1つだけ用意して、
 *   ・自分の欄
 *   ・チームのメンバー一覧
 * の両方で同じ関数を使っている。数え方がずれないので、見比べたときに必ず筋が通る。
 *
 * ものさしの定義（この4つだけ覚えれば全部読める）
 *   残り      … 完了していないタスク
 *   遅延        … 納期が今日より前で、まだ完了していないタスク
 *   負荷        … 残タスクの見積工数 ÷ 1週間に使える時間
 *   目標の進み  … 実績値 ÷ 目標値
 */

declare(strict_types=1);

namespace Mikata;

final class Metrics
{
    /** 「もうすぐ納期」とみなす日数。 */
    public const SOON_DAYS = 3;

    /** 推移グラフの日数。 */
    public const TREND_DAYS = 14;

    public static function build(int $teamId, int $meId): array
    {
        $team     = Teams::get($teamId);
        $members  = Teams::members($teamId);
        $projects = Teams::projects($teamId);
        $tasks    = Tasks::all($teamId);
        $goals    = Goals::progress(Goals::all($teamId), $tasks);
        $today    = Clock::today();

        $capacity = [];
        foreach ($members as $m) {
            $capacity[$m['id']] = $m['capacity_h'];
        }

        $people = [];
        foreach ($members as $m) {
            $mine       = self::assignedTo($tasks, $m['id']);
            $myGoals    = array_values(array_filter(
                $goals,
                static fn(array $g): bool => $g['scope'] === 'personal' && $g['owner_id'] === $m['id']
            ));
            $people[] = self::personSummary($m, $mine, $myGoals, $today);
        }

        $unassigned = array_values(array_filter($tasks, static fn(array $t): bool => $t['assignee_id'] === null));

        $me = null;
        foreach ($people as $p) {
            if ($p['user_id'] === $meId) {
                $me = $p;
            }
        }

        return [
            'today' => $today,
            'team'  => [
                'id'           => $team['id'],
                'name'         => $team['name'],
                'member_count' => count($members),
                'status'       => self::countByStatus($tasks),
                'due'          => self::countByDue($tasks, $today),
                'total'        => count($tasks),
                'open'         => count(self::open($tasks)),
                'done_rate'    => self::doneRate($tasks),
                'load'         => self::load($tasks, array_sum($capacity)),
                'trend'        => self::trend($tasks, $today, self::TREND_DAYS),
                'members'      => $people,
                'projects'     => self::byProject($projects, $tasks, $today),
                'goals'        => [
                    'team'     => array_values(array_filter($goals, static fn(array $g): bool => $g['scope'] === 'team')),
                    'personal' => array_values(array_filter($goals, static fn(array $g): bool => $g['scope'] === 'personal')),
                ],
                'unassigned'   => [
                    'count' => count($unassigned),
                    'hours' => round(array_sum(array_column(self::open($unassigned), 'estimate_h')), 1),
                ],
                'risks'        => self::risks($tasks, $today),
            ],
            'me'    => $me,
        ];
    }

    /**
     * 1人ぶんのまとめ。個人ページでもチーム一覧でもこれを使う。
     *
     * @param array $member Teams::members() の1件
     * @param array $tasks  その人が担当しているタスク
     * @param array $goals  その人の個人目標（progress 済み）
     */
    public static function personSummary(array $member, array $tasks, array $goals, string $today): array
    {
        $open   = self::open($tasks);
        $due    = self::countByDue($tasks, $today);
        $status = self::countByStatus($tasks);

        $openHours = round(array_sum(array_column($open, 'estimate_h')), 1);
        $capacity  = $member['capacity_h'];

        // 目標値をもつタスクだけ集めて、数字の達成度も出す。
        $valued = array_values(array_filter(
            $tasks,
            static fn(array $t): bool => $t['target_value'] !== null && $t['target_value'] > 0
        ));
        $targetSum = array_sum(array_column($valued, 'target_value'));
        $actualSum = array_sum(array_column($valued, 'actual_value'));

        $goalRates = array_column($goals, 'rate');

        return [
            'user_id'      => $member['id'],
            'name'         => $member['name'],
            'login'        => $member['login'],
            'color'        => $member['color'],
            'role'         => $member['role'],
            'total'        => count($tasks),
            'open'         => count($open),
            'status'       => $status,
            'due'          => $due,
            'done_rate'    => self::doneRate($tasks),
            'done_7d'      => self::doneWithin($tasks, $today, 7),
            'open_hours'   => $openHours,
            'capacity_h'   => $capacity,
            'load_rate'    => $capacity > 0 ? round($openHours / $capacity, 3) : null,
            'trend7'       => self::doneSeries($tasks, $today, 7),
            'value'        => [
                'target' => round($targetSum, 2),
                'actual' => round($actualSum, 2),
                'rate'   => $targetSum > 0 ? round($actualSum / $targetSum, 4) : null,
                'count'  => count($valued),
            ],
            'goals'        => [
                'count' => count($goals),
                'rate'  => $goalRates === [] ? null : round(array_sum($goalRates) / count($goalRates), 4),
                'items' => $goals,
            ],
        ];
    }

    // ---- こまかい数え方 ---------------------------------------------------

    /** @return array<int, array> 完了していないタスク */
    public static function open(array $tasks): array
    {
        return array_values(array_filter($tasks, static fn(array $t): bool => $t['status'] !== 'done'));
    }

    public static function assignedTo(array $tasks, int $userId): array
    {
        return array_values(array_filter($tasks, static fn(array $t): bool => $t['assignee_id'] === $userId));
    }

    public static function countByStatus(array $tasks): array
    {
        $out = array_fill_keys(Tasks::STATUSES, 0);
        foreach ($tasks as $t) {
            $out[$t['status']] = ($out[$t['status']] ?? 0) + 1;
        }
        return $out;
    }

    /**
     * 納期の状況で分ける。完了したタスクは「納期の心配」から外す。
     *   overdue … 期限切れ / today … 今日まで / soon … SOON_DAYS 以内 / later … その先 / none … 納期なし
     */
    public static function countByDue(array $tasks, string $today): array
    {
        $out = ['overdue' => 0, 'today' => 0, 'soon' => 0, 'later' => 0, 'none' => 0];
        foreach (self::open($tasks) as $t) {
            $out[self::dueBucket($t['due_date'], $today)]++;
        }
        return $out;
    }

    public static function dueBucket(?string $due, string $today): string
    {
        if ($due === null) {
            return 'none';
        }
        $left = Clock::diffDays($today, $due);
        return match (true) {
            $left < 0                 => 'overdue',
            $left === 0               => 'today',
            $left <= self::SOON_DAYS  => 'soon',
            default                   => 'later',
        };
    }

    public static function doneRate(array $tasks): ?float
    {
        if ($tasks === []) {
            return null;
        }
        $done = count(array_filter($tasks, static fn(array $t): bool => $t['status'] === 'done'));
        return round($done / count($tasks), 4);
    }

    public static function load(array $tasks, float $capacity): array
    {
        $hours = round(array_sum(array_column(self::open($tasks), 'estimate_h')), 1);
        return [
            'open_hours' => $hours,
            'capacity_h' => round($capacity, 1),
            'rate'       => $capacity > 0 ? round($hours / $capacity, 3) : null,
        ];
    }

    /** 直近 $days 日に完了した数。 */
    public static function doneWithin(array $tasks, string $today, int $days): int
    {
        $from = date('Y-m-d', strtotime($today . ' -' . ($days - 1) . ' day'));
        $n    = 0;
        foreach ($tasks as $t) {
            if ($t['done_at'] !== null && substr($t['done_at'], 0, 10) >= $from) {
                $n++;
            }
        }
        return $n;
    }

    /** 直近 $days 日の「1日ごとの完了数」。スパークライン用。 */
    public static function doneSeries(array $tasks, string $today, int $days): array
    {
        $series = [];
        for ($i = $days - 1; $i >= 0; $i--) {
            $series[date('Y-m-d', strtotime($today . " -{$i} day"))] = 0;
        }
        foreach ($tasks as $t) {
            if ($t['done_at'] === null) {
                continue;
            }
            $day = substr($t['done_at'], 0, 10);
            if (isset($series[$day])) {
                $series[$day]++;
            }
        }
        return array_values($series);
    }

    /** 「増えた数」と「完了数」の推移。線が交わらないなら仕事は減っていない。 */
    public static function trend(array $tasks, string $today, int $days): array
    {
        $rows = [];
        for ($i = $days - 1; $i >= 0; $i--) {
            $day        = date('Y-m-d', strtotime($today . " -{$i} day"));
            $rows[$day] = ['day' => $day, 'created' => 0, 'done' => 0];
        }
        foreach ($tasks as $t) {
            $made = substr($t['created_at'], 0, 10);
            if (isset($rows[$made])) {
                $rows[$made]['created']++;
            }
            if ($t['done_at'] !== null) {
                $fin = substr($t['done_at'], 0, 10);
                if (isset($rows[$fin])) {
                    $rows[$fin]['done']++;
                }
            }
        }
        return array_values($rows);
    }

    public static function byProject(array $projects, array $tasks, string $today): array
    {
        $out = [];
        foreach ($projects as $p) {
            $mine = array_values(array_filter($tasks, static fn(array $t): bool => $t['project_id'] === $p['id']));
            $due  = self::countByDue($mine, $today);
            $out[] = [
                'id'         => $p['id'],
                'name'       => $p['name'],
                'emoji'      => $p['emoji'],
                'color'      => $p['color'],
                'archived'   => $p['archived'],
                'total'      => count($mine),
                'open'       => count(self::open($mine)),
                'done_rate'  => self::doneRate($mine),
                'overdue'    => $due['overdue'],
                'open_hours' => round(array_sum(array_column(self::open($mine), 'estimate_h')), 1),
            ];
        }
        return $out;
    }

    /**
     * 危ないタスクを上から並べる。
     * 遅れているほど、優先度が高いほど、納期が近いほど上に来る。
     */
    public static function risks(array $tasks, string $today, int $limit = 12): array
    {
        $weight = ['high' => 3, 'mid' => 2, 'low' => 1];
        $rows   = [];

        foreach (self::open($tasks) as $t) {
            if ($t['due_date'] === null) {
                continue;
            }
            $left = Clock::diffDays($today, $t['due_date']);
            if ($left > self::SOON_DAYS) {
                continue;
            }
            $rows[] = [
                'id'          => $t['id'],
                'title'       => $t['title'],
                'assignee_id' => $t['assignee_id'],
                'project_id'  => $t['project_id'],
                'status'      => $t['status'],
                'priority'    => $t['priority'],
                'due_date'    => $t['due_date'],
                'days_left'   => $left,
                'score'       => (-$left * 10) + ($weight[$t['priority']] ?? 1),
            ];
        }

        usort($rows, static fn(array $a, array $b): int => $b['score'] <=> $a['score'] ?: $a['id'] <=> $b['id']);

        return array_slice($rows, 0, $limit);
    }
}
