<?php
/**
 * デモデータ。
 *
 * 開いてすぐ触れる状態にするためのもの。
 * すでに誰か登録していれば何もしない（本番のデータを上書きしないため）。
 */

declare(strict_types=1);

namespace Canter;

final class Seed
{
    public const LOGIN    = 'demo';
    public const PASSWORD = 'demo1234';

    public static function run(bool $force = false): array
    {
        $db    = Db::conn();
        $count = (int) $db->query('SELECT COUNT(*) FROM users')->fetchColumn();

        if ($count > 0 && !$force) {
            throw new ApiError('すでに利用者がいるので、デモデータは入れませんでした', 409);
        }

        $demo = Auth::register(self::LOGIN, 'デモ ユーザー', self::PASSWORD);
        $ws   = Workspaces::create($demo['id'], 'デモのワークスペース');

        Workspaces::updateBrand($ws['id'], [
            'name'      => 'canter デモ',
            'colors'    => ['#1f2430', '#f0508c', '#7c5cff', '#00b8a9', '#ffd166', '#ffffff'],
            'font_head' => 'rounded',
            'font_body' => 'sans',
        ]);

        // テンプレートから何枚か作っておく。開いた瞬間に「触れるもの」があるように。
        $made = [];
        foreach ([
            ['ig_notice',          '9月のお知らせ'],
            ['ig_quote',           '今週のことば'],
            ['x_summary',          'X 用のまとめ画像'],
            ['note_head_simple',   'note の見出し'],
            ['ig_story_announce',  'ストーリーの告知'],
        ] as [$template, $title]) {
            $made[] = Designs::create($ws['id'], $demo['id'], [
                'template' => $template,
                'title'    => $title,
            ]);
        }

        // note は合言葉が要らない（書き出しだけ）ので、最初から用意しておける。
        Connections::create($ws['id'], [
            'service' => 'note',
            'label'   => '書き出し',
            'config'  => ['author' => 'canter デモ'],
        ]);

        return [
            'login'     => self::LOGIN,
            'password'  => self::PASSWORD,
            'workspace' => $ws['name'],
            'designs'   => count($made),
        ];
    }
}
