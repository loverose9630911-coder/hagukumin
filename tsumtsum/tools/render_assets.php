<?php
/**
 * キャラクター画像とアプリアイコンを PHP-GD で描き出す。
 *
 *   php tools/render_assets.php
 *
 * 色やキャラの並びは Python が書き出した public/assets/config.json を読むので、
 * キャラを増やすときは engine/hagukumin/characters.py だけ直せばよい。
 * 画像ファイルは一切使わず、すべてこのスクリプトが図形を組み合わせて描く。
 * アプリアイコンは「ぞうさん」（config の icon_id）で作る。
 */

declare(strict_types=1);

require __DIR__ . '/../src/Draw.php';

use Hagukumin\Draw;

const SS = 4;              // スーパーサンプリング倍率（描いてから縮めて滑らかにする）
const SPRITE_R = 110;      // スプライト内でのツム半径
const BOX_W = 2.70;        // 画像の幅  = r * BOX_W（ぞうの大きな耳が入る幅）
const BOX_H = 2.95;        // 画像の高さ = r * BOX_H
const BOX_BASE = 1.25;     // 下端から体の中心までの距離 = r * BOX_BASE

$root = dirname(__DIR__);
$configPath = $root . '/public/assets/config.json';
if (!is_file($configPath)) {
    fwrite(STDERR, "config.json がありません。先に `python3 engine/export_config.py` を実行してください。\n");
    exit(1);
}
$config = json_decode((string)file_get_contents($configPath), true);
$outDir = $root . '/public/assets/img';
if (!is_dir($outDir)) {
    mkdir($outDir, 0775, true);
}

$made = 0;
foreach ($config['characters'] as $char) {
    $path = $outDir . '/tsum_' . $char['id'] . '.png';
    renderTsum($char, $path);
    echo "  描きました: " . basename($path) . "  ({$char['name']})\n";
    $made++;
}

renderBomb($outDir . '/bomb.png', false);
renderBomb($outDir . '/bomb_time.png', true);
echo "  描きました: bomb.png / bomb_time.png\n";

$iconChar = null;
foreach ($config['characters'] as $char) {
    if ($char['id'] === $config['icon_id']) {
        $iconChar = $char;
    }
}
foreach ([512, 192, 180, 32] as $size) {
    $name = match ($size) {
        180 => 'apple-touch-icon.png',
        32  => 'favicon-32.png',
        default => "icon-{$size}.png",
    };
    renderIcon($iconChar, $outDir . '/' . $name, $size);
    echo "  描きました: {$name}  (アプリアイコン: {$iconChar['name']})\n";
}

file_put_contents($root . '/public/assets/sprites.json', json_encode([
    'sprite_r' => SPRITE_R,
    'box_w'    => BOX_W,
    'box_h'    => BOX_H,
    'box_base' => BOX_BASE,
], JSON_PRETTY_PRINT) . "\n");

echo "キャラクター {$made} 体ぶんの画像を作りました。\n";


/* ===================================================================
 *  ツムのスプライト
 * =================================================================*/

function renderTsum(array $char, string $path): void
{
    $r = SPRITE_R * SS;
    $w = (int)round($r * BOX_W);
    $h = (int)round($r * BOX_H);
    $im = Draw::canvas($w, $h);
    $cx = $w / 2;
    $cy = $h - $r * BOX_BASE;

    drawByKind($im, $char, $cx, $cy, (float)$r);

    Draw::save($im, $path, (int)round($w / SS), (int)round($h / SS));
}

function drawByKind($im, array $char, float $cx, float $cy, float $r): void
{
    $body   = $char['body'];
    $shade  = $char['shade'];
    $inner  = $char['inner'];
    $cheek  = $char['cheek'];
    $accent = $char['accent'];

    // 影
    Draw::ellipse($im, $cx, $cy + $r * 0.88, $r * 0.72, $r * 0.16, '#000000', 0.14);

    switch ($char['kind']) {
        case 'elephant':
            elephantEars($im, $cx, $cy, $r, $body, $shade, $inner);
            Draw::blob($im, $cx, $cy, $r, $body, $shade);
            bellyLight($im, $cx, $cy, $r, $inner);
            elephantTrunk($im, $cx, $cy, $r, $body, $shade);
            happyEyes($im, $cx, $cy, $r, 0.30);
            cheeks($im, $cx, $cy, $r, $cheek);
            cap($im, $cx, $cy, $r, $accent);
            break;

        case 'rabbit':
            rabbitEars($im, $cx, $cy, $r, $body, $shade, $inner);
            Draw::blob($im, $cx, $cy, $r, $body, $shade);
            bellyLight($im, $cx, $cy, $r, $inner);
            happyEyes($im, $cx, $cy, $r, 0.06);
            smallMouth($im, $cx, $cy, $r, $shade);
            cheeks($im, $cx, $cy, $r, $cheek);
            strawHat($im, $cx, $cy, $r, $accent, '#4A82C4');
            break;

        case 'capybara':
            roundEars($im, $cx, $cy, $r, $body, $shade, 0.60, -0.66, 0.26);
            Draw::blob($im, $cx, $cy, $r, $body, $shade);
            capybaraSnout($im, $cx, $cy, $r, $inner, $shade);
            sleepyEyes($im, $cx, $cy, $r);
            cheeks($im, $cx, $cy, $r, $cheek);
            towel($im, $cx, $cy, $r, $accent, $shade);
            break;

        case 'giraffe':
            roundEars($im, $cx, $cy, $r, $body, $shade, 0.74, -0.44, 0.22);
            Draw::blob($im, $cx, $cy, $r, $body, $shade);
            giraffeSpots($im, $cx, $cy, $r, $char['shade']);
            bellyLight($im, $cx, $cy, $r, $inner);
            dotEyes($im, $cx, $cy, $r);
            smallMouth($im, $cx, $cy, $r, $shade);
            cheeks($im, $cx, $cy, $r, $cheek);
            bandana($im, $cx, $cy, $r, $accent);
            strawHat($im, $cx, $cy, $r, '#E8C98A', '#C9A05A');
            giraffeHorns($im, $cx, $cy, $r, $body, $shade);
            break;

        case 'panda':
            pandaEars($im, $cx, $cy, $r, $char['shade']);
            Draw::blob($im, $cx, $cy, $r, $body, '#BDBDBD');
            pandaPatches($im, $cx, $cy, $r, $char['shade']);
            pandaEyes($im, $cx, $cy, $r);
            smallMouth($im, $cx, $cy, $r, '#3A3A3A');
            cheeks($im, $cx, $cy, $r, $cheek);
            overall($im, $cx, $cy, $r, $accent);
            break;

        case 'beaver':
        default:
            roundEars($im, $cx, $cy, $r, $body, $shade, 0.62, -0.70, 0.24);
            Draw::blob($im, $cx, $cy, $r, $body, $shade);
            beaverMuzzle($im, $cx, $cy, $r, $inner, $shade);
            dotEyes($im, $cx, $cy, $r);
            cheeks($im, $cx, $cy, $r, $cheek);
            strawHat($im, $cx, $cy, $r, $accent, '#C9A05A');
            break;
    }
}

/* ---------------------------------------------------------------- 共通パーツ */

function bellyLight($im, float $cx, float $cy, float $r, string $inner): void
{
    Draw::ellipse($im, $cx, $cy + $r * 0.30, $r * 0.52, $r * 0.44, $inner, 0.50);
}

function cheeks($im, float $cx, float $cy, float $r, string $color): void
{
    foreach ([-1, 1] as $s) {
        Draw::ellipse($im, $cx + $s * $r * 0.60, $cy + $r * 0.22,
            $r * 0.16, $r * 0.11, $color, 0.55);
    }
}

function dotEyes($im, float $cx, float $cy, float $r, float $dy = -0.06): void
{
    foreach ([-1, 1] as $s) {
        $x = $cx + $s * $r * 0.34;
        $y = $cy + $r * $dy;
        Draw::ellipse($im, $x, $y, $r * 0.135, $r * 0.175, '#3B2A21');
        Draw::ellipse($im, $x - $r * 0.045, $y - $r * 0.06, $r * 0.055, $r * 0.055, '#FFFFFF');
    }
}

/** 目を閉じてにっこりしている顔（イラストの表情に合わせる） */
function happyEyes($im, float $cx, float $cy, float $r, float $spread = 0.06): void
{
    foreach ([-1, 1] as $s) {
        $x = $cx + $s * $r * (0.34 + $spread);
        $y = $cy - $r * 0.02;
        Draw::arc($im, $x, $y + $r * 0.07, $r * 0.18, $r * 0.16,
            200, 340, '#3B2A21', $r * 0.075);
    }
}

function sleepyEyes($im, float $cx, float $cy, float $r): void
{
    foreach ([-1, 1] as $s) {
        $x = $cx + $s * $r * 0.34;
        Draw::arc($im, $x, $cy + $r * 0.02, $r * 0.17, $r * 0.15,
            200, 340, '#3B2A21', $r * 0.07);
    }
}

function smallMouth($im, float $cx, float $cy, float $r, string $color): void
{
    Draw::arc($im, $cx, $cy + $r * 0.26, $r * 0.17, $r * 0.15, 20, 160, $color, $r * 0.06);
}

function roundEars($im, float $cx, float $cy, float $r, string $body, string $shade,
                   float $ox, float $oy, float $er): void
{
    foreach ([-1, 1] as $s) {
        Draw::circleOutlined($im, $cx + $s * $r * $ox, $cy + $r * $oy,
            $r * $er, $body, $shade, $r * 0.06);
    }
}

/* ---------------------------------------------------------------- ぞう */

function elephantEars($im, float $cx, float $cy, float $r, string $body,
                      string $shade, string $inner): void
{
    // 大きな扇形の耳（イラストの特徴）
    foreach ([-1, 1] as $s) {
        $x = $cx + $s * $r * 0.88;
        $y = $cy - $r * 0.18;
        Draw::circleOutlined($im, $x, $y, $r * 0.46, $body, $shade, $r * 0.055);
        Draw::ellipse($im, $x + $s * $r * 0.05, $y + $r * 0.04,
            $r * 0.30, $r * 0.34, $inner, 0.9);
    }
}

function elephantTrunk($im, float $cx, float $cy, float $r, string $body,
                       string $shade): void
{
    // 顔の中央から下へ垂れて、先が少しはね上がる鼻
    $pts = Draw::quadPoints(
        $cx, $cy + $r * 0.02,
        $cx - $r * 0.06, $cy + $r * 0.64,
        $cx + $r * 0.28, $cy + $r * 0.74,
        28
    );
    $trunk = Draw::mix($body, '#FFFFFF', 0.10);
    Draw::taperedPath($im, $pts, $r * 0.17, $r * 0.075, $shade, $r * 0.042);
    Draw::taperedPath($im, $pts, $r * 0.17, $r * 0.075, $trunk, 0.0);
    // 鼻のしわ
    for ($i = 1; $i <= 3; $i++) {
        $idx = (int)round(count($pts) * (0.30 + $i * 0.14));
        $p = $pts[min($idx, count($pts) - 1)];
        $w = $r * (0.14 - $i * 0.022);
        Draw::line($im, $p[0] - $w, $p[1], $p[0] + $w, $p[1], $shade, $r * 0.022, 0.5);
    }
}

function cap($im, float $cx, float $cy, float $r, string $accent): void
{
    // 青白のキャップ（左が白、右が青の 2 トーン）
    $top = $cy - $r * 0.70;
    $dark = Draw::mix($accent, '#000000', 0.22);
    Draw::arcFilled($im, $cx, $top, $r * 0.70, $r * 0.62, 180, 360, $accent);
    Draw::arcFilled($im, $cx, $top, $r * 0.70, $r * 0.62, 180, 270, '#F4F7FA');
    Draw::ellipse($im, $cx, $top - $r * 0.60, $r * 0.09, $r * 0.09, $dark);
    // つば
    Draw::ellipse($im, $cx + $r * 0.52, $top + $r * 0.02, $r * 0.40, $r * 0.13, $dark);
    Draw::line($im, $cx - $r * 0.70, $top, $cx + $r * 0.70, $top, $dark, $r * 0.05);
}

/* ---------------------------------------------------------------- うさぎ */

function rabbitEars($im, float $cx, float $cy, float $r, string $body,
                    string $shade, string $inner): void
{
    foreach ([-1, 1] as $s) {
        $x = $cx + $s * $r * 0.40;
        $y = $cy - $r * 1.06;
        Draw::ellipseOutlined($im, $x + $s * $r * 0.06, $y, $r * 0.19, $r * 0.50,
            $body, $shade, $r * 0.055, $s * 10.0);
        Draw::ellipse($im, $x + $s * $r * 0.06, $y + $r * 0.03,
            $r * 0.09, $r * 0.32, $inner, 0.95);
    }
}

function strawHat($im, float $cx, float $cy, float $r, string $straw,
                  string $ribbon): void
{
    $top = $cy - $r * 0.66;
    Draw::ellipse($im, $cx, $top + $r * 0.12, $r * 0.98, $r * 0.20, $straw);
    Draw::line($im, $cx - $r * 0.98, $top + $r * 0.12, $cx + $r * 0.98, $top + $r * 0.12,
        '#C9A05A', $r * 0.035);
    Draw::arcFilled($im, $cx, $top + $r * 0.12, $r * 0.56, $r * 0.52, 180, 360, $straw);
    Draw::arcFilled($im, $cx, $top + $r * 0.12, $r * 0.56, $r * 0.16, 180, 360, $ribbon);
    Draw::arc($im, $cx, $top + $r * 0.12, $r * 0.56, $r * 0.52, 180, 360,
        '#C9A05A', $r * 0.035);
}

/* ---------------------------------------------------------------- カピバラ */

function capybaraSnout($im, float $cx, float $cy, float $r, string $inner,
                       string $shade): void
{
    Draw::ellipse($im, $cx, $cy + $r * 0.34, $r * 0.40, $r * 0.30, $inner, 0.75);
    Draw::ellipse($im, $cx, $cy + $r * 0.20, $r * 0.12, $r * 0.09, '#3B2A21');
    Draw::arc($im, $cx, $cy + $r * 0.36, $r * 0.16, $r * 0.14, 20, 160, $shade, $r * 0.055);
}

function towel($im, float $cx, float $cy, float $r, string $color,
               string $shade): void
{
    // 頭にのせた白いタオル（角を丸めてふんわり見せる）
    $edge = '#C9CDD2';
    Draw::ellipse($im, $cx + $r * 0.02, $cy - $r * 0.70, $r * 0.72, $r * 0.19,
        $edge, 1.0, -7.0);
    Draw::ellipse($im, $cx + $r * 0.02, $cy - $r * 0.71, $r * 0.68, $r * 0.15,
        $color, 1.0, -7.0);
    Draw::ellipse($im, $cx - $r * 0.04, $cy - $r * 0.84, $r * 0.46, $r * 0.12,
        $edge, 1.0, -9.0);
    Draw::ellipse($im, $cx - $r * 0.04, $cy - $r * 0.85, $r * 0.42, $r * 0.09,
        $color, 1.0, -9.0);
}

/* ---------------------------------------------------------------- キリン */

function giraffeHorns($im, float $cx, float $cy, float $r, string $body,
                      string $shade): void
{
    foreach ([-1, 1] as $s) {
        $x = $cx + $s * $r * 0.28;
        $y = $cy - $r * 1.02;
        Draw::line($im, $x, $y + $r * 0.24, $x + $s * $r * 0.05, $y, $shade, $r * 0.09);
        Draw::ellipse($im, $x + $s * $r * 0.05, $y, $r * 0.10, $r * 0.10, $shade);
    }
}

function giraffeSpots($im, float $cx, float $cy, float $r, string $color): void
{
    $spots = [
        [-0.58, -0.34, 0.17], [0.52, -0.42, 0.15], [-0.20, -0.62, 0.13],
        [0.70, 0.16, 0.14], [-0.72, 0.14, 0.13], [0.16, 0.66, 0.14],
        [-0.36, 0.60, 0.12],
    ];
    foreach ($spots as [$ox, $oy, $sr]) {
        Draw::ellipse($im, $cx + $ox * $r, $cy + $oy * $r, $sr * $r, $sr * $r * 0.9,
            $color, 0.75);
    }
}

function bandana($im, float $cx, float $cy, float $r, string $color): void
{
    // 首もとに巻いた赤いバンダナ
    Draw::arc($im, $cx, $cy, $r * 0.82, $r * 0.78, 58, 122, $color, $r * 0.15);
    Draw::polygon($im, [
        [$cx - $r * 0.16, $cy + $r * 0.72],
        [$cx + $r * 0.16, $cy + $r * 0.72],
        [$cx, $cy + $r * 0.96],
    ], Draw::mix($color, '#000000', 0.12));
}

/* ---------------------------------------------------------------- パンダ */

function pandaEars($im, float $cx, float $cy, float $r, string $black): void
{
    foreach ([-1, 1] as $s) {
        Draw::ellipse($im, $cx + $s * $r * 0.66, $cy - $r * 0.68, $r * 0.30, $r * 0.30,
            $black);
    }
}

function pandaPatches($im, float $cx, float $cy, float $r, string $black): void
{
    foreach ([-1, 1] as $s) {
        Draw::ellipse($im, $cx + $s * $r * 0.36, $cy - $r * 0.06,
            $r * 0.25, $r * 0.30, $black, 1.0, $s * 14.0);
    }
}

function pandaEyes($im, float $cx, float $cy, float $r): void
{
    foreach ([-1, 1] as $s) {
        $x = $cx + $s * $r * 0.36;
        $y = $cy - $r * 0.06;
        Draw::ellipse($im, $x, $y, $r * 0.10, $r * 0.12, '#FFFFFF');
        Draw::ellipse($im, $x, $y, $r * 0.06, $r * 0.07, '#2A2A2A');
    }
}

function overall($im, float $cx, float $cy, float $r, string $color): void
{
    // 体のいちばん下に沿ったオレンジの帯（オーバーオール）
    Draw::arc($im, $cx, $cy, $r * 0.88, $r * 0.84, 38, 142, $color, $r * 0.22);
    Draw::ellipse($im, $cx, $cy + $r * 0.80, $r * 0.055, $r * 0.055,
        Draw::mix($color, '#FFFFFF', 0.55));
}

/* ---------------------------------------------------------------- ビーバー */

function beaverMuzzle($im, float $cx, float $cy, float $r, string $inner,
                      string $shade): void
{
    Draw::ellipse($im, $cx, $cy + $r * 0.34, $r * 0.36, $r * 0.26, $inner, 0.85);
    Draw::ellipse($im, $cx, $cy + $r * 0.20, $r * 0.10, $r * 0.08, '#3B2A21');
    // 大きな前歯
    Draw::rect($im, $cx - $r * 0.13, $cy + $r * 0.34, $r * 0.26, $r * 0.24, '#FFFFFF');
    Draw::rectOutline($im, $cx - $r * 0.13, $cy + $r * 0.34, $r * 0.26, $r * 0.24,
        $shade, $r * 0.035);
    Draw::line($im, $cx, $cy + $r * 0.34, $cx, $cy + $r * 0.58, $shade, $r * 0.03);
}

/* ===================================================================
 *  ボム
 * =================================================================*/

function renderBomb(string $path, bool $isTime): void
{
    $r = SPRITE_R * SS;
    $w = (int)round($r * BOX_W);
    $h = (int)round($r * BOX_H);
    $im = Draw::canvas($w, $h);
    $cx = $w / 2;
    $cy = $h - $r * BOX_BASE;

    $base = $isTime ? '#4FD1C5' : '#4A4A5A';
    Draw::ellipse($im, $cx, $cy + $r * 0.88, $r * 0.70, $r * 0.15, '#000000', 0.14);
    Draw::blob($im, $cx, $cy, $r * 0.96, $base, Draw::mix($base, '#000000', 0.45));

    // 導火線と火花
    Draw::line($im, $cx + $r * 0.22, $cy - $r * 0.86, $cx + $r * 0.52, $cy - $r * 1.24,
        '#8A6A3A', $r * 0.10);
    Draw::ellipse($im, $cx + $r * 0.54, $cy - $r * 1.34, $r * 0.17, $r * 0.17, '#FFD34E');
    Draw::ellipse($im, $cx + $r * 0.54, $cy - $r * 1.34, $r * 0.10, $r * 0.10, '#FF7A2F');

    if ($isTime) {
        Draw::rect($im, $cx - $r * 0.32, $cy - $r * 0.08, $r * 0.64, $r * 0.16, '#FFFFFF');
        Draw::rect($im, $cx - $r * 0.08, $cy - $r * 0.32, $r * 0.16, $r * 0.64, '#FFFFFF');
    }
    Draw::save($im, $path, (int)round($w / SS), (int)round($h / SS));
}

/* ===================================================================
 *  アプリアイコン（ぞうさん）
 * =================================================================*/

function renderIcon(array $char, string $path, int $size): void
{
    $px = $size * SS;
    $im = Draw::canvas($px, $px);

    // 空色の背景（イラストの世界観に合わせる）
    Draw::verticalGradient($im, 0, 0, $px, $px, '#BFE7FA', '#8FD3F4');
    // ふんわりした雲
    Draw::ellipse($im, $px * 0.24, $px * 0.24, $px * 0.16, $px * 0.09, '#FFFFFF', 0.55);
    Draw::ellipse($im, $px * 0.36, $px * 0.22, $px * 0.11, $px * 0.07, '#FFFFFF', 0.55);
    Draw::ellipse($im, $px * 0.80, $px * 0.32, $px * 0.13, $px * 0.08, '#FFFFFF', 0.45);
    // 下は庭の緑
    Draw::arcFilled($im, $px * 0.5, $px * 1.02, $px * 0.95, $px * 0.62, 180, 360, '#A9DE9B');

    $r = $px * 0.29;
    $cx = $px * 0.5;
    $cy = $px * 0.58;
    drawByKind($im, $char, $cx, $cy, $r);

    Draw::save($im, $path, $size, $size);
}
