<?php
/**
 * テスト。
 *
 *   php tests/run.php
 *
 * 画面のない部分（数え方・権限・自動投稿）を確かめる。
 * 可視化の数字がずれても目で気づきにくいので、集計はとくに細かく見ている。
 */

declare(strict_types=1);

require __DIR__ . '/../tools/bootstrap.php';

use Mikata\ApiError;
use Mikata\Auth;
use Mikata\Chat;
use Mikata\Clock;
use Mikata\Db;
use Mikata\Goals;
use Mikata\Metrics;
use Mikata\Tasks;
use Mikata\Teams;

$pass = 0;
$fail = [];

function ok(string $what, bool $cond, string $extra = ''): void
{
    global $pass, $fail;
    if ($cond) {
        $pass++;
    } else {
        $fail[] = $what . ($extra !== '' ? "  ({$extra})" : '');
    }
}

function same(string $what, mixed $expected, mixed $actual): void
{
    ok($what, $expected === $actual, 'ほしい ' . json_encode($expected, JSON_UNESCAPED_UNICODE)
        . ' / じっさい ' . json_encode($actual, JSON_UNESCAPED_UNICODE));
}

function throws(string $what, callable $fn): void
{
    try {
        $fn();
        ok($what, false, '例外が出なかった');
    } catch (ApiError) {
        ok($what, true);
    }
}

// ---- 空の DB を用意する ------------------------------------------

$dbFile = sys_get_temp_dir() . '/mikata-test-' . getmypid() . '.sqlite';
foreach ([$dbFile, $dbFile . '-wal', $dbFile . '-shm'] as $f) {
    @unlink($f);
}
putenv('MIKATA_DB=' . $dbFile);
Db::reset();
Clock::freeze('2026-08-29 10:00:00');

$today = Clock::today();

// ---- ログインまわり ----------------------------------------------------

$alice = Auth::register('alice', '有栖', 'password1');
$bob   = Auth::register('bob', 'ボブ', 'password2');

same('登録するとユーザーができる', '有栖', $alice['name']);
ok('パスワードは外に出ない', !array_key_exists('password_hash', $alice));
ok('正しいパスワードで入れる', Auth::login('alice', 'password1')['id'] === $alice['id']);
throws('誤ったパスワードでは入れない', static fn() => Auth::login('alice', 'wrong'));
throws('同じログインIDは登録できない', static fn() => Auth::register('alice', 'にせ有栖', 'password3'));
throws('短いパスワードは断る', static fn() => Auth::register('carol', 'キャロル', '12345'));

// ---- チームと権限 ------------------------------------------------------

$team   = Teams::create($alice['id'], '営業チーム');
$teamId = $team['id'];

same('チームの参加コードは6文字', 6, strlen($team['join_code']));
same('最初から2つのチャンネルがある', 2, count(Teams::projects($teamId)));
throws('メンバーでない人は見られない', static fn() => Teams::assertMember($teamId, $bob['id']));

Teams::join($bob['id'], $team['join_code']);
ok('参加コードで入れる', Teams::assertMember($teamId, $bob['id']) !== []);
same('メンバーは2人になった', 2, count(Teams::members($teamId)));

Teams::join($bob['id'], $team['join_code']);
same('二重に入っても増えない', 2, count(Teams::members($teamId)));

throws('オーナー以外は他人の設定を変えられない',
    static fn() => Teams::updateMember($teamId, $bob['id'], $alice['id'], ['capacity_h' => 5]));

Teams::updateMember($teamId, $bob['id'], $bob['id'], ['capacity_h' => 10]);
$bobMember = array_values(array_filter(Teams::members($teamId), static fn($m) => $m['id'] === $bob['id']))[0];
same('自分の設定は変えられる', 10.0, $bobMember['capacity_h']);

$project = Teams::projects($teamId)[1]['id'];

// ---- タスクの入力チェック ----------------------------------------------

throws('タスク名が空だと断る',
    static fn() => Tasks::create($teamId, $alice['id'], ['title' => '  ', 'project_id' => $project]));
throws('日付の形がちがうと断る',
    static fn() => Tasks::create($teamId, $alice['id'], ['title' => 'x', 'project_id' => $project, 'due_date' => '2026/09/01']));
throws('ありえない日付は断る',
    static fn() => Tasks::create($teamId, $alice['id'], ['title' => 'x', 'project_id' => $project, 'due_date' => '2026-02-30']));
throws('チーム外の人は担当にできない',
    static fn() => Tasks::create($teamId, $alice['id'], ['title' => 'x', 'project_id' => $project, 'assignee_id' => 999]));
throws('他のチームのプロジェクトには置けない',
    static fn() => Tasks::create($teamId, $alice['id'], ['title' => 'x', 'project_id' => 99999]));

// ---- 納期の分けかた ----------------------------------------------------

$mk = static function (array $over) use ($teamId, $alice, $project): array {
    return Tasks::create($teamId, $alice['id'], $over + [
        'title'       => 'タスク',
        'project_id'  => $project,
        'assignee_id' => $alice['id'],
        'estimate_h'  => 2,
    ]);
};

$overdue  = $mk(['title' => '遅れているもの', 'due_date' => Clock::day(-2)]);
$dueToday = $mk(['title' => '今日まで',       'due_date' => $today]);
$soon     = $mk(['title' => 'もうすぐ',       'due_date' => Clock::day(2)]);
$later    = $mk(['title' => 'まだ先',         'due_date' => Clock::day(10)]);
$nodate   = $mk(['title' => '納期なし']);
$doneOld  = $mk(['title' => '完了したもの',   'due_date' => Clock::day(-5), 'status' => 'done']);

$all = Tasks::all($teamId);
$due = Metrics::countByDue($all, $today);

same('遅れ 1件',      1, $due['overdue']);
same('今日まで 1件',  1, $due['today']);
same('もうすぐ 1件',  1, $due['soon']);
same('まだ先 1件',    1, $due['later']);
same('納期なし 1件',  1, $due['none']);
same('完了したものは納期の心配に数えない', 5, array_sum($due));

same('ちょうど3日先は「もうすぐ」', 'soon',  Metrics::dueBucket(Clock::day(3), $today));
same('4日先は「まだ先」',           'later', Metrics::dueBucket(Clock::day(4), $today));
same('納期なしは none',             'none',  Metrics::dueBucket(null, $today));

// ---- 完了率・負荷 ------------------------------------------------------

same('完了率は 1/6', round(1 / 6, 4), Metrics::doneRate($all));
same('タスクが無ければ完了率は null', null, Metrics::doneRate([]));

$load = Metrics::load($all, 30);
same('未完了の見積だけ数える', 10.0, $load['open_hours']);   // 2時間 × 5件
same('負荷は 10 ÷ 30',        round(10 / 30, 3), $load['rate']);
same('使える時間が0なら負荷は出さない', null, Metrics::load($all, 0)['rate']);

// ---- 完了したときだけ done_at が入る -----------------------------------

same('完了前は done_at なし', null, Tasks::get($teamId, $soon['id'])['done_at']);
Tasks::update($teamId, $alice['id'], $soon['id'], ['status' => 'done']);
ok('完了すると done_at が入る', Tasks::get($teamId, $soon['id'])['done_at'] !== null);
Tasks::update($teamId, $alice['id'], $soon['id'], ['status' => 'doing']);
same('もどすと done_at が消える', null, Tasks::get($teamId, $soon['id'])['done_at']);

// ---- 変更がスレッドに流れる --------------------------------------------

$before = count(Chat::thread($teamId, $overdue['id']));
Tasks::update($teamId, $bob['id'], $overdue['id'], ['status' => 'doing']);
$after = Chat::thread($teamId, $overdue['id']);
same('ステータスを変えるとスレッドに1行増える', $before + 1, count($after));
same('その1行は system 扱い', 'system', end($after)['kind']);
ok('中身に新しいステータスが入っている', str_contains(end($after)['body'], '進行中'));

$n = count(Chat::thread($teamId, $overdue['id']));
Tasks::update($teamId, $bob['id'], $overdue['id'], ['body' => 'メモだけ変える']);
same('メモだけの変更では流れない', $n, count(Chat::thread($teamId, $overdue['id'])));

// ---- 目標の集計 --------------------------------------------------------

$goalSum = Goals::create($teamId, $alice['id'], [
    'title' => '受注', 'unit' => '万円', 'target_value' => 100, 'rollup' => 'tasks', 'due_date' => Clock::day(10),
]);
$goalCnt = Goals::create($teamId, $alice['id'], [
    'title' => '訪問', 'unit' => '件', 'target_value' => 4, 'rollup' => 'done_count',
]);
$goalMan = Goals::create($teamId, $alice['id'], [
    'title' => '手入力', 'unit' => 'pt', 'target_value' => 50, 'rollup' => 'manual', 'manual_value' => 20,
]);

$t1 = $mk(['title' => '案件1', 'goal_id' => $goalSum['id'], 'target_value' => 40, 'actual_value' => 30]);
$t2 = $mk(['title' => '案件2', 'goal_id' => $goalSum['id'], 'target_value' => 60, 'actual_value' => 15]);
$v1 = $mk(['title' => '訪問1', 'goal_id' => $goalCnt['id'], 'status' => 'done']);
$v2 = $mk(['title' => '訪問2', 'goal_id' => $goalCnt['id']]);

$byId = [];
foreach (Goals::progress(Goals::all($teamId), Tasks::all($teamId)) as $g) {
    $byId[$g['id']] = $g;
}

same('tasks は実績値の合計',        45.0, $byId[$goalSum['id']]['current_value']);
same('その達成率は 45%',            0.45, $byId[$goalSum['id']]['rate']);
same('done_count は完了した数',      1.0, $byId[$goalCnt['id']]['current_value']);
same('その達成率は 25%',            0.25, $byId[$goalCnt['id']]['rate']);
same('manual は入れた数字そのまま',  20.0, $byId[$goalMan['id']]['current_value']);
same('manual の達成率は 20/50',      0.4, $byId[$goalMan['id']]['rate']);
same('紐づいたタスクの数',           2, $byId[$goalSum['id']]['linked_total']);
same('うち完了した数',                 0, $byId[$goalSum['id']]['linked_done']);

same('期限なしの目標は pace を出さない', false, $byId[$goalCnt['id']]['pace']['known']);
same('期限ありの目標は pace を出す',     true,  $byId[$goalSum['id']]['pace']['known']);
same('残り日数',                        10,   $byId[$goalSum['id']]['pace']['days_left']);
// 今日つくって期限は10日後。まだ1日も経っていないのに45%進んでいる → 予定より早い
same('初日に45%進んでいれば予定より早い', 'ahead', $byId[$goalSum['id']]['pace']['state']);

// 目標値が0のときに割り算で落ちないこと
$zero = Goals::create($teamId, $alice['id'], ['title' => 'ゼロ目標', 'target_value' => 0, 'rollup' => 'manual']);
$zeroProg = null;
foreach (Goals::progress(Goals::all($teamId), Tasks::all($teamId)) as $g) {
    if ($g['id'] === $zero['id']) {
        $zeroProg = $g;
    }
}
same('目標値が0でも落ちない', 0.0, $zeroProg['rate']);

// ---- チーム目標 ＝ 個人目標の合計 --------------------------------------

$teamGoal = Goals::create($teamId, $alice['id'], [
    'title' => 'チーム受注', 'scope' => 'team', 'unit' => '万円',
    'target_value' => 300, 'rollup' => 'children', 'due_date' => Clock::day(10),
]);
$kidA = Goals::create($teamId, $alice['id'], [
    'title' => '有栖の受注', 'scope' => 'personal', 'owner_id' => $alice['id'],
    'unit' => '万円', 'target_value' => 200, 'rollup' => 'manual', 'manual_value' => 120,
    'parent_id' => $teamGoal['id'],
]);
$kidB = Goals::create($teamId, $alice['id'], [
    'title' => 'ボブの受注', 'scope' => 'personal', 'owner_id' => $bob['id'],
    'unit' => '万円', 'target_value' => 100, 'rollup' => 'manual', 'manual_value' => 30,
    'parent_id' => $teamGoal['id'],
]);

$byId2 = [];
foreach (Goals::progress(Goals::all($teamId), Tasks::all($teamId)) as $g) {
    $byId2[$g['id']] = $g;
}

same('チーム目標は子の合計になる', 150.0, $byId2[$teamGoal['id']]['current_value']);
same('その達成率は 150/300', 0.5, $byId2[$teamGoal['id']]['rate']);
same('誰の積み上げか分かる', 2, count($byId2[$teamGoal['id']]['contributors']));
same('内訳の1人目', 120.0, $byId2[$teamGoal['id']]['contributors'][0]['current_value']);
same('子じしんの数字は変わらない', 120.0, $byId2[$kidA['id']]['current_value']);
same('子には親のIDが入っている', $teamGoal['id'], $byId2[$kidA['id']]['parent_id']);

throws('チーム目標を紐づけることはできない', static fn() => Goals::create($teamId, $alice['id'], [
    'title' => 'だめな例', 'scope' => 'team', 'target_value' => 10, 'parent_id' => $teamGoal['id'],
]));
throws('個人目標には紐づけられない', static fn() => Goals::create($teamId, $alice['id'], [
    'title' => 'だめな例2', 'scope' => 'personal', 'owner_id' => $alice['id'],
    'target_value' => 10, 'parent_id' => $kidA['id'],
]));
throws('自分自身には紐づけられない',
    static fn() => Goals::update($teamId, $kidA['id'], ['parent_id' => $kidA['id']]));
throws('存在しない目標には紐づけられない', static fn() => Goals::create($teamId, $alice['id'], [
    'title' => 'だめな例3', 'scope' => 'personal', 'owner_id' => $alice['id'],
    'target_value' => 10, 'parent_id' => 99999,
]));

// チーム目標に切りかえたら、親からは自動で切りはなす
Goals::update($teamId, $kidB['id'], ['scope' => 'team']);
same('チーム目標にすると親から外れる', null, Goals::get($teamId, $kidB['id'])['parent_id']);
$after2 = [];
foreach (Goals::progress(Goals::all($teamId), Tasks::all($teamId)) as $g) {
    $after2[$g['id']] = $g;
}
same('外れたぶんは合計から抜ける', 120.0, $after2[$teamGoal['id']]['current_value']);

// あと後片付け（このあとの集計テストに影響させない）
Goals::delete($teamId, $kidA['id']);
Goals::delete($teamId, $kidB['id']);
Goals::delete($teamId, $teamGoal['id']);
same('消したら一覧から消える', false, in_array($teamGoal['id'], array_column(Goals::all($teamId), 'id'), true));
throws('無い目標は消せない', static fn() => Goals::delete($teamId, 99999));

// ---- 1人ぶんのまとめ ---------------------------------------------------

$members     = Teams::members($teamId);
$aliceMember = array_values(array_filter($members, static fn($m) => $m['id'] === $alice['id']))[0];
$aliceTasks  = Metrics::assignedTo(Tasks::all($teamId), $alice['id']);
$summary     = Metrics::personSummary($aliceMember, $aliceTasks, [], $today);

same('担当タスクの数', count($aliceTasks), $summary['total']);
same('目標値つきタスクの数', 2, $summary['value']['count']);
same('目標値の合計', 100.0, $summary['value']['target']);
same('実績の合計', 45.0, $summary['value']['actual']);
same('数字の達成率', 0.45, $summary['value']['rate']);
same('スパークラインは7日ぶん', 7, count($summary['trend7']));
same('目標がなければ平均は null', null, $summary['goals']['rate']);

// ---- 危ないタスクの並び ------------------------------------------------

$risks = Metrics::risks(Tasks::all($teamId), $today);
ok('危ないタスクが拾えている', count($risks) >= 2);
ok('いちばん上は遅れているもの', $risks[0]['days_left'] < 0);
same('4日以上先のものは入らない', 0, count(array_filter($risks, static fn($r) => $r['days_left'] > 3)));
same('完了ずみは入らない', 0, count(array_filter($risks, static fn($r) => $r['id'] === $doneOld['id'])));

// ---- 会話・未読・メンション --------------------------------------------

$general = Teams::projects($teamId)[0]['id'];
Chat::post($teamId, $bob['id'], ['project_id' => $general, 'body' => '@alice これ見てください']);
Chat::post($teamId, $bob['id'], ['project_id' => $general, 'body' => 'もう1件あります']);

same('相手の書き込み2件が未読になる', 2, Chat::unread($teamId, $alice['id'])[(string) $general] ?? 0);
same('自分の書き込みは未読にならない', 0, Chat::unread($teamId, $bob['id'])[(string) $general] ?? 0);

same('自分あてのメンションが拾える', 1, count(Chat::mentions($teamId, $alice['id'], 'alice')));
same('自分あてでなければ拾わない', 0, count(Chat::mentions($teamId, $bob['id'], 'bob')));

Chat::markRead($teamId, $alice['id'], $general);
same('既読にすると未読が消える', 0, Chat::unread($teamId, $alice['id'])[(string) $general] ?? 0);
same('既読にするとメンションも消える', 0, count(Chat::mentions($teamId, $alice['id'], 'alice')));

throws('空のメッセージは断る', static fn() => Chat::post($teamId, $alice['id'], ['project_id' => $general, 'body' => '   ']));
throws('無いタスクには書けない', static fn() => Chat::post($teamId, $alice['id'], ['task_id' => 99999, 'body' => 'x']));

$msg = Chat::post($teamId, $alice['id'], ['task_id' => $t1['id'], 'body' => 'すすめます']);
same('スレッドの発言はタスクのチャンネルに入る', $project, $msg['project_id']);

// ---- ぜんぶまとめた集計 ------------------------------------------------

$m = Metrics::build($teamId, $alice['id']);

same('チーム名', '営業チーム', $m['team']['name']);
same('メンバー数', 2, $m['team']['member_count']);
same('推移は14日ぶん', 14, count($m['team']['trend']));
same('メンバーごとのまとめが人数ぶんある', 2, count($m['team']['members']));
same('自分のまとめが入っている', $alice['id'], $m['me']['user_id']);
same('チーム目標が4件', 4, count($m['team']['goals']['team']));
same('個人目標はまだ0件', 0, count($m['team']['goals']['personal']));
same('プロジェクトごとの集計がある', 2, count($m['team']['projects']));
same('ステータスの合計はタスク総数と一致', $m['team']['total'], array_sum($m['team']['status']));

$orphan = Tasks::create($teamId, $alice['id'], ['title' => '担当なし', 'project_id' => $project, 'estimate_h' => 3]);
$m2 = Metrics::build($teamId, $alice['id']);
same('担当なしの件数', 1, $m2['team']['unassigned']['count']);
same('担当なしの時間', 3.0, $m2['team']['unassigned']['hours']);

// 個人目標はその人のところにだけ出る
Goals::create($teamId, $alice['id'], [
    'title' => '有栖の目標', 'scope' => 'personal', 'owner_id' => $alice['id'],
    'target_value' => 10, 'rollup' => 'manual', 'manual_value' => 5,
]);
$m3 = Metrics::build($teamId, $alice['id']);
same('個人目標が1件発生', 1, count($m3['team']['goals']['personal']));
same('自分の欄にも出る', 1, $m3['me']['goals']['count']);
same('個人目標の平均達成率', 0.5, $m3['me']['goals']['rate']);
$bobSummary = array_values(array_filter($m3['team']['members'], static fn($p) => $p['user_id'] === $bob['id']))[0];
same('他の人の欄には出ない', 0, $bobSummary['goals']['count']);

// ---- 後片付け ----------------------------------------------------------

foreach ([$dbFile, $dbFile . '-wal', $dbFile . '-shm'] as $f) {
    @unlink($f);
}

echo "\n";
if ($fail === []) {
    echo "✓ 全て成功しました（{$pass}件）\n";
    exit(0);
}
echo "✗ 失敗した項目（" . count($fail) . "件 / 成功は {$pass}件）\n";
foreach ($fail as $f) {
    echo "  - {$f}\n";
}
exit(1);
