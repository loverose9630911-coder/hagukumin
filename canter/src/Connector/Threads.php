<?php
/**
 * Threads。
 *
 * 出し方は Instagram とそっくりで、やはり2段階。
 *   1. POST {base}/{user_id}/threads          （media_type と text、画像なら image_url）
 *   2. POST {base}/{user_id}/threads_publish  （1 の id を creation_id として渡す）
 *
 * ただし接続先は Facebook のものとは別で、graph.threads.net を使う。
 * 画像を付けるときは Instagram と同じく「URL を取りに来られる」必要がある。
 * 文字だけの投稿なら、その制約はない（手元からでも出せる）。
 */

declare(strict_types=1);

namespace Canter\Connector;

use Canter\Assets;
use Canter\Http;

final class Threads extends Connector
{
    private const DEFAULT_BASE = 'https://graph.threads.net/v1.0';

    public static function service(): string
    {
        return 'threads';
    }

    public static function label(): string
    {
        return 'Threads';
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
        return false;   // 文字だけでも出せる
    }

    public static function captionLimit(): int
    {
        return 500;
    }

    public static function fields(): array
    {
        return [
            [
                'key' => 'threads_user_id', 'label' => 'Threads ユーザーID', 'type' => 'text', 'required' => true,
                'help' => '数字のID。/me を叩くと分かります。',
            ],
            [
                'key' => 'access_token', 'label' => 'アクセストークン', 'type' => 'password', 'required' => true,
                'help' => 'threads_basic と threads_content_publish を含むトークン。',
            ],
            [
                'key' => 'api_base', 'label' => '接続先アドレス', 'type' => 'url', 'required' => false,
                'default' => self::DEFAULT_BASE,
                'help' => 'ふつうは変えなくて構いません。',
            ],
        ];
    }

    public function verify(array $config): array
    {
        $base  = self::base($config, 'api_base', self::DEFAULT_BASE);
        $id    = self::need($config, 'threads_user_id', 'Threads ユーザーID');
        $token = self::need($config, 'access_token', 'アクセストークン');

        $res = Http::get($base . '/' . rawurlencode($id) . '?fields=id,username&access_token=' . rawurlencode($token));
        if ($res['status'] !== 200 || !isset($res['json']['id'])) {
            return self::ng('Threads に断られました：' . Http::errorMessage($res));
        }

        $info  = ['username' => $res['json']['username'] ?? '', 'id' => $res['json']['id']];
        $reach = Assets::reachability();
        if (!$reach['public']) {
            return self::ok($info, 'アカウントは確認できました。文字だけの投稿はできますが、画像を付けるには ' . $reach['reason']);
        }

        return self::ok($info, 'つながりました（@' . ($info['username'] ?: $id) . '）');
    }

    public function publish(array $config, array $post, ?array $image): array
    {
        $base  = self::base($config, 'api_base', self::DEFAULT_BASE);
        $id    = self::need($config, 'threads_user_id', 'Threads ユーザーID');
        $token = self::need($config, 'access_token', 'アクセストークン');
        $text  = (string) ($post['caption'] ?? '');
        $logs  = [];

        $form = ['access_token' => $token, 'text' => $text];

        if ($image !== null) {
            $reach = Assets::reachability();
            if (!$reach['public']) {
                throw new \Canter\ApiError($reach['reason'], 400);
            }
            $form['media_type'] = 'IMAGE';
            $form['image_url']  = Assets::publicUrl($image);
            $logs[] = '画像の URL: ' . $form['image_url'];
        } else {
            $form['media_type'] = 'TEXT';
            if (trim($text) === '') {
                throw new \Canter\ApiError('文字だけの投稿では、本文を空にできません', 422);
            }
        }

        $create = Http::post($base . '/' . rawurlencode($id) . '/threads', ['form' => $form]);
        if ($create['status'] !== 200 || !isset($create['json']['id'])) {
            throw new \Canter\ApiError('入れものを作れませんでした：' . Http::errorMessage($create), 502);
        }
        $creationId = (string) $create['json']['id'];
        $logs[]     = '入れものを作りました（' . $creationId . '）';

        // 画像つきは取りこみに少し時間がかかる。公式の案内どおり、少し置いてから公開する。
        if ($image !== null) {
            usleep(2_000_000);
        }

        $pub = Http::post($base . '/' . rawurlencode($id) . '/threads_publish', [
            'form' => ['creation_id' => $creationId, 'access_token' => $token],
        ]);
        if ($pub['status'] !== 200 || !isset($pub['json']['id'])) {
            throw new \Canter\ApiError('公開できませんでした：' . Http::errorMessage($pub), 502);
        }
        $threadId = (string) $pub['json']['id'];
        $logs[]   = '公開しました（' . $threadId . '）';

        $url = '';
        $link = Http::get($base . '/' . rawurlencode($threadId) . '?fields=permalink&access_token=' . rawurlencode($token));
        if ($link['status'] === 200 && isset($link['json']['permalink'])) {
            $url = (string) $link['json']['permalink'];
        }

        return [
            'external_id'  => $threadId,
            'external_url' => $url,
            'message'      => 'Threads に投稿しました',
            'logs'         => $logs,
        ];
    }
}
