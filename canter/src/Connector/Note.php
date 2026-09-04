<?php
/**
 * note。
 *
 * 【はじめに、正直なところ】
 * note には、外部のプログラムから記事を投稿するための **公式な API が公開されていない**。
 * ブラウザの中で動いている内部の通信（いわゆる非公式 API）を真似する方法は世の中にあるが、
 *   ・note 側の都合でいつ変わってもおかしくない（実際たびたび変わっている）
 *   ・利用規約の面でも安心して勧められない
 * ので、canter では**やらない**。
 *
 * そのかわり、note の編集画面に貼るだけの形にして渡す。
 *   ・見出し画像は書き出した PNG をダウンロード
 *   ・本文は Markdown を1回のコピーで持っていける
 *
 * 「自動で投稿されない」という一手間は残るが、
 * 動かなくなる連携や、規約に触れるかもしれない連携よりはましだと考えている。
 * note が公式の API を出したら、このファイルを差し替えるだけで済むようにしてある。
 */

declare(strict_types=1);

namespace Canter\Connector;

use Canter\Assets;

final class Note extends Connector
{
    public static function service(): string
    {
        return 'note';
    }

    public static function label(): string
    {
        return 'note';
    }

    public static function capabilities(): array
    {
        return ['image' => true, 'text' => true, 'schedule' => false, 'export_only' => true];
    }

    public static function requiresImage(): bool
    {
        return false;
    }

    public static function fields(): array
    {
        return [
            [
                'key' => 'author', 'label' => '書き手の名前', 'type' => 'text', 'required' => false,
                'help' => '書き出す Markdown の末尾に入ります。空でも構いません。',
            ],
            [
                'key' => 'note_url', 'label' => 'note のURL', 'type' => 'url', 'required' => false,
                'default' => 'https://note.com/notes/new',
                'help' => '「note を開く」ボタンの行き先。自分の下書き画面にしておくと早いです。',
            ],
        ];
    }

    public function verify(array $config): array
    {
        return self::ok(
            ['export_only' => true],
            'note は公式の API が公開されていないため、投稿は自動化せず「貼るだけの形にして渡す」つなぎ方にしています。'
                . '設定はこれで完了です。'
        );
    }

    public function publish(array $config, array $post, ?array $image): array
    {
        $caption = trim((string) ($post['caption'] ?? ''));
        $title   = trim((string) ($post['options']['title'] ?? '')) ?: (self::firstLine($caption) ?: 'canter のデザイン');
        $author  = trim((string) ($config['author'] ?? ''));

        $lines = ['# ' . $title, ''];

        if ($image !== null) {
            $url = Assets::publicUrl($image);
            $lines[] = '![' . $title . '](' . $url . ')';
            $lines[] = '';
            $lines[] = '> 見出し画像は上の URL から保存して、note の「見出し画像を追加」から入れてください。';
            $lines[] = '';
        }

        if ($caption !== '') {
            $lines[] = $caption;
            $lines[] = '';
        }

        if ($author !== '') {
            $lines[] = '---';
            $lines[] = $author;
        }

        $markdown = implode("\n", $lines);

        return [
            'external_id'  => '',
            'external_url' => trim((string) ($config['note_url'] ?? '')) ?: 'https://note.com/notes/new',
            'message'      => '貼りつけ用の Markdown を用意しました。「本文をコピー」してから note を開いてください。',
            'logs'         => ['note は公式 API が無いため、書き出しのみを行いました'],
            'artifact'     => [
                'filename' => self::slug($title) . '.md',
                'mime'     => 'text/markdown; charset=utf-8',
                'text'     => $markdown,
            ],
        ];
    }

    private static function firstLine(string $text): string
    {
        $line = strtok(trim($text), "\n");
        return $line === false ? '' : mb_substr($line, 0, 120);
    }

    private static function slug(string $title): string
    {
        $s = preg_replace('/[^\p{L}\p{N}ぁ-んァ-ヶ一-龠ー_-]+/u', '-', $title) ?? 'note';
        $s = trim((string) $s, '-');
        return mb_substr($s !== '' ? $s : 'note', 0, 40);
    }
}
