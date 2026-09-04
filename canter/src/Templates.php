<?php
/**
 * サイズのプリセットと、はじめの1枚（テンプレート）。
 *
 * ここが「キャンバっぽさ」の入口。白紙から始めさせないための場所なので、
 * テンプレートは全部このファイルに置いて、画面側とサーバー側で同じものを使う。
 *
 * 図形の書き方（doc の中身）は public/assets/js/editor/scene.js と対になっている。
 * 片方だけ変えると噛み合わなくなるので、直すときは両方を見ること。
 */

declare(strict_types=1);

namespace Canter;

final class Templates
{
    /**
     * 出し先ごとの推奨サイズ。数字は各サービスが案内している推奨値に合わせた初期値で、
     * 画面からいつでも変えられる（マジックリサイズで作り直せる）。
     */
    public const PRESETS = [
        ['id' => 'ig_square',  'group' => 'Instagram', 'label' => 'Instagram 正方形',      'w' => 1080, 'h' => 1080],
        ['id' => 'ig_portrait','group' => 'Instagram', 'label' => 'Instagram 縦',          'w' => 1080, 'h' => 1350],
        ['id' => 'ig_story',   'group' => 'Instagram', 'label' => 'Instagram ストーリー',  'w' => 1080, 'h' => 1920],
        ['id' => 'x_post',     'group' => 'X',         'label' => 'X 投稿画像',            'w' => 1600, 'h' =>  900],
        ['id' => 'x_header',   'group' => 'X',         'label' => 'X ヘッダー',            'w' => 1500, 'h' =>  500],
        ['id' => 'th_post',    'group' => 'Threads',   'label' => 'Threads 投稿',          'w' => 1080, 'h' => 1350],
        ['id' => 'note_head',  'group' => 'note',      'label' => 'note 見出し画像',       'w' => 1280, 'h' =>  670],
        ['id' => 'notion_cov', 'group' => 'Notion',    'label' => 'Notion カバー',         'w' => 1500, 'h' =>  600],
        ['id' => 'slide',      'group' => 'そのほか',  'label' => 'スライド 16:9',         'w' => 1920, 'h' => 1080],
        ['id' => 'a4',         'group' => 'そのほか',  'label' => 'A4 チラシ（300dpi）',   'w' => 2480, 'h' => 3508],
        ['id' => 'logo',       'group' => 'そのほか',  'label' => 'ロゴ・アイコン',        'w' =>  800, 'h' =>  800],
    ];

    /** 文字をワンタッチで整えるための組み合わせ。 */
    public const TEXT_STYLES = [
        ['id' => 'display', 'label' => '特大見出し', 'font' => 'rounded', 'weight' => 800, 'size' => 0.10, 'lineHeight' => 1.15, 'tracking' => -0.01],
        ['id' => 'head',    'label' => '見出し',     'font' => 'rounded', 'weight' => 700, 'size' => 0.068, 'lineHeight' => 1.25, 'tracking' => 0],
        ['id' => 'lead',    'label' => 'リード文',   'font' => 'sans',    'weight' => 500, 'size' => 0.040, 'lineHeight' => 1.6,  'tracking' => 0.01],
        ['id' => 'body',    'label' => '本文',       'font' => 'sans',    'weight' => 400, 'size' => 0.030, 'lineHeight' => 1.75, 'tracking' => 0.01],
        ['id' => 'caption', 'label' => '注釈',       'font' => 'sans',    'weight' => 400, 'size' => 0.022, 'lineHeight' => 1.6,  'tracking' => 0.02],
        ['id' => 'serif',   'label' => '明朝の引用', 'font' => 'serif',   'weight' => 500, 'size' => 0.052, 'lineHeight' => 1.7,  'tracking' => 0.02],
    ];

    /** 配色の見本。押すと画面の色をまとめて置きかえる。 */
    public const PALETTES = [
        ['id' => 'canter', 'label' => 'canter',   'colors' => ['#1f2430', '#f0508c', '#7c5cff', '#00b8a9', '#ffffff']],
        ['id' => 'warm',   'label' => 'あたたかい', 'colors' => ['#3b2314', '#e8622c', '#f2b705', '#f6ede3', '#ffffff']],
        ['id' => 'cool',   'label' => 'すずしい',   'colors' => ['#0e2a47', '#2f80ed', '#56ccf2', '#eaf3fb', '#ffffff']],
        ['id' => 'mono',   'label' => 'モノトーン', 'colors' => ['#111111', '#555555', '#999999', '#e5e5e5', '#ffffff']],
        ['id' => 'fresh',  'label' => 'みずみずしい', 'colors' => ['#14352c', '#12b886', '#8ce99a', '#f3fbf6', '#ffffff']],
        ['id' => 'night',  'label' => 'よる',       'colors' => ['#05060a', '#1b1f2e', '#7c5cff', '#e0348b', '#f5f6fa']],
    ];

    public static function preset(string $id): ?array
    {
        foreach (self::PRESETS as $p) {
            if ($p['id'] === $id) {
                return $p;
            }
        }
        return null;
    }

    /** 画面が最初に読む一式。 */
    public static function all(): array
    {
        return [
            'presets'  => self::PRESETS,
            'styles'   => self::TEXT_STYLES,
            'palettes' => self::PALETTES,
            'designs'  => self::designs(),
        ];
    }

    /** はじめの1枚。preset の大きさに合わせて作る。 */
    public static function designs(): array
    {
        $out = [];
        foreach (self::PRESETS as $p) {
            $out[] = [
                'id'     => 'blank_' . $p['id'],
                'preset' => $p['id'],
                'label'  => $p['label'] . '（白紙）',
                'tag'    => '白紙',
                'doc'    => self::blank($p['w'], $p['h']),
            ];
        }

        foreach (self::recipes() as $r) {
            $preset = self::preset($r['preset']);
            if ($preset === null) {
                continue;
            }
            $out[] = [
                'id'     => $r['id'],
                'preset' => $r['preset'],
                'label'  => $r['label'],
                'tag'    => $r['tag'],
                'doc'    => ($r['build'])($preset['w'], $preset['h']),
            ];
        }

        return $out;
    }

    public static function blank(int $w, int $h): array
    {
        return ['v' => 1, 'w' => $w, 'h' => $h, 'bg' => '#ffffff', 'nodes' => []];
    }

    /** id からテンプレートの中身を取り出す。無ければ null。 */
    public static function doc(string $id): ?array
    {
        foreach (self::designs() as $d) {
            if ($d['id'] === $id) {
                return $d['doc'];
            }
        }
        return null;
    }

    // ---- テンプレートの中身 -------------------------------------------------

    private static function recipes(): array
    {
        return [
            [
                'id' => 'ig_notice', 'preset' => 'ig_square', 'label' => 'お知らせ（帯つき）', 'tag' => 'お知らせ',
                'build' => static function (int $w, int $h): array {
                    return [
                        'v' => 1, 'w' => $w, 'h' => $h, 'bg' => '#1f2430',
                        'nodes' => [
                            self::rect('背景の帯', $w * 0.08, $h * 0.30, $w * 0.84, $h * 0.40, '#f0508c', ['radius' => $w * 0.035]),
                            // 角丸の帯からはみ出さないよう、上下を少し内側に入れる
                            self::rect('アクセント', $w * 0.08, $h * 0.33, $w * 0.02, $h * 0.34, '#ffd166'),
                            self::text('小見出し', $w * 0.13, $h * 0.345, $w * 0.74, 'お知らせ', [
                                'fontSize' => $w * 0.030, 'weight' => 600, 'color' => '#ffe3ef', 'tracking' => 0.18,
                            ]),
                            self::text('見出し', $w * 0.13, $h * 0.40, $w * 0.74, "9月の営業時間を\n変更します", [
                                'fontSize' => $w * 0.085, 'weight' => 800, 'font' => 'rounded', 'color' => '#ffffff', 'lineHeight' => 1.2,
                            ]),
                            self::text('日付', $w * 0.08, $h * 0.77, $w * 0.84, '2026.09.10 → 09.30', [
                                'fontSize' => $w * 0.034, 'weight' => 500, 'color' => '#9aa3b5', 'align' => 'center',
                            ]),
                        ],
                    ];
                },
            ],
            [
                'id' => 'ig_quote', 'preset' => 'ig_square', 'label' => '引用カード', 'tag' => '引用',
                'build' => static function (int $w, int $h): array {
                    return [
                        'v' => 1, 'w' => $w, 'h' => $h, 'bg' => '#f6ede3',
                        'nodes' => [
                            self::ellipse('まる', -$w * 0.18, -$h * 0.18, $w * 0.70, $h * 0.70, '#e8622c', ['opacity' => 0.12]),
                            self::ellipse('まる2', $w * 0.62, $h * 0.66, $w * 0.55, $h * 0.55, '#f2b705', ['opacity' => 0.16]),
                            self::text('引用符', $w * 0.10, $h * 0.16, $w * 0.3, '“', [
                                'fontSize' => $w * 0.22, 'weight' => 700, 'font' => 'serif', 'color' => '#e8622c', 'lineHeight' => 1,
                            ]),
                            self::text('本文', $w * 0.12, $h * 0.33, $w * 0.76, "急がなくていい。\nやめないことのほうが、\nずっと効く。", [
                                'fontSize' => $w * 0.058, 'weight' => 500, 'font' => 'serif', 'color' => '#3b2314', 'lineHeight' => 1.7,
                            ]),
                            self::rect('線', $w * 0.12, $h * 0.74, $w * 0.10, 3, '#e8622c'),
                            self::text('署名', $w * 0.12, $h * 0.77, $w * 0.76, 'canter', [
                                'fontSize' => $w * 0.028, 'weight' => 600, 'color' => '#8a6a52', 'tracking' => 0.12,
                            ]),
                        ],
                    ];
                },
            ],
            [
                'id' => 'ig_story_announce', 'preset' => 'ig_story', 'label' => 'ストーリー告知', 'tag' => '告知',
                'build' => static function (int $w, int $h): array {
                    return [
                        'v' => 1, 'w' => $w, 'h' => $h, 'bg' => '#05060a',
                        'nodes' => [
                            self::rect('グラデ', 0, 0, $w, $h, [
                                'type' => 'linear', 'angle' => 150, 'a' => '#7c5cff', 'b' => '#e0348b',
                            ], ['opacity' => 0.9]),
                            self::rect('カード', $w * 0.09, $h * 0.28, $w * 0.82, $h * 0.44, '#ffffff', ['radius' => $w * 0.06, 'opacity' => 0.96]),
                            self::text('ラベル', $w * 0.15, $h * 0.33, $w * 0.70, 'NEW', [
                                'fontSize' => $w * 0.035, 'weight' => 800, 'color' => '#e0348b', 'tracking' => 0.3, 'align' => 'center',
                            ]),
                            self::text('見出し', $w * 0.15, $h * 0.385, $w * 0.70, "新しい記事を\n公開しました", [
                                'fontSize' => $w * 0.075, 'weight' => 800, 'font' => 'rounded', 'color' => '#1f2430',
                                'align' => 'center', 'lineHeight' => 1.3,
                            ]),
                            self::rect('ボタン', $w * 0.28, $h * 0.60, $w * 0.44, $h * 0.055, '#1f2430', ['radius' => $h * 0.028]),
                            self::text('ボタン文字', $w * 0.28, $h * 0.6125, $w * 0.44, '読んでみる', [
                                'fontSize' => $w * 0.032, 'weight' => 700, 'color' => '#ffffff', 'align' => 'center',
                            ]),
                        ],
                    ];
                },
            ],
            [
                'id' => 'x_summary', 'preset' => 'x_post', 'label' => 'まとめ画像（3点）', 'tag' => 'まとめ',
                'build' => static function (int $w, int $h): array {
                    $nodes = [
                        self::rect('地', 0, 0, $w, $h, '#0e2a47'),
                        self::rect('帯', 0, 0, $w, $h * 0.02, '#56ccf2'),
                        self::text('見出し', $w * 0.06, $h * 0.10, $w * 0.88, '知っておくと早い3つのこと', [
                            'fontSize' => $w * 0.048, 'weight' => 800, 'font' => 'rounded', 'color' => '#ffffff',
                        ]),
                    ];
                    $items = ['まず形にする', '毎日ちょっとだけ', '人に見せて直す'];
                    foreach ($items as $i => $label) {
                        $y = $h * (0.34 + $i * 0.17);
                        $nodes[] = self::ellipse('番号' . ($i + 1), $w * 0.06, $y, $h * 0.11, $h * 0.11, '#2f80ed');
                        $nodes[] = self::text('数字' . ($i + 1), $w * 0.06, $y + $h * 0.027, $h * 0.11, (string) ($i + 1), [
                            'fontSize' => $h * 0.055, 'weight' => 800, 'color' => '#ffffff', 'align' => 'center', 'lineHeight' => 1,
                        ]);
                        $nodes[] = self::text('項目' . ($i + 1), $w * 0.06 + $h * 0.15, $y + $h * 0.022, $w * 0.70, $label, [
                            'fontSize' => $w * 0.032, 'weight' => 600, 'color' => '#eaf3fb',
                        ]);
                    }
                    return ['v' => 1, 'w' => $w, 'h' => $h, 'bg' => '#0e2a47', 'nodes' => $nodes];
                },
            ],
            [
                'id' => 'note_head_simple', 'preset' => 'note_head', 'label' => 'note の見出し', 'tag' => '見出し',
                'build' => static function (int $w, int $h): array {
                    return [
                        'v' => 1, 'w' => $w, 'h' => $h, 'bg' => '#ffffff',
                        'nodes' => [
                            self::rect('左の色面', 0, 0, $w * 0.34, $h, [
                                'type' => 'linear', 'angle' => 160, 'a' => '#12b886', 'b' => '#8ce99a',
                            ]),
                            self::text('カテゴリ', $w * 0.40, $h * 0.22, $w * 0.54, 'つくりかた', [
                                'fontSize' => $w * 0.022, 'weight' => 700, 'color' => '#12b886', 'tracking' => 0.2,
                            ]),
                            self::text('タイトル', $w * 0.40, $h * 0.31, $w * 0.54, "はじめての\nデザイン道具", [
                                'fontSize' => $w * 0.058, 'weight' => 800, 'font' => 'rounded', 'color' => '#14352c', 'lineHeight' => 1.3,
                            ]),
                            self::text('筆者', $w * 0.40, $h * 0.74, $w * 0.54, 'canter編集部', [
                                'fontSize' => $w * 0.020, 'weight' => 500, 'color' => '#7a8a84',
                            ]),
                        ],
                    ];
                },
            ],
            [
                'id' => 'th_before_after', 'preset' => 'th_post', 'label' => 'ビフォーアフター', 'tag' => '比較',
                'build' => static function (int $w, int $h): array {
                    return [
                        'v' => 1, 'w' => $w, 'h' => $h, 'bg' => '#f5f6fa',
                        'nodes' => [
                            self::rect('上', $w * 0.07, $h * 0.10, $w * 0.86, $h * 0.36, '#e5e7ef', ['radius' => $w * 0.03]),
                            self::text('上ラベル', $w * 0.11, $h * 0.135, $w * 0.5, 'BEFORE', [
                                'fontSize' => $w * 0.030, 'weight' => 800, 'color' => '#8b91a5', 'tracking' => 0.2,
                            ]),
                            self::rect('下', $w * 0.07, $h * 0.52, $w * 0.86, $h * 0.36, '#7c5cff', ['radius' => $w * 0.03]),
                            self::text('下ラベル', $w * 0.11, $h * 0.555, $w * 0.5, 'AFTER', [
                                'fontSize' => $w * 0.030, 'weight' => 800, 'color' => '#e4dcff', 'tracking' => 0.2,
                            ]),
                            self::ellipse('矢印の地', $w * 0.44, $h * 0.455, $w * 0.12, $w * 0.12, '#1f2430'),
                            self::text('矢印', $w * 0.44, $h * 0.472, $w * 0.12, '↓', [
                                'fontSize' => $w * 0.06, 'weight' => 700, 'color' => '#ffffff', 'align' => 'center', 'lineHeight' => 1,
                            ]),
                        ],
                    ];
                },
            ],
        ];
    }

    // ---- 図形をつくる小道具 -------------------------------------------------

    private static function base(string $type, string $name, float $x, float $y, float $w, float $h, array $extra): array
    {
        return array_merge([
            'id'      => 't' . substr(bin2hex(random_bytes(4)), 0, 8),
            'type'    => $type,
            'name'    => $name,
            'x'       => round($x, 2),
            'y'       => round($y, 2),
            'w'       => round($w, 2),
            'h'       => round($h, 2),
            'rot'     => 0,
            'opacity' => 1,
            'hidden'  => false,
            'locked'  => false,
        ], $extra);
    }

    private static function rect(string $name, float $x, float $y, float $w, float $h, mixed $fill, array $extra = []): array
    {
        return self::base('rect', $name, $x, $y, $w, $h, array_merge([
            'fill'        => $fill,
            'stroke'      => null,
            'strokeWidth' => 0,
            'radius'      => 0,
        ], $extra));
    }

    private static function ellipse(string $name, float $x, float $y, float $w, float $h, mixed $fill, array $extra = []): array
    {
        return self::base('ellipse', $name, $x, $y, $w, $h, array_merge([
            'fill'        => $fill,
            'stroke'      => null,
            'strokeWidth' => 0,
        ], $extra));
    }

    private static function text(string $name, float $x, float $y, float $w, string $text, array $extra = []): array
    {
        $size = (float) ($extra['fontSize'] ?? 40);
        $lh   = (float) ($extra['lineHeight'] ?? 1.4);
        $lines = max(1, substr_count($text, "\n") + 1);

        return self::base('text', $name, $x, $y, $w, $size * $lh * $lines, array_merge([
            'text'       => $text,
            'fontSize'   => round($size, 2),
            'font'       => 'sans',
            'weight'     => 500,
            'color'      => '#111111',
            'align'      => 'left',
            'lineHeight' => $lh,
            'tracking'   => 0,
        ], $extra));
    }
}
