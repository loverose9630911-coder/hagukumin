<?php
/**
 * サーバー側のテスト。
 *
 *   php tests/run.php      （= make test-php）
 *
 * 外に出ていく通信は、ここでは行わない（相手のサービスが止まっていると
 * こちらのテストまで落ちてしまうため）。そのかわり
 *   ・受け取ったものを正しくはじけるか
 *   ・権限のないデータに手が届かないか
 *   ・合言葉が画面に漏れないか
 * を細かく見ている。
 *
 * ミカタとの実際のやりとりだけは、動いているミカタがあるときに限って確かめる。
 *   CANTER_MIKATA_URL=http://127.0.0.1:8080 CANTER_MIKATA_LOGIN=demo \
 *   CANTER_MIKATA_PASSWORD=demo1234 php tests/run.php
 */

declare(strict_types=1);

require __DIR__ . '/../tools/bootstrap.php';

use Canter\ApiError;
use Canter\Assets;
use Canter\Auth;
use Canter\Clock;
use Canter\Connections;
use Canter\Db;
use Canter\Designs;
use Canter\Doc;
use Canter\Publish;
use Canter\Secret;
use Canter\Templates;
use Canter\Workspaces;

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

/**
 * 数として同じか。
 * JSON にすると 999.0 は 999 になって整数として戻ってくるので、
 * 型まで見ると意味のないところで落ちる。数として合っているかだけを見る。
 */
function sameNum(string $what, float $expected, mixed $actual): void
{
    ok($what, is_numeric($actual) && abs($expected - (float) $actual) < 0.0001,
        'ほしい ' . $expected . ' / じっさい ' . json_encode($actual));
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

// ---- まっさらな置き場を用意する -------------------------------------------

$work = sys_get_temp_dir() . '/canter-test-' . getmypid();
@mkdir($work, 0775, true);
putenv('CANTER_DATA=' . $work);
putenv('CANTER_DB=' . $work . '/test.sqlite');
putenv('CANTER_SECRET=test-secret-for-unit-tests');
Db::reset();
Secret::reset();
Clock::freeze('2026-09-04 10:00:00');

// ---- ログインと権限 -------------------------------------------------------

$alice = Auth::register('alice', '有栖', 'password1');
$bob   = Auth::register('bob', 'ボブ', 'password2');

same('登録するとユーザーができる', '有栖', $alice['name']);
ok('パスワードは外に出ない', !array_key_exists('password_hash', $alice));
ok('正しいパスワードで入れる', Auth::login('alice', 'password1')['id'] === $alice['id']);
throws('誤ったパスワードでは入れない', static fn() => Auth::login('alice', 'wrong'));
throws('同じログインIDは登録できない', static fn() => Auth::register('alice', 'にせ有栖', 'password3'));
throws('短いパスワードは断る', static fn() => Auth::register('carol', 'キャロル', '12345'));

$ws   = Workspaces::create($alice['id'], 'デザイン室');
$wsId = $ws['id'];

same('まねきコードは6文字', 6, strlen($ws['join_code']));
throws('メンバーでない人は見られない', static fn() => Workspaces::assertMember($wsId, $bob['id']));

Workspaces::join($bob['id'], $ws['join_code']);
ok('まねきコードで入れる', Workspaces::assertMember($wsId, $bob['id']) !== []);
same('メンバーは2人になった', 2, count(Workspaces::members($wsId)));

$other = Workspaces::create($bob['id'], 'ボブの部屋');

// ---- ブランドキット -------------------------------------------------------

$brand = Workspaces::brand($wsId);
ok('作ったときブランドキットが1つできている', count($brand['colors']) > 0);

$brand = Workspaces::updateBrand($wsId, ['colors' => ['#112233', 'あか', '#ABCDEF'], 'font_head' => 'serif']);
same('色は #rrggbb の形だけ通す', ['#112233', '#abcdef'], $brand['colors']);
same('書体は決まった中からだけ選べる', 'serif', $brand['font_head']);

$brand = Workspaces::updateBrand($wsId, ['font_head' => 'コミック']);
same('知らない書体は前のまま', 'serif', $brand['font_head']);

// ---- デザインの中身の検査 -------------------------------------------------

throws('中身が配列でなければ断る', static fn() => Doc::sanitize('あ'));
throws('小さすぎるキャンバスは断る', static fn() => Doc::sanitize(['w' => 4, 'h' => 4, 'nodes' => []]));
throws('大きすぎるキャンバスは断る', static fn() => Doc::sanitize(['w' => 9000, 'h' => 100, 'nodes' => []]));

$clean = Doc::sanitize([
    'w' => 100, 'h' => 100, 'bg' => '#FFF',
    'nodes' => [
        ['type' => 'rect', 'x' => 1, 'y' => 2, 'w' => 3, 'h' => 4, 'fill' => '#AABBCC', 'radius' => -5, 'いたずら' => 'X'],
        ['type' => 'うそ', 'x' => 0],
        ['type' => 'text', 'text' => 'あ', 'weight' => 123, 'align' => 'ななめ', 'color' => 'red'],
        ['type' => 'image'],
    ],
]);

same('3文字の色は6文字に直す', '#ffffff', $clean['bg']);
same('知らない種類は落とす／画像は元が無ければ落とす', 2, count($clean['nodes']));
same('知らない項目は持ちこせない', false, array_key_exists('いたずら', $clean['nodes'][0]));
same('色は小文字にそろえる', '#aabbcc', $clean['nodes'][0]['fill']);
same('マイナスの丸みは0にする', 0.0, $clean['nodes'][0]['radius']);
same('決まった太さ以外は既定にもどす', 500, $clean['nodes'][1]['weight']);
same('知らないそろえ方は既定にもどす', 'left', $clean['nodes'][1]['align']);
same('読めない色は既定にもどす', '#111111', $clean['nodes'][1]['color']);

$grad = Doc::sanitize(['w' => 100, 'h' => 100, 'nodes' => [
    ['type' => 'rect', 'fill' => ['type' => 'linear', 'angle' => 400, 'a' => '#000000', 'b' => '#ffffff']],
    ['type' => 'rect', 'fill' => ['type' => 'linear', 'a' => 'あか', 'b' => '#ffffff']],
]]);
same('グラデーションは通る', 'linear', $grad['nodes'][0]['fill']['type']);
same('角度は360でひとまわり', 40.0, $grad['nodes'][0]['fill']['angle']);
same('色が読めないグラデーションは無しにする', null, $grad['nodes'][1]['fill']);

$deep = ['type' => 'group', 'kids' => []];
$cur = &$deep;
for ($i = 0; $i < 9; $i++) {
    $cur['kids'] = [['type' => 'group', 'kids' => []]];
    $cur = &$cur['kids'][0];
}
unset($cur);
throws('グループの入れ子が深すぎると断る', static fn() => Doc::sanitize(['w' => 100, 'h' => 100, 'nodes' => [$deep]]));

$many = array_fill(0, Doc::MAX_NODES + 5, ['type' => 'rect']);
throws('図形が多すぎると断る', static fn() => Doc::sanitize(['w' => 100, 'h' => 100, 'nodes' => $many]));

$nan = Doc::sanitize(['w' => 100, 'h' => 100, 'nodes' => [['type' => 'rect', 'x' => 'あ', 'y' => INF]]]);
same('数でないものは0にする', 0.0, $nan['nodes'][0]['x']);
same('無限大は0にする', 0.0, $nan['nodes'][0]['y']);

$path = Doc::sanitize(['w' => 100, 'h' => 100, 'nodes' => [
    ['type' => 'path', 'rule' => 'evenodd', 'd' => [
        ['closed' => true, 'pts' => [['x' => 0, 'y' => 0, 'h2x' => 0.5, 'h2y' => 0.2], ['x' => 1, 'y' => 1], ['x' => 0, 'y' => 1]]],
        ['closed' => true, 'pts' => []],
    ]],
]]);
same('点のないサブパスは落とす', 1, count($path['nodes'][0]['d']));
same('手（ハンドル）は残る', 0.5, $path['nodes'][0]['d'][0]['pts'][0]['h2x']);
same('塗りの決まりは通る', 'evenodd', $path['nodes'][0]['rule']);

// ---- デザインの出し入れ ---------------------------------------------------

$design = Designs::create($wsId, $alice['id'], ['template' => 'ig_notice', 'title' => '9月のお知らせ']);
same('テンプレートから作れる', 1080, $design['w']);
ok('テンプレートの中身が入っている', count($design['doc']['nodes']) > 0);

throws('知らないテンプレートは断る', static fn() => Designs::create($wsId, $alice['id'], ['template' => 'なぞ']));

$blank = Designs::create($wsId, $alice['id'], ['preset' => 'x_post']);
same('プリセットの大きさで作る', [1600, 900], [$blank['w'], $blank['h']]);
same('名前を入れなければ既定の名前', '無題のデザイン', $blank['title']);

throws('ほかのワークスペースのデザインは見られない', static fn() => Designs::get($other['id'], $design['id']));

// 履歴
$doc = $design['doc'];
$doc['nodes'][0]['x'] = 999;
Designs::update($wsId, $alice['id'], $design['id'], ['doc' => $doc]);
sameNum('直したものが入る', 999, Designs::get($wsId, $design['id'])['doc']['nodes'][0]['x']);
same('直す前のものが履歴に残る', 1, count(Designs::versions($wsId, $design['id'])));

$doc['nodes'][0]['x'] = 111;
Designs::update($wsId, $alice['id'], $design['id'], ['doc' => $doc]);
same('同じ人が続けて保存しても履歴は増えない', 1, count(Designs::versions($wsId, $design['id'])));

$doc['nodes'][0]['x'] = 222;
Designs::update($wsId, $bob['id'], $design['id'], ['doc' => $doc]);
same('別の人が保存すると履歴が増える', 2, count(Designs::versions($wsId, $design['id'])));

Clock::freeze('2026-09-04 10:30:00');
$doc['nodes'][0]['x'] = 333;
Designs::update($wsId, $bob['id'], $design['id'], ['doc' => $doc]);
same('時間があけば同じ人でも履歴が増える', 3, count(Designs::versions($wsId, $design['id'])));

// 履歴には「変える直前の姿」が入る。新しいほうから順に並んでいる。
$versions = Designs::versions($wsId, $design['id']);
$restored = Designs::restore($wsId, $alice['id'], $design['id'], $versions[0]['id']);
sameNum('いちばん新しい履歴に戻せる', 222, $restored['doc']['nodes'][0]['x']);

$oldest = Designs::restore($wsId, $alice['id'], $design['id'], $versions[count($versions) - 1]['id']);
sameNum('いちばん古い履歴（作ったときの姿）にも戻せる', 86.4, $oldest['doc']['nodes'][0]['x']);
ok('戻す前の姿も履歴に足される', count(Designs::versions($wsId, $design['id'])) > count($versions));

$copy = Designs::duplicate($wsId, $alice['id'], $design['id']);
same('複製すると名前が変わる', '9月のお知らせ のコピー', $copy['title']);
ok('複製は別のものになる', $copy['id'] !== $design['id']);

same('一覧には作ったぶんだけ出る', 3, count(Designs::list($wsId)));
same('名前でしぼれる', 2, count(Designs::list($wsId, false, 'お知らせ')));

// ---- 画像 -----------------------------------------------------------------

$png = (static function (): string {
    $im = imagecreatetruecolor(60, 40);
    imagefill($im, 0, 0, imagecolorallocate($im, 240, 80, 140));
    ob_start();
    imagepng($im);
    return base64_encode((string) ob_get_clean());
})();

$asset = Assets::store($wsId, $alice['id'], 'data:image/png;base64,' . $png, 'upload', 'てすと.png');
same('画像の大きさを読み取る', [60, 40], [$asset['width'], $asset['height']]);
same('配信 URL は推測しにくい形', 1, preg_match('#\A/a/[0-9a-f]{32}\z#', $asset['url']));

throws('画像でないものは断る', static fn() => Assets::store($wsId, $alice['id'], base64_encode('ただの文字')));
throws('種類をいつわっても中身で見抜く',
    static fn() => Assets::store($wsId, $alice['id'], 'data:image/png;base64,' . base64_encode('PNGのふり')));
throws('ほかのワークスペースの画像は使えない', static fn() => Assets::owned($other['id'], $asset['id']));

same('素材の一覧に出る', 1, count(Assets::library($wsId)));
Assets::store($wsId, $alice['id'], $png, 'render', '書き出し');
same('書き出した PNG は素材の一覧に出さない', 1, count(Assets::library($wsId)));

// 画像を doc に置くときも、持ち主を確かめる
$withImage = Templates::blank(400, 400);
$withImage['nodes'][] = ['type' => 'image', 'asset' => $asset['id'], 'x' => 0, 'y' => 0, 'w' => 100, 'h' => 100];
$updated = Designs::update($wsId, $alice['id'], $blank['id'], ['doc' => $withImage]);
same('自分のワークスペースの画像は置ける', 1, count($updated['doc']['nodes']));
same('置いた画像は元をたどれる', $asset['id'], $updated['doc']['nodes'][0]['asset']);

$stolen = Templates::blank(400, 400);
$stolen['nodes'][] = ['type' => 'image', 'asset' => $asset['id'], 'x' => 0, 'y' => 0, 'w' => 10, 'h' => 10];
throws('ほかのワークスペースからは、その画像を置けない',
    static fn() => Designs::update($other['id'], $bob['id'], Designs::create($other['id'], $bob['id'], [])['id'], ['doc' => $stolen]));

// ---- 合言葉のしまい方 -----------------------------------------------------

$blob = Secret::encrypt(['token' => 'ひみつ']);
ok('しまったものは、そのままでは読めない', !str_contains($blob, 'ひみつ'));
same('取り出すと元にもどる', 'ひみつ', Secret::decrypt($blob)['token']);
same('こわれたものは空でかえす', [], Secret::decrypt('こわれています'));
same('1文字変えると読めなくなる', [], Secret::decrypt(substr($blob, 0, -4) . 'AAAA'));

// ---- つなぎ先 -------------------------------------------------------------

$catalog = Connections::catalog();
same('つなげる先は6つ', 6, count($catalog));
ok('note は書き出しだけ',
    (bool) (array_values(array_filter($catalog, static fn($c) => $c['service'] === 'note'))[0]['capabilities']['export_only'] ?? false));
ok('Instagram は外から見える画像が要る',
    array_values(array_filter($catalog, static fn($c) => $c['service'] === 'instagram'))[0]['needs_public_image']);
ok('X は画像そのものを送る（外から見えなくてよい）',
    !array_values(array_filter($catalog, static fn($c) => $c['service'] === 'x'))[0]['needs_public_image']);
same('X の本文は280文字まで', 280,
    array_values(array_filter($catalog, static fn($c) => $c['service'] === 'x'))[0]['caption_limit']);

throws('知らないサービスにはつなげない', static fn() => Connections::make('mixi'));

$conn = Connections::create($wsId, [
    'service' => 'mikata', 'label' => '社内',
    'config' => ['base_url' => 'http://example.test', 'login' => 'demo', 'password' => 'ひみつ', 'mode' => 'task'],
]);

same('つないだ先が保存される', 'mikata', $conn['service']);
ok('パスワードは画面に返さない', !array_key_exists('password', $conn['config']));
ok('入っていることだけは分かる', $conn['has_secret']['password']);
same('中身は取り出せる（サーバーの中でだけ）', 'ひみつ', Connections::secretConfig($wsId, $conn['id'])['password']);

throws('要る項目が空だと断る', static fn() => Connections::create($wsId, [
    'service' => 'mikata', 'label' => '空', 'config' => ['base_url' => 'http://example.test'],
]));
throws('URL の形でないものは断る', static fn() => Connections::create($wsId, [
    'service' => 'mikata', 'label' => 'へん',
    'config' => ['base_url' => 'ftp://example.test', 'login' => 'a', 'password' => 'b'],
]));
throws('選べない値は断る', static fn() => Connections::create($wsId, [
    'service' => 'mikata', 'label' => '選択',
    'config' => ['base_url' => 'http://example.test', 'login' => 'a', 'password' => 'b', 'mode' => 'おどる'],
]));
throws('同じ名前ではつなげない', static fn() => Connections::create($wsId, [
    'service' => 'mikata', 'label' => '社内',
    'config' => ['base_url' => 'http://example.test', 'login' => 'a', 'password' => 'b'],
]));

Connections::update($wsId, $conn['id'], ['config' => [
    'base_url' => 'http://example.test', 'login' => 'demo2', 'password' => '', 'mode' => 'task',
]]);
same('パスワードを空で送ると前のまま残る', 'ひみつ', Connections::secretConfig($wsId, $conn['id'])['password']);
same('ほかの項目は直る', 'demo2', Connections::secretConfig($wsId, $conn['id'])['login']);

throws('ほかのワークスペースの接続は見られない', static fn() => Connections::get($other['id'], $conn['id']));

// 既定値が入るか
$note = Connections::create($wsId, ['service' => 'note', 'label' => '書き出し', 'config' => []]);
same('空なら既定値が入る', 'https://note.com/notes/new', $note['config']['note_url']);

// ---- 投稿 -----------------------------------------------------------------

$post = Publish::create($wsId, $alice['id'], [
    'connection_id' => $note['id'],
    'design_id'     => $design['id'],
    'image_asset'   => $asset['id'],
    'caption'       => "みだし\n\n本文です。",
    'options'       => ['title' => 'てすと'],
]);

same('下書きができる', 'draft', $post['status']);
same('記録が1行つく', 1, count($post['logs']));

$x = Connections::create($wsId, [
    'service' => 'x', 'label' => 'X本番',
    'config' => ['access_token' => 'dummy', 'api_base' => 'https://api.x.com/2'],
]);
throws('長すぎる本文は断る', static fn() => Publish::create($wsId, $alice['id'], [
    'connection_id' => $x['id'], 'caption' => str_repeat('あ', 281),
]));

$ig = Connections::create($wsId, [
    'service' => 'instagram', 'label' => 'IG',
    'config' => ['ig_user_id' => '1', 'access_token' => 'dummy'],
]);
throws('画像が要るサービスで画像なしは断る', static fn() => Publish::create($wsId, $alice['id'], [
    'connection_id' => $ig['id'], 'caption' => 'あ',
]));

throws('日時なしで予約はできない', static fn() => Publish::create($wsId, $alice['id'], [
    'connection_id' => $conn['id'], 'status' => 'scheduled',
]));
throws('予約に対応していない出し先では予約できない', static fn() => Publish::create($wsId, $alice['id'], [
    'connection_id' => $note['id'], 'image_asset' => $asset['id'],
    'status' => 'scheduled', 'scheduled_at' => '2026-09-05T09:00',
]));

$scheduled = Publish::create($wsId, $alice['id'], [
    'connection_id' => $conn['id'], 'caption' => '予約のテスト',
    'status' => 'scheduled', 'scheduled_at' => '2026-09-05T09:00',
]);
same('予約は日時をそろえて持つ', '2026-09-05 09:00:00', $scheduled['scheduled_at']);
same('まだ時間が来ていないので送らない', 0, count(Publish::runDue($wsId)));

// 送る先を消してから時間を進める。外に出ていかずに「送ろうとした」ところまで確かめられる。
Connections::delete($wsId, $conn['id']);
Clock::freeze('2026-09-05 09:30:00');

$sent = Publish::runDue($wsId);
same('時間が来たら送ろうとする', 1, count($sent));
same('送れなければ失敗として残る', 'failed', $sent[0]['status']);
ok('なぜ失敗したかが残る', $sent[0]['error'] !== '');
same('失敗したものを、勝手に何度も送り直さない', 0, count(Publish::runDue($wsId)));

// note は書き出しだけ。ちゃんと Markdown ができているか。
$ran = Publish::run($wsId, $post['id']);
same('note は送信済みになる', 'done', $ran['status']);
ok('貼りつけ用の Markdown ができる', isset($ran['artifact']['text']));
ok('見出しが入っている', str_contains($ran['artifact']['text'], '# てすと'));
ok('画像の URL が入っている', str_contains($ran['artifact']['text'], '/a/' . $asset['token']));
ok('本文が入っている', str_contains($ran['artifact']['text'], '本文です。'));

throws('送信済みのものは、もう一度は送れない', static fn() => Publish::run($wsId, $post['id']));
throws('送信済みのものは直せない', static fn() => Publish::update($wsId, $post['id'], ['caption' => 'あ']));
throws('ほかのワークスペースの投稿は触れない', static fn() => Publish::get($other['id'], $post['id']));

// 外に出られないときは、ちゃんと理由を言うか
$reach = Assets::reachability();
ok('コマンドラインからは「外から見えない」と分かる', !$reach['public']);
ok('理由が日本語で出る', str_contains($reach['reason'], '外から見えない'));

putenv('CANTER_PUBLIC_URL=https://canter.example.com');
$reach2 = Assets::reachability();
ok('アドレスを入れれば外から見えるとみなす', $reach2['public']);
same('画像の URL はそのアドレスから作る',
    'https://canter.example.com/a/' . $asset['token'], Assets::publicUrl($asset));
putenv('CANTER_PUBLIC_URL=');

// ---- テンプレート ---------------------------------------------------------

same('出し先のプリセットは11通り', 11, count(Templates::PRESETS));
ok('どのプリセットにも白紙がある',
    count(array_filter(Templates::designs(), static fn($d) => str_starts_with($d['id'], 'blank_'))) === 11);

foreach (Templates::designs() as $t) {
    $checked = Doc::sanitize($t['doc']);
    if (count($checked['nodes']) !== count($t['doc']['nodes'])) {
        ok('テンプレート「' . $t['label'] . '」は検査を通る', false, '図形が落ちた');
        break;
    }
}
ok('すべてのテンプレートが検査を通る', true);

// ---- ミカタとのやりとり（動いているときだけ）------------------------------

$mikataUrl = getenv('CANTER_MIKATA_URL');
if (is_string($mikataUrl) && $mikataUrl !== '') {
    $live = Connections::create($wsId, [
        'service' => 'mikata', 'label' => '実機',
        'config' => [
            'base_url' => $mikataUrl,
            'login'    => getenv('CANTER_MIKATA_LOGIN') ?: 'demo',
            'password' => getenv('CANTER_MIKATA_PASSWORD') ?: 'demo1234',
            'mode'     => 'both',
        ],
    ]);

    $check = Connections::verify($wsId, $live['id']);
    ok('ミカタにつながる', $check['ok'], $check['message']);

    if ($check['ok']) {
        $mp = Publish::create($wsId, $alice['id'], [
            'connection_id' => $live['id'],
            'image_asset'   => $asset['id'],
            'caption'       => 'テストから作りました',
            'options'       => ['title' => 'canter のテスト'],
        ]);
        $out = Publish::run($wsId, $mp['id']);
        ok('ミカタにタスクを立てられる', $out['status'] === 'done', $out['error']);
        ok('タスクのIDが返る', $out['external_id'] !== '');
    }
} else {
    echo "… ミカタとの実際のやりとりは、CANTER_MIKATA_URL が無いのでとばしました\n";
}

// ---- 後始末 ---------------------------------------------------------------

exec('rm -rf ' . escapeshellarg($work));

echo "\n{$pass} 件たしかめました\n";
if ($fail !== []) {
    echo "\n✗ " . count($fail) . " 件しっぱい\n";
    foreach ($fail as $f) {
        echo "   - {$f}\n";
    }
    exit(1);
}
echo "✓ ぜんぶ通りました\n";
