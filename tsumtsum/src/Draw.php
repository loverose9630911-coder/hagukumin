<?php
/**
 * GD で図形を描くための小さなヘルパー。
 *
 * キャラクターの絵は画像素材を使わず、この道具だけで組み立てる。
 * 角度は「0 度＝右、時計まわり（画面座標なので下が正）」で統一。
 */

declare(strict_types=1);

namespace Zousan;

use GdImage;

final class Draw
{
    /** 透明な描画用キャンバスを作る */
    public static function canvas(int $w, int $h): GdImage
    {
        $im = imagecreatetruecolor($w, $h);
        imagealphablending($im, false);
        imagesavealpha($im, true);
        imagefilledrectangle($im, 0, 0, $w, $h, imagecolorallocatealpha($im, 0, 0, 0, 127));
        imagealphablending($im, true);
        return $im;
    }

    /** 縮小して PNG として保存する（描画時のギザギザを消す） */
    public static function save(GdImage $im, string $path, int $w, int $h): void
    {
        $out = imagecreatetruecolor($w, $h);
        imagealphablending($out, false);
        imagesavealpha($out, true);
        imagefilledrectangle($out, 0, 0, $w, $h, imagecolorallocatealpha($out, 0, 0, 0, 127));
        imagecopyresampled($out, $im, 0, 0, 0, 0, $w, $h, imagesx($im), imagesy($im));
        imagepng($out, $path, 9);
        imagedestroy($out);
        imagedestroy($im);
    }

    /* ------------------------------------------------------------ 色 */

    public static function rgb(string $hex): array
    {
        $hex = ltrim($hex, '#');
        return [
            (int)hexdec(substr($hex, 0, 2)),
            (int)hexdec(substr($hex, 2, 2)),
            (int)hexdec(substr($hex, 4, 2)),
        ];
    }

    public static function hex(array $rgb): string
    {
        return sprintf('#%02X%02X%02X',
            max(0, min(255, (int)round($rgb[0]))),
            max(0, min(255, (int)round($rgb[1]))),
            max(0, min(255, (int)round($rgb[2]))));
    }

    public static function mix(string $a, string $b, float $t): string
    {
        [$ar, $ag, $ab] = self::rgb($a);
        [$br, $bg, $bb] = self::rgb($b);
        return self::hex([
            $ar + ($br - $ar) * $t,
            $ag + ($bg - $ag) * $t,
            $ab + ($bb - $ab) * $t,
        ]);
    }

    public static function lighten(string $hex, float $amount): string
    {
        return self::mix($hex, '#FFFFFF', $amount);
    }

    private static function color(GdImage $im, string $hex, float $alpha = 1.0): int
    {
        [$r, $g, $b] = self::rgb($hex);
        $a = (int)round(127 * (1.0 - max(0.0, min(1.0, $alpha))));
        return imagecolorallocatealpha($im, $r, $g, $b, $a);
    }

    /* ------------------------------------------------------------ 基本図形 */

    /** 回転できる楕円（GD に無いので多角形で近似する） */
    public static function ellipse(GdImage $im, float $cx, float $cy, float $rx,
                                   float $ry, string $hex, float $alpha = 1.0,
                                   float $rotateDeg = 0.0): void
    {
        self::polygon($im, self::ellipsePoints($cx, $cy, $rx, $ry, $rotateDeg), $hex, $alpha);
    }

    public static function ellipsePoints(float $cx, float $cy, float $rx, float $ry,
                                         float $rotateDeg = 0.0, int $steps = 64): array
    {
        $rot = deg2rad($rotateDeg);
        $cos = cos($rot);
        $sin = sin($rot);
        $pts = [];
        for ($i = 0; $i < $steps; $i++) {
            $t = 2 * M_PI * $i / $steps;
            $x = $rx * cos($t);
            $y = $ry * sin($t);
            $pts[] = [$cx + $x * $cos - $y * $sin, $cy + $x * $sin + $y * $cos];
        }
        return $pts;
    }

    public static function polygon(GdImage $im, array $points, string $hex,
                                   float $alpha = 1.0): void
    {
        $flat = [];
        foreach ($points as [$x, $y]) {
            $flat[] = (int)round($x);
            $flat[] = (int)round($y);
        }
        if (count($flat) < 6) {
            return;
        }
        imagefilledpolygon($im, $flat, self::color($im, $hex, $alpha));
    }

    public static function polyline(GdImage $im, array $points, string $hex,
                                    float $width, bool $close = false,
                                    float $alpha = 1.0): void
    {
        $n = count($points);
        for ($i = 0; $i < $n - 1; $i++) {
            self::line($im, $points[$i][0], $points[$i][1],
                $points[$i + 1][0], $points[$i + 1][1], $hex, $width, $alpha);
        }
        if ($close && $n > 2) {
            self::line($im, $points[$n - 1][0], $points[$n - 1][1],
                $points[0][0], $points[0][1], $hex, $width, $alpha);
        }
    }

    /** 端が丸い線 */
    public static function line(GdImage $im, float $x1, float $y1, float $x2,
                                float $y2, string $hex, float $width,
                                float $alpha = 1.0): void
    {
        $dx = $x2 - $x1;
        $dy = $y2 - $y1;
        $len = sqrt($dx * $dx + $dy * $dy);
        $steps = max(2, (int)ceil($len / max(1.0, $width * 0.28)));
        for ($i = 0; $i <= $steps; $i++) {
            $t = $i / $steps;
            self::ellipse($im, $x1 + $dx * $t, $y1 + $dy * $t,
                $width / 2, $width / 2, $hex, $alpha);
        }
    }

    public static function rect(GdImage $im, float $x, float $y, float $w,
                                float $h, string $hex, float $alpha = 1.0): void
    {
        self::polygon($im, [
            [$x, $y], [$x + $w, $y], [$x + $w, $y + $h], [$x, $y + $h],
        ], $hex, $alpha);
    }

    public static function rectOutline(GdImage $im, float $x, float $y, float $w,
                                       float $h, string $hex, float $width): void
    {
        self::polyline($im, [
            [$x, $y], [$x + $w, $y], [$x + $w, $y + $h], [$x, $y + $h],
        ], $hex, $width, true);
    }

    /** 弧を線でなぞる */
    public static function arc(GdImage $im, float $cx, float $cy, float $rx,
                               float $ry, float $from, float $to, string $hex,
                               float $width, float $alpha = 1.0): void
    {
        $pts = self::arcPoints($cx, $cy, $rx, $ry, $from, $to);
        self::polyline($im, $pts, $hex, $width, false, $alpha);
    }

    /** 弧を塗りつぶす（扇形） */
    public static function arcFilled(GdImage $im, float $cx, float $cy, float $rx,
                                     float $ry, float $from, float $to,
                                     string $hex, float $alpha = 1.0): void
    {
        $pts = self::arcPoints($cx, $cy, $rx, $ry, $from, $to);
        $pts[] = [$cx, $cy];
        self::polygon($im, $pts, $hex, $alpha);
    }

    public static function arcPoints(float $cx, float $cy, float $rx, float $ry,
                                     float $from, float $to, int $steps = 48): array
    {
        $pts = [];
        for ($i = 0; $i <= $steps; $i++) {
            $a = deg2rad($from + ($to - $from) * $i / $steps);
            $pts[] = [$cx + $rx * cos($a), $cy + $ry * sin($a)];
        }
        return $pts;
    }

    /* ------------------------------------------------------------ 組み合わせ */

    public static function circleOutlined(GdImage $im, float $cx, float $cy,
                                          float $r, string $fill, string $stroke,
                                          float $width): void
    {
        self::ellipse($im, $cx, $cy, $r + $width / 2, $r + $width / 2, $stroke);
        self::ellipse($im, $cx, $cy, $r - $width / 2, $r - $width / 2, $fill);
    }

    public static function ellipseOutlined(GdImage $im, float $cx, float $cy,
                                           float $rx, float $ry, string $fill,
                                           string $stroke, float $width,
                                           float $rotateDeg = 0.0): void
    {
        self::ellipse($im, $cx, $cy, $rx + $width / 2, $ry + $width / 2, $stroke,
            1.0, $rotateDeg);
        self::ellipse($im, $cx, $cy, $rx - $width / 2, $ry - $width / 2, $fill,
            1.0, $rotateDeg);
    }

    /**
     * ツムの体：ふっくらした丸に、光と輪郭をつける。
     * 同心円を少しずつ色を変えて描くことでグラデーションにしている。
     */
    public static function blob(GdImage $im, float $cx, float $cy, float $r,
                                string $body, string $shade): void
    {
        // 輪郭
        self::ellipse($im, $cx, $cy, $r * 0.98 + $r * 0.038, $r * 0.94 + $r * 0.038, $shade);

        $rings = 34;
        $light = self::lighten($body, 0.34);
        $dark = self::mix($body, $shade, 0.45);
        for ($i = $rings; $i >= 0; $i--) {
            $t = $i / $rings;                       // 1: 外側, 0: 中心
            $color = $t > 0.45
                ? self::mix($body, $dark, ($t - 0.45) / 0.55)
                : self::mix($light, $body, $t / 0.45);
            // 光源が左上にあるので、内側の円をすこし左上へずらす
            $ox = -$r * 0.30 * (1 - $t);
            $oy = -$r * 0.36 * (1 - $t);
            self::ellipse($im, $cx + $ox, $cy + $oy,
                $r * 0.98 * $t + 0.5, $r * 0.94 * $t + 0.5, $color);
        }
        // ハイライト
        self::ellipse($im, $cx - $r * 0.38, $cy - $r * 0.46, $r * 0.22, $r * 0.13,
            '#FFFFFF', 0.45, -28.0);
    }

    /** 太さが変わる帯（ぞうの鼻など） */
    public static function taperedPath(GdImage $im, array $points, float $r0,
                                       float $r1, string $hex, float $extra): void
    {
        $n = count($points);
        for ($i = 0; $i < $n; $i++) {
            $t = $n > 1 ? $i / ($n - 1) : 0.0;
            $r = $r0 + ($r1 - $r0) * $t + $extra;
            self::ellipse($im, $points[$i][0], $points[$i][1], $r, $r, $hex);
        }
    }

    /** 2 次ベジエ曲線を点の並びにする */
    public static function quadPoints(float $x0, float $y0, float $cx, float $cy,
                                      float $x1, float $y1, int $steps = 24): array
    {
        $pts = [];
        for ($i = 0; $i <= $steps; $i++) {
            $t = $i / $steps;
            $u = 1 - $t;
            $pts[] = [
                $u * $u * $x0 + 2 * $u * $t * $cx + $t * $t * $x1,
                $u * $u * $y0 + 2 * $u * $t * $cy + $t * $t * $y1,
            ];
        }
        return $pts;
    }

    public static function verticalGradient(GdImage $im, float $x, float $y,
                                            float $w, float $h, string $top,
                                            string $bottom): void
    {
        $steps = (int)max(2, min(256, $h));
        for ($i = 0; $i < $steps; $i++) {
            $t = $i / max(1, $steps - 1);
            $band = self::mix($top, $bottom, $t);
            self::rect($im, $x, $y + $h * $i / $steps, $w, $h / $steps + 1, $band);
        }
    }
}
