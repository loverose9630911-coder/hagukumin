<?php
/**
 * デモ用のデータを入れる。
 *
 *   bin/seed
 *
 * ログイン: demo / demo1234（他の4人も同じパスワード）
 * グラフが意味を持つように、作成日と完了日は過去2週間にばらしてある。
 */

declare(strict_types=1);

namespace Mikata;

final class Seed
{
    public const PASSWORD = 'demo1234';

    public static function run(): array
    {
        $db = Db::conn();
        if ((int) $db->query('SELECT COUNT(*) FROM users')->fetchColumn() > 0) {
            throw new ApiError('既にデータがあります。data/mikata.sqlite を消してからやり直してください', 409);
        }

        $people = [
            ['demo',   '田中 みなと'],
            ['sakura', '佐藤 さくら'],
            ['ken',    '鈴木 けん'],
            ['yui',    '高橋 ゆい'],
        ];

        $ids = [];
        foreach ($people as [$login, $name]) {
            $ids[$login] = Auth::register($login, $name, self::PASSWORD)['id'];
        }

        $team   = Teams::create($ids['demo'], '営業チーム');
        $teamId = $team['id'];
        foreach (['sakura', 'ken', 'yui'] as $login) {
            Teams::join($ids[$login], $team['join_code']);
        }

        // 使える時間は人によって違う（時短勤務・兼務など）。
        $caps = ['demo' => 30, 'sakura' => 30, 'ken' => 20, 'yui' => 25];
        foreach ($caps as $login => $h) {
            $up = $db->prepare('UPDATE members SET capacity_h = ? WHERE team_id = ? AND user_id = ?');
            $up->execute([$h, $teamId, $ids[$login]]);
        }

        $projects = [];
        foreach ([
            ['新規開拓',   '📈', '#0ea5e9'],
            ['既存フォロー', '🤝', '#10b981'],
            ['提案・資料',  '📝', '#f59e0b'],
        ] as $i => [$name, $emoji, $color]) {
            $projects[$i] = Teams::createProject($teamId, ['name' => $name, 'emoji' => $emoji, 'color' => $color])['id'];
        }
        $general = Teams::projects($teamId)[0]['id']; // 「全体連絡」

        // ---- 目標 --------------------------------------------------------
        // 受注金額は「チーム1200万円 ＝ 4人ぶんの個人目標の合計」という形にしてある。
        // チームの数字が誰の積み上げでできているのかが、そのまま画面に出る。
        $goalUriage = Goals::create($teamId, $ids['demo'], [
            'title' => '今期の受注金額', 'scope' => 'team', 'unit' => '万円',
            'target_value' => 1200, 'rollup' => 'children', 'due_date' => Clock::day(45),
        ])['id'];

        $mine = [];
        foreach (['demo' => 400, 'sakura' => 350, 'ken' => 250, 'yui' => 200] as $login => $target) {
            $mine[$login] = Goals::create($teamId, $ids[$login], [
                'title'     => '自分の受注', 'scope' => 'personal', 'owner_id' => $ids[$login],
                'unit'      => '万円', 'target_value' => $target, 'rollup' => 'tasks',
                'parent_id' => $goalUriage, 'due_date' => Clock::day(45),
            ])['id'];
        }

        // 訪問件数はチームで直接数える形（タスクをそのまま紐づける）。
        $goalHoumon = Goals::create($teamId, $ids['demo'], [
            'title' => '新規訪問の件数', 'scope' => 'team', 'unit' => '件',
            'target_value' => 40, 'rollup' => 'done_count', 'due_date' => Clock::day(20),
        ])['id'];

        $goalTeian = Goals::create($teamId, $ids['ken'], [
            'title' => '提案書の本数', 'scope' => 'personal', 'owner_id' => $ids['ken'],
            'unit' => '本', 'target_value' => 12, 'rollup' => 'done_count', 'due_date' => Clock::day(30),
        ])['id'];

        // 目標の「作成日」を過去にずらす。
        // そうしないと期限までの日数から見た「いま何％まで進んでいるべきか」が出せない。
        $age = static function (int $goalId, int $daysAgo) use ($db): void {
            $up = $db->prepare('UPDATE goals SET created_at = ? WHERE id = ?');
            $up->execute([Clock::day($daysAgo) . ' 09:00:00', $goalId]);
        };
        $age($goalUriage, -30);
        foreach ($mine as $gid) {
            $age($gid, -30);
        }
        $age($goalHoumon, -20);
        $age($goalTeian, -15);

        // ---- タスク ------------------------------------------------------
        // [題名, 担当, プロジェクト, ステータス, 納期のずらし日数, 見積, 目標値, 実績, 単位, 目標, 作成日のずらし, 完了日のずらし]
        $rows = [
            ['A商事へ初回訪問',              'demo',   0, 'done',   -9, 2,  1, 1, '件', $goalHoumon, -13, -9],
            ['B工業へ初回訪問',              'sakura', 0, 'done',   -7, 2,  1, 1, '件', $goalHoumon, -12, -7],
            ['C物流へ初回訪問',              'ken',    0, 'done',   -5, 2,  1, 1, '件', $goalHoumon, -10, -5],
            ['D印刷へ初回訪問',              'yui',    0, 'done',   -4, 2,  1, 1, '件', $goalHoumon, -9,  -4],
            ['E食品へ初回訪問',              'demo',   0, 'done',   -2, 2,  1, 1, '件', $goalHoumon, -7,  -2],
            ['F建設へ初回訪問',              'sakura', 0, 'doing',   1, 2,  1, 0, '件', $goalHoumon, -4,  null],
            ['G薬品へ初回訪問',              'ken',    0, 'todo',    3, 2,  1, 0, '件', $goalHoumon, -3,  null],
            ['H運輸へ初回訪問',              'yui',    0, 'todo',    6, 2,  1, 0, '件', $goalHoumon, -2,  null],
            ['I社リストの洗い出し',           'demo',   0, 'done',  -11, 4,  null, 0, '',  null, -14, -11],
            ['展示会の来場者リスト整理',       'yui',    0, 'todo',   -1, 3,  null, 0, '',  null, -5,  null],

            ['A商事 契約書の取りまとめ',      'demo',   1, 'done',   -3, 3,  180, 180, '万円', 'uriage', -8, -3],
            ['B工業 追加発注のフォロー',      'sakura', 1, 'done',   -1, 2,  150, 150, '万円', 'uriage', -6, -1],
            ['C物流 更新の打診',             'ken',    1, 'review',  0, 3,  120, 0,   '万円', 'uriage', -5, null],
            ['D印刷 見積のすり合わせ',        'yui',    1, 'doing',   2, 4,  90,  0,   '万円', 'uriage', -4, null],
            ['E食品 値上げの説明',           'demo',   1, 'doing',   1, 3,  200, 0,   '万円', 'uriage', -3, null],
            ['J商店 解約の引き止め',          'sakura', 1, 'todo',   -2, 5,  60,  0,   '万円', 'uriage', -6, null],
            ['L社 追加ライセンス',            'ken',    1, 'done',   -6, 2,  80,  80,  '万円', 'uriage', -11, -6],
            ['M社 保守の更新',               'yui',    1, 'done',   -8, 2,  60,  60,  '万円', 'uriage', -12, -8],
            ['K社 定例の議事録',             'yui',    1, 'done',   -6, 1,  null, 0,  '',  null, -8,  -6],
            ['既存顧客アンケートの集計',       'ken',    1, 'todo',   9, 6,  null, 0,  '',  null, -2,  null],

            ['A商事向け提案書',              'ken',    2, 'done',   -8, 6,  null, 0, '', 'teian', -12, -8],
            ['B工業向け提案書',              'ken',    2, 'done',   -4, 6,  null, 0, '', 'teian', -9,  -4],
            ['C物流向け提案書',              'ken',    2, 'doing',   0, 6,  null, 0, '', 'teian', -3,  null],
            ['料金表の作り直し',          'demo',   2, 'review',  2, 5,  null, 0, '', null, -5,  null],
            ['事例集に3社を追加',            'yui',    2, 'todo',    5, 8,  null, 0, '', null, -2,  null],
            ['提案テンプレの見直し',        'sakura', 2, 'todo',   12, 4,  null, 0, '', null, -1,  null],
            ['競合の価格調査',             null,     2, 'todo',    7, 3,  null, 0, '', null, -1,  null],
            ['サイトの問い合わせ導線を直す',   null,     2, 'todo',   null, 5, null, 0, '', null, -6, null],

            ['来期の目標の下準備',        'demo',   1, 'todo',   14, 4,  null, 0, '', null, -1,  null],
            ['月次レポートの作成',           'sakura', 1, 'done',  -10, 2,  null, 0, '', null, -13, -10],
            ['採用面談の同席',              'demo',   1, 'done',   -7, 1,  null, 0, '', null, -9,  -7],
            ['請求漏れのチェック',           'yui',    1, 'todo',    0, 2,  null, 0, '', null, -2,  null],
        ];

        foreach ($rows as $r) {
            [$title, $who, $pj, $status, $dueOff, $est, $target, $actual, $unit, $goal, $madeOff, $doneOff] = $r;

            // 'uriage' は「担当者自身の受注目標」、'teian' は「けんさんの提案書目標」を指す合図。
            $goalId = match ($goal) {
                'uriage' => $who === null ? null : $mine[$who],
                'teian'  => $goalTeian,
                default  => $goal,
            };

            $task = Tasks::create($teamId, $ids['demo'], [
                'title'        => $title,
                'project_id'   => $projects[$pj],
                'assignee_id'  => $who === null ? null : $ids[$who],
                'status'       => $status,
                'priority'     => $dueOff !== null && $dueOff < 0 ? 'high' : 'mid',
                'due_date'     => $dueOff === null ? null : Clock::day($dueOff),
                'estimate_h'   => $est,
                'target_value' => $target,
                'actual_value' => $actual,
                'unit'         => $unit,
                'goal_id'      => $goalId,
            ]);

            // 作成日・完了日を過去にずらして、推移グラフが意味を持つようにする。
            $up = $db->prepare('UPDATE tasks SET created_at = ?, updated_at = ?, done_at = ? WHERE id = ?');
            $up->execute([
                Clock::day($madeOff) . ' 09:30:00',
                Clock::day($doneOff ?? $madeOff) . ' 17:00:00',
                $doneOff === null ? null : Clock::day($doneOff) . ' 17:00:00',
                $task['id'],
            ]);
        }

        // ---- 会話 --------------------------------------------------------
        Chat::post($teamId, $ids['demo'],   ['project_id' => $general, 'body' => "今週もよろしくおねがいします。\n今月は受注1200万円が目標です。ダッシュボードの数字を朝いちで見てから動きましょう。"]);
        Chat::post($teamId, $ids['sakura'], ['project_id' => $general, 'body' => '了解です！ J商店の解約の件、今日中に訪問してきます。']);
        Chat::post($teamId, $ids['ken'],    ['project_id' => $general, 'body' => '@demo 提案書のテンプレ、料金表が新しくなったら差し替えます。']);
        Chat::post($teamId, $ids['demo'],   ['project_id' => $projects[2], 'body' => '料金表、今週中に確認まで持っていきます。']);
        Chat::post($teamId, $ids['yui'],    ['project_id' => $projects[0], 'body' => '展示会のリスト、名寄せが完了しました。明日から電話します。']);

        return [
            'team'      => $team,
            'login'     => 'demo',
            'password'  => self::PASSWORD,
            'people'    => array_keys($ids),
            'tasks'     => count($rows),
        ];
    }
}
