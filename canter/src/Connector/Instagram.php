<?php
/**
 * Instagram（フィード投稿）。
 *
 * 【出し方】2段階に分かれている。
 *   1. 「入れもの」を作る   POST {base}/{ig_user_id}/media          （image_url と caption を渡す）
 *   2. それを公開する       POST {base}/{ig_user_id}/media_publish  （1 で返ってきた id を渡す）
 *
 * 【いちばんつまずくところ】
 * Instagram は「画像そのもの」ではなく「画像の URL」を受け取る作りで、
 * Instagram 側のサーバーがその URL を取りに来る。
 * つまり canter が **インターネットから見える場所** に置かれていないと投稿できない。
 * 手元（localhost）で動かしているあいだは、ここだけはどうやっても通らない。
 *
 * 【API のバージョン】
 * 接続先アドレス（api_base）は入力できるようにしてある。
 * Meta のバージョンは定期的に入れ替わるので、使っているアプリの設定画面に
 * 出ているバージョンに合わせて変えること。
 */

declare(strict_types=1);

namespace Canter\Connector;

use Canter\Assets;
use Canter\Http;

final class Instagram extends Connector
{
    private const DEFAULT_BASE = 'https://graph.instagram.com/v23.0';

    public static function service(): string
    {
        return 'instagram';
    }

    public static function label(): string
    {
        return 'Instagram';
    }

    public static function capabilities(): array
    {
        return ['image' => true, 'text' => false, 'schedule' => true];
    }

    public static function needsPublicImage(): bool
    {
        return true;
    }

    public static function captionLimit(): int
    {
        return 2200;
    }

    public static function fields(): array
    {
        return [
            [
                'key' => 'ig_user_id', 'label' => 'Instagram ユーザーID', 'type' => 'text', 'required' => true,
                'help' => 'プロ（ビジネス/クリエイター）アカウントの数字のID。Meta のアプリ管理画面で確認できます。',
            ],
            [
                'key' => 'access_token', 'label' => 'アクセストークン', 'type' => 'password', 'required' => true,
                'help' => 'instagram_business_content_publish（またはこれに相当する）権限を含む長期トークン。',
            ],
            [
                'key' => 'api_base', 'label' => '接続先アドレス', 'type' => 'url', 'required' => false,
                'default' => self::DEFAULT_BASE,
                'help' => 'Facebook ログインを使うアプリでは https://graph.facebook.com/v23.0 のようになります。'
                    . 'お使いのアプリのAPIバージョンに合わせて変えてください。',
            ],
        ];
    }

    public function verify(array $config): array
    {
        $base  = self::base($config, 'api_base', self::DEFAULT_BASE);
        $id    = self::need($config, 'ig_user_id', 'Instagram ユーザーID');
        $token = self::need($config, 'access_token', 'アクセストークン');

        $res = Http::get($base . '/' . rawurlencode($id) . '?fields=id,username&access_token=' . rawurlencode($token));

        if ($res['status'] !== 200 || !isset($res['json']['id'])) {
            return self::ng('Instagram に断られました：' . Http::errorMessage($res));
        }

        $reach = Assets::reachability();
        $info  = ['username' => $res['json']['username'] ?? '', 'id' => $res['json']['id']];

        if (!$reach['public']) {
            return self::ok($info, 'アカウントは確認できました。ただし ' . $reach['reason']);
        }

        return self::ok($info, 'つながりました（@' . ($info['username'] ?: $id) . '）');
    }

    public function publish(array $config, array $post, ?array $image): array
    {
        $base  = self::base($config, 'api_base', self::DEFAULT_BASE);
        $id    = self::need($config, 'ig_user_id', 'Instagram ユーザーID');
        $token = self::need($config, 'access_token', 'アクセストークン');
        $logs  = [];

        if ($image === null) {
            throw new \Canter\ApiError('Instagram は画像が必要です', 422);
        }

        $reach = Assets::reachability();
        if (!$reach['public']) {
            throw new \Canter\ApiError($reach['reason'], 400);
        }
        $imageUrl = Assets::publicUrl($image);
        $logs[]   = '画像の URL: ' . $imageUrl;

        // 1. 入れものを作る
        $create = Http::post($base . '/' . rawurlencode($id) . '/media', [
            'form' => [
                'image_url'    => $imageUrl,
                'caption'      => (string) ($post['caption'] ?? ''),
                'access_token' => $token,
            ],
        ]);
        if ($create['status'] !== 200 || !isset($create['json']['id'])) {
            throw new \Canter\ApiError('入れものを作れませんでした：' . Http::errorMessage($create), 502);
        }
        $creationId = (string) $create['json']['id'];
        $logs[]     = '入れものを作りました（' . $creationId . '）';

        // 2. 取りこみが終わるのを待つ（画像はたいていすぐ終わるが、念のため見る）
        $status = $this->waitReady($base, $creationId, $token, $logs);
        if ($status !== 'FINISHED') {
            throw new \Canter\ApiError('Instagram 側で画像を取りこめませんでした（状態: ' . $status . '）', 502);
        }

        // 3. 公開する
        $pub = Http::post($base . '/' . rawurlencode($id) . '/media_publish', [
            'form' => ['creation_id' => $creationId, 'access_token' => $token],
        ]);
        if ($pub['status'] !== 200 || !isset($pub['json']['id'])) {
            throw new \Canter\ApiError('公開できませんでした：' . Http::errorMessage($pub), 502);
        }
        $mediaId = (string) $pub['json']['id'];
        $logs[]  = '公開しました（' . $mediaId . '）';

        // 4. 見に行ける URL を取れたら取る（取れなくても投稿は成功しているので止めない）
        $url = '';
        $link = Http::get($base . '/' . rawurlencode($mediaId) . '?fields=permalink&access_token=' . rawurlencode($token));
        if ($link['status'] === 200 && isset($link['json']['permalink'])) {
            $url = (string) $link['json']['permalink'];
        }

        return [
            'external_id'  => $mediaId,
            'external_url' => $url,
            'message'      => 'Instagram に投稿しました',
            'logs'         => $logs,
        ];
    }

    /** 入れものの取りこみ状態を数回見る。 */
    private function waitReady(string $base, string $creationId, string $token, array &$logs): string
    {
        $status = 'IN_PROGRESS';
        for ($i = 0; $i < 8; $i++) {
            $res = Http::get($base . '/' . rawurlencode($creationId) . '?fields=status_code&access_token=' . rawurlencode($token));
            $status = (string) ($res['json']['status_code'] ?? 'IN_PROGRESS');
            if ($status === 'FINISHED' || $status === 'ERROR' || $status === 'EXPIRED') {
                break;
            }
            usleep(1_500_000);
        }
        $logs[] = '取りこみの状態: ' . $status;
        return $status;
    }
}
