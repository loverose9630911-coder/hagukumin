<?php
/**
 * デザインの中身（doc）を検査して、決まった形だけを通す。
 *
 * なぜサーバー側でも見るのか:
 *   ・画面の不具合や古い版が壊れた形を送ってきても、保存の時点で止められる
 *   ・知らない項目を落とすので、DB に変なものが溜まらない
 *   ・大きさに上限をつけて、1枚が際限なく重くなるのを防ぐ
 *
 * 図形の意味は public/assets/js/editor/scene.js と対になっている。
 */

declare(strict_types=1);

namespace Canter;

final class Doc
{
    public const MAX_NODES = 400;    // 1枚に置ける図形の数
    public const MAX_DEPTH = 6;      // グループの入れ子の深さ
    public const MAX_BYTES = 2_000_000;  // JSON にしたときの大きさ

    private const TYPES  = ['rect', 'ellipse', 'text', 'path', 'image', 'group'];
    private const FONTS  = ['sans', 'serif', 'rounded', 'mono'];
    private const ALIGNS = ['left', 'center', 'right'];
    private const FITS   = ['cover', 'contain', 'fill'];
    private const RULES  = ['nonzero', 'evenodd'];

    /** 通れば整えた doc、通らなければ ApiError。 */
    public static function sanitize(mixed $doc): array
    {
        if (!is_array($doc)) {
            throw new ApiError('デザインの中身が読めませんでした', 422);
        }

        $w = self::int($doc['w'] ?? 0);
        $h = self::int($doc['h'] ?? 0);
        if ($w < 16 || $h < 16 || $w > 8000 || $h > 8000) {
            throw new ApiError('キャンバスの大きさは16〜8000ピクセルにしてください', 422);
        }

        $count = 0;
        $nodes = self::nodes($doc['nodes'] ?? [], 0, $count);

        $out = [
            'v'     => 1,
            'w'     => $w,
            'h'     => $h,
            'bg'    => self::paint($doc['bg'] ?? '#ffffff') ?? '#ffffff',
            'nodes' => $nodes,
        ];

        $json = json_encode($out, JSON_UNESCAPED_UNICODE);
        if ($json === false || strlen($json) > self::MAX_BYTES) {
            throw new ApiError('デザインが大きすぎます。図形を減らすか、画像を素材として取りこんでください', 413);
        }

        return $out;
    }

    /** doc の中で使われている画像の id を集める（消してよい素材を見分けるため）。 */
    public static function usedAssets(array $doc): array
    {
        $ids = [];
        $walk = static function (array $nodes) use (&$walk, &$ids): void {
            foreach ($nodes as $n) {
                if (($n['type'] ?? '') === 'image' && !empty($n['asset'])) {
                    $ids[(int) $n['asset']] = true;
                }
                if (($n['type'] ?? '') === 'group' && is_array($n['kids'] ?? null)) {
                    $walk($n['kids']);
                }
            }
        };
        $walk($doc['nodes'] ?? []);

        return array_keys($ids);
    }

    // ---- ここから中身の検査 -------------------------------------------------

    private static function nodes(mixed $list, int $depth, int &$count): array
    {
        if (!is_array($list)) {
            return [];
        }
        if ($depth > self::MAX_DEPTH) {
            throw new ApiError('グループの入れ子が深すぎます', 422);
        }

        $out = [];
        foreach ($list as $raw) {
            if (!is_array($raw)) {
                continue;
            }
            if (++$count > self::MAX_NODES) {
                throw new ApiError('1枚に置ける図形は' . self::MAX_NODES . '個までです', 422);
            }
            $node = self::node($raw, $depth, $count);
            if ($node !== null) {
                $out[] = $node;
            }
        }
        return $out;
    }

    private static function node(array $n, int $depth, int &$count): ?array
    {
        $type = (string) ($n['type'] ?? '');
        if (!in_array($type, self::TYPES, true)) {
            return null;
        }

        $out = [
            'id'      => self::id($n['id'] ?? ''),
            'type'    => $type,
            'name'    => mb_substr(trim((string) ($n['name'] ?? '')), 0, 40),
            'x'       => self::num($n['x'] ?? 0),
            'y'       => self::num($n['y'] ?? 0),
            'w'       => max(0.0, self::num($n['w'] ?? 0)),
            'h'       => max(0.0, self::num($n['h'] ?? 0)),
            'rot'     => fmod(self::num($n['rot'] ?? 0), 360),
            'opacity' => min(1.0, max(0.0, self::num($n['opacity'] ?? 1, 1))),
            'hidden'  => !empty($n['hidden']),
            'locked'  => !empty($n['locked']),
        ];

        switch ($type) {
            case 'rect':
                $out += self::shape($n);
                $out['radius'] = max(0.0, self::num($n['radius'] ?? 0));
                break;

            case 'ellipse':
                $out += self::shape($n);
                break;

            case 'path':
                $out += self::shape($n);
                $out['d']    = self::subpaths($n['d'] ?? []);
                $out['rule'] = in_array($n['rule'] ?? '', self::RULES, true) ? $n['rule'] : 'nonzero';
                $out['cap']  = in_array($n['cap'] ?? '', ['butt', 'round', 'square'], true) ? $n['cap'] : 'round';
                break;

            case 'text':
                $out['text']       = mb_substr((string) ($n['text'] ?? ''), 0, 4000);
                $out['fontSize']   = min(2000.0, max(1.0, self::num($n['fontSize'] ?? 40, 40)));
                $out['font']       = in_array($n['font'] ?? '', self::FONTS, true) ? $n['font'] : 'sans';
                $out['weight']     = self::weight($n['weight'] ?? 500);
                $out['color']      = self::color($n['color'] ?? '#111111') ?? '#111111';
                $out['align']      = in_array($n['align'] ?? '', self::ALIGNS, true) ? $n['align'] : 'left';
                $out['lineHeight'] = min(4.0, max(0.6, self::num($n['lineHeight'] ?? 1.4, 1.4)));
                $out['tracking']   = min(1.0, max(-0.3, self::num($n['tracking'] ?? 0)));
                $out['italic']     = !empty($n['italic']);
                break;

            case 'image':
                $asset = self::int($n['asset'] ?? 0);
                if ($asset <= 0) {
                    return null;   // 元の画像が分からないものは置いておけない
                }
                $out['asset']  = $asset;
                $out['fit']    = in_array($n['fit'] ?? '', self::FITS, true) ? $n['fit'] : 'cover';
                $out['radius'] = max(0.0, self::num($n['radius'] ?? 0));
                break;

            case 'group':
                $out['bw']   = max(1.0, self::num($n['bw'] ?? ($out['w'] ?: 1), 1));
                $out['bh']   = max(1.0, self::num($n['bh'] ?? ($out['h'] ?: 1), 1));
                $out['kids'] = self::nodes($n['kids'] ?? [], $depth + 1, $count);
                break;
        }

        return $out;
    }

    private static function shape(array $n): array
    {
        return [
            'fill'        => self::paint($n['fill'] ?? null),
            'stroke'      => self::color($n['stroke'] ?? null),
            'strokeWidth' => min(400.0, max(0.0, self::num($n['strokeWidth'] ?? 0))),
            'dash'        => min(200.0, max(0.0, self::num($n['dash'] ?? 0))),
        ];
    }

    /** パスは「0〜1に正規化した座標」で持つ。大きさを変えても形が保たれるようにするため。 */
    private static function subpaths(mixed $list): array
    {
        if (!is_array($list)) {
            return [];
        }
        $out    = [];
        $points = 0;
        foreach ($list as $sub) {
            if (!is_array($sub)) {
                continue;
            }
            $pts = [];
            foreach ((array) ($sub['pts'] ?? []) as $p) {
                if (!is_array($p)) {
                    continue;
                }
                if (++$points > 3000) {
                    throw new ApiError('パスの点が多すぎます', 422);
                }
                $pt = ['x' => self::num($p['x'] ?? 0), 'y' => self::num($p['y'] ?? 0)];
                // 手（ハンドル）は、あるときだけ持つ。まっすぐな線では持たない。
                foreach (['h1x', 'h1y', 'h2x', 'h2y'] as $k) {
                    if (isset($p[$k]) && is_numeric($p[$k])) {
                        $pt[$k] = self::num($p[$k]);
                    }
                }
                $pts[] = $pt;
            }
            if ($pts !== []) {
                $out[] = ['closed' => !empty($sub['closed']), 'pts' => $pts];
            }
        }
        return $out;
    }

    private static function paint(mixed $v): string|array|null
    {
        if (is_array($v) && ($v['type'] ?? '') === 'linear') {
            $a = self::color($v['a'] ?? null);
            $b = self::color($v['b'] ?? null);
            if ($a === null || $b === null) {
                return null;
            }
            return [
                'type'  => 'linear',
                'angle' => fmod(self::num($v['angle'] ?? 90), 360),
                'a'     => $a,
                'b'     => $b,
            ];
        }
        return self::color($v);
    }

    private static function color(mixed $v): ?string
    {
        if (!is_string($v)) {
            return null;
        }
        $v = trim($v);
        if ($v === '' || strtolower($v) === 'none') {
            return null;
        }
        if (preg_match('/\A#[0-9a-fA-F]{6}\z/', $v) === 1) {
            return strtolower($v);
        }
        if (preg_match('/\A#[0-9a-fA-F]{3}\z/', $v) === 1) {
            return strtolower('#' . $v[1] . $v[1] . $v[2] . $v[2] . $v[3] . $v[3]);
        }
        // rgba(…) は透明度つきの色として通す。それ以外の書き方は受け付けない。
        if (preg_match('/\Argba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)\z/', $v) === 1) {
            return $v;
        }
        return null;
    }

    private static function id(mixed $v): string
    {
        $v = is_string($v) ? preg_replace('/[^A-Za-z0-9_-]/', '', $v) : '';
        $v = (string) $v;
        return $v !== '' ? substr($v, 0, 24) : 'n' . bin2hex(random_bytes(5));
    }

    private static function weight(mixed $v): int
    {
        $w = self::int($v);
        foreach ([100, 200, 300, 400, 500, 600, 700, 800, 900] as $ok) {
            if ($w === $ok) {
                return $w;
            }
        }
        return 500;
    }

    private static function num(mixed $v, float $fallback = 0.0): float
    {
        if (!is_numeric($v)) {
            return $fallback;
        }
        $f = (float) $v;
        if (is_nan($f) || is_infinite($f)) {
            return $fallback;
        }
        return round(min(100000.0, max(-100000.0, $f)), 3);
    }

    private static function int(mixed $v): int
    {
        return is_numeric($v) ? (int) round((float) $v) : 0;
    }
}
