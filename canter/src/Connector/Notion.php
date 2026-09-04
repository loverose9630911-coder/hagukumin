<?php
/**
 * Notion。
 *
 * 「デザインを1枚、記事やデータベースの1行として置く」ための出し先。
 *   POST https://api.notion.com/v1/pages
 *
 * ・カバー画像と、本文の先頭に置く画像は、どちらも **外部の URL** として渡す。
 *   Notion 側がその URL を取りに来るので、Instagram と同じく
 *   canter が外から見える場所にある必要がある。
 * ・Notion-Version は必ず送る決まりになっている。ここは入力できるようにしてあり、
 *   既定は長く安定している 2022-06-28 にしてある。
 *   新しい版では「データベースの下」が data_source_id に変わっているので、
 *   新しい版を使うときは 置き場所の種類 で「データソース」を選ぶこと。
 */

declare(strict_types=1);

namespace Canter\Connector;

use Canter\ApiError;
use Canter\Assets;
use Canter\Http;

final class Notion extends Connector
{
    private const BASE            = 'https://api.notion.com/v1';
    private const DEFAULT_VERSION = '2022-06-28';

    public static function service(): string
    {
        return 'notion';
    }

    public static function label(): string
    {
        return 'Notion';
    }

    public static function capabilities(): array
    {
        return ['image' => true, 'text' => true, 'schedule' => true];
    }

    public static function needsPublicImage(): bool
    {
        return true;
    }

    public static function requiresImage(): bool
    {
        return false;
    }

    public static function fields(): array
    {
        return [
            [
                'key' => 'token', 'label' => 'インテグレーションのシークレット', 'type' => 'password', 'required' => true,
                'help' => 'ntn_ または secret_ で始まる文字列。作ったインテグレーションを、置き場所のページに「接続」しておいてください。',
            ],
            [
                'key' => 'parent_type', 'label' => '置き場所の種類', 'type' => 'select', 'required' => true,
                'default' => 'page',
                'options' => [
                    ['value' => 'page',        'label' => 'ページの下に作る'],
                    ['value' => 'database',    'label' => 'データベースの行にする'],
                    ['value' => 'data_source', 'label' => 'データソースの行にする（新しい版）'],
                ],
            ],
            [
                'key' => 'parent_id', 'label' => '置き場所のID', 'type' => 'text', 'required' => true,
                'help' => 'ページやデータベースの URL の末尾にある32桁の文字列。',
            ],
            [
                'key' => 'title_property', 'label' => 'タイトルの列名', 'type' => 'text', 'required' => false,
                'help' => 'データベースに入れるときだけ。空にしておくと canter が調べて合わせます。',
            ],
            [
                'key' => 'version', 'label' => 'Notion-Version', 'type' => 'text', 'required' => false,
                'default' => self::DEFAULT_VERSION,
                'help' => '送らないと Notion が受け付けません。使っているインテグレーションに合わせてください。',
            ],
        ];
    }

    public function verify(array $config): array
    {
        $res = $this->call($config, 'GET', '/users/me');
        if ($res['status'] !== 200) {
            return self::ng('Notion に断られました：' . Http::errorMessage($res));
        }

        $name = $res['json']['name'] ?? ($res['json']['bot']['owner']['type'] ?? 'インテグレーション');

        // 置き場所にも手が届くか確かめる。ここでつまずく人がいちばん多い
        //（インテグレーションをページに「接続」し忘れている）。
        $type = (string) ($config['parent_type'] ?? 'page');
        $id   = self::need($config, 'parent_id', '置き場所のID');
        $path = match ($type) {
            'database'    => '/databases/' . rawurlencode($id),
            'data_source' => '/data_sources/' . rawurlencode($id),
            default       => '/pages/' . rawurlencode($id),
        };

        $parent = $this->call($config, 'GET', $path);
        if ($parent['status'] !== 200) {
            return self::ng(
                '置き場所を開けませんでした：' . Http::errorMessage($parent)
                . '（Notion で対象のページを開き、右上のメニューから「接続」にこのインテグレーションを追加してください）'
            );
        }

        $reach = Assets::reachability();
        if (!$reach['public']) {
            return self::ok(['name' => $name], '置き場所まで確認できました。ただし画像を載せるには ' . $reach['reason']);
        }

        return self::ok(['name' => $name], 'つながりました（' . $name . '）');
    }

    public function publish(array $config, array $post, ?array $image): array
    {
        $type    = (string) ($config['parent_type'] ?? 'page');
        $id      = self::need($config, 'parent_id', '置き場所のID');
        $caption = (string) ($post['caption'] ?? '');
        $title   = trim((string) ($post['options']['title'] ?? '')) ?: (self::firstLine($caption) ?: 'canter のデザイン');
        $logs    = [];

        $parent = match ($type) {
            'database'    => ['database_id' => $id],
            'data_source' => ['data_source_id' => $id],
            default       => ['page_id' => $id],
        };

        $titleProp = $type === 'page' ? 'title' : $this->titleProperty($config, $type, $id, $logs);

        $body = [
            'parent'     => $parent,
            'properties' => [
                $titleProp => ['title' => [['text' => ['content' => mb_substr($title, 0, 200)]]]],
            ],
            'children'   => [],
        ];

        if ($image !== null) {
            $reach = Assets::reachability();
            if (!$reach['public']) {
                throw new ApiError($reach['reason'], 400);
            }
            $url = Assets::publicUrl($image);
            $logs[] = '画像の URL: ' . $url;

            $body['cover'] = ['type' => 'external', 'external' => ['url' => $url]];
            $body['children'][] = [
                'object' => 'block', 'type' => 'image',
                'image'  => ['type' => 'external', 'external' => ['url' => $url]],
            ];
        }

        foreach (self::paragraphs($caption) as $para) {
            $body['children'][] = [
                'object'    => 'block',
                'type'      => 'paragraph',
                'paragraph' => ['rich_text' => [['type' => 'text', 'text' => ['content' => $para]]]],
            ];
        }

        $res = $this->call($config, 'POST', '/pages', ['json' => $body]);
        if ($res['status'] !== 200 || !isset($res['json']['id'])) {
            throw new ApiError('Notion にページを作れませんでした：' . Http::errorMessage($res), 502);
        }

        $pageId = (string) $res['json']['id'];
        $logs[] = 'ページを作りました（' . $pageId . '）';

        return [
            'external_id'  => $pageId,
            'external_url' => (string) ($res['json']['url'] ?? ''),
            'message'      => 'Notion にページを作りました',
            'logs'         => $logs,
        ];
    }

    /** データベースのタイトル列の名前を調べる（指定があればそれを使う）。 */
    private function titleProperty(array $config, string $type, string $id, array &$logs): string
    {
        $given = trim((string) ($config['title_property'] ?? ''));
        if ($given !== '') {
            return $given;
        }

        $path = $type === 'data_source' ? '/data_sources/' : '/databases/';
        $res  = $this->call($config, 'GET', $path . rawurlencode($id));

        foreach ((array) ($res['json']['properties'] ?? []) as $name => $prop) {
            if (($prop['type'] ?? '') === 'title') {
                $logs[] = 'タイトルの列は「' . $name . '」でした';
                return (string) $name;
            }
        }

        $logs[] = 'タイトルの列が分からなかったので「名前」を使います';
        return '名前';
    }

    private function call(array $config, string $method, string $path, array $opt = []): array
    {
        $token   = self::need($config, 'token', 'インテグレーションのシークレット');
        $version = trim((string) ($config['version'] ?? '')) ?: self::DEFAULT_VERSION;

        $opt['headers'] = array_merge($opt['headers'] ?? [], [
            'Authorization: Bearer ' . $token,
            'Notion-Version: ' . $version,
        ]);

        return Http::request($method, self::BASE . $path, $opt);
    }

    private static function firstLine(string $text): string
    {
        $line = strtok(trim($text), "\n");
        return $line === false ? '' : mb_substr($line, 0, 120);
    }

    /** 空行で切って段落にする。1つの段落は2000文字までという決まりがあるので、そこでも切る。 */
    private static function paragraphs(string $text): array
    {
        $text = trim($text);
        if ($text === '') {
            return [];
        }

        $out = [];
        foreach (preg_split("/\n{2,}/", $text) ?: [] as $block) {
            $block = trim($block);
            if ($block === '') {
                continue;
            }
            foreach (mb_str_split($block, 1800) as $chunk) {
                $out[] = $chunk;
            }
        }

        return array_slice($out, 0, 90);   // 一度に付けられるブロックの数に余裕を持たせる
    }
}
