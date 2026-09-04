<?php
/**
 * X（旧 Twitter）。
 *
 * ここだけは他と作りが違い、画像を **ファイルのまま** 送る。
 * そのため canter が外から見える必要がなく、手元で動かしていても投稿できる。
 *
 *   1. 画像を送る   POST https://api.x.com/2/media/upload   （multipart で media を添える）
 *   2. 投稿する     POST https://api.x.com/2/tweets         （text と media.media_ids）
 *
 * 【つまずきやすいところ】
 * ・OAuth 2.0 のアクセストークンは寿命が短い。refresh_token を入れておくと、
 *   期限切れのときに canter が自分で取り直す（下の refresh()）。
 * ・画像を送るには tweet.write のほかに media.write の許可が要る。
 *   許可が足りないと、投稿はできるのに画像だけ 403 で弾かれる、という形で出る。
 */

declare(strict_types=1);

namespace Canter\Connector;

use Canter\ApiError;
use Canter\Db;
use Canter\Http;

final class XCom extends Connector
{
    private const DEFAULT_BASE  = 'https://api.x.com/2';
    private const DEFAULT_TOKEN = 'https://api.x.com/2/oauth2/token';

    /** 取り直したトークンを呼び出し元（Connections）に返すための置き場。 */
    public array $refreshed = [];

    public static function service(): string
    {
        return 'x';
    }

    public static function label(): string
    {
        return 'X';
    }

    public static function capabilities(): array
    {
        return ['image' => true, 'text' => true, 'schedule' => true];
    }

    public static function requiresImage(): bool
    {
        return false;
    }

    public static function captionLimit(): int
    {
        return 280;
    }

    public static function fields(): array
    {
        return [
            [
                'key' => 'access_token', 'label' => 'アクセストークン', 'type' => 'password', 'required' => true,
                'help' => 'OAuth 2.0 のユーザートークン。tweet.read / tweet.write / users.read / media.write / offline.access を含めてください。',
            ],
            [
                'key' => 'refresh_token', 'label' => 'リフレッシュトークン', 'type' => 'password', 'required' => false,
                'help' => '入れておくと、期限が切れたときに canter が自動で取り直します（offline.access が必要）。',
            ],
            [
                'key' => 'client_id', 'label' => 'クライアントID', 'type' => 'text', 'required' => false,
                'help' => 'リフレッシュに使います。',
            ],
            [
                'key' => 'client_secret', 'label' => 'クライアントシークレット', 'type' => 'password', 'required' => false,
                'help' => 'Confidential client のときだけ。Public client なら空のままで構いません。',
            ],
            [
                'key' => 'username', 'label' => 'ユーザー名（@なし）', 'type' => 'text', 'required' => false,
                'help' => '投稿後の URL を作るのに使います。空でも投稿はできます。',
            ],
            [
                'key' => 'api_base', 'label' => '接続先アドレス', 'type' => 'url', 'required' => false,
                'default' => self::DEFAULT_BASE, 'help' => 'ふつうは変えなくて構いません。',
            ],
        ];
    }

    public function verify(array $config): array
    {
        $res = $this->call($config, 'GET', '/users/me');

        if ($res['status'] !== 200 || !isset($res['json']['data']['id'])) {
            return self::ng('X に断られました：' . Http::errorMessage($res));
        }

        $me = $res['json']['data'];
        return self::ok(
            ['id' => $me['id'], 'username' => $me['username'] ?? ''],
            'つながりました（@' . ($me['username'] ?? $me['id']) . '）'
        );
    }

    public function publish(array $config, array $post, ?array $image): array
    {
        $text = (string) ($post['caption'] ?? '');
        $logs = [];

        if ($image === null && trim($text) === '') {
            throw new ApiError('本文か画像のどちらかは必要です', 422);
        }

        $body = [];
        if (trim($text) !== '') {
            $body['text'] = $text;
        }

        if ($image !== null) {
            $mediaId = $this->uploadMedia($config, $image, $logs);
            $body['media'] = ['media_ids' => [$mediaId]];
        }

        $res = $this->call($config, 'POST', '/tweets', ['json' => $body]);
        if (($res['status'] !== 200 && $res['status'] !== 201) || !isset($res['json']['data']['id'])) {
            throw new ApiError('投稿できませんでした：' . Http::errorMessage($res), 502);
        }

        $id   = (string) $res['json']['data']['id'];
        $user = trim((string) ($config['username'] ?? ''));
        $url  = $user !== ''
            ? 'https://x.com/' . rawurlencode($user) . '/status/' . $id
            : 'https://x.com/i/web/status/' . $id;

        $logs[] = '投稿しました（' . $id . '）';

        return [
            'external_id'  => $id,
            'external_url' => $url,
            'message'      => 'X に投稿しました',
            'logs'         => $logs,
        ];
    }

    /** 画像をファイルのまま送って media_id を受け取る。 */
    private function uploadMedia(array $config, array $image, array &$logs): string
    {
        $file = Db::dataDir() . '/uploads/' . basename((string) $image['path']);
        if (!is_file($file)) {
            throw new ApiError('書き出した画像が見つかりませんでした', 500);
        }

        $res = $this->call($config, 'POST', '/media/upload', [
            'multipart' => [
                'media'          => Http::file($file, (string) $image['mime'], 'canter.png'),
                'media_category' => 'tweet_image',
            ],
            'timeout' => 60,
        ]);

        // 返ってくる形が版によって違うので、よくある置き場所をひととおり見る。
        $j  = $res['json'] ?? [];
        $id = $j['data']['id'] ?? $j['id'] ?? $j['media_id_string'] ?? $j['data']['media_key'] ?? null;

        if ($res['status'] >= 300 || !is_string($id) || $id === '') {
            $hint = $res['status'] === 403
                ? '（media.write の許可が付いていない可能性があります）'
                : '';
            throw new ApiError('画像を送れませんでした' . $hint . '：' . Http::errorMessage($res), 502);
        }

        $logs[] = '画像を送りました（media_id ' . $id . '）';
        return $id;
    }

    /**
     * 合言葉を付けて呼ぶ。401 が返って refresh_token があれば、取り直して1度だけやり直す。
     */
    private function call(array $config, string $method, string $path, array $opt = [], bool $retried = false): array
    {
        $base  = self::base($config, 'api_base', self::DEFAULT_BASE);
        $token = self::need($config, 'access_token', 'アクセストークン');

        $opt['headers'] = array_merge($opt['headers'] ?? [], ['Authorization: Bearer ' . $token]);
        $res = Http::request($method, $base . $path, $opt);

        if ($res['status'] === 401 && !$retried) {
            $fresh = $this->refresh($config);
            if ($fresh !== null) {
                $this->refreshed = $fresh;
                return $this->call(array_merge($config, $fresh), $method, $path, $opt, true);
            }
        }

        return $res;
    }

    /** refresh_token で取り直す。できなければ null。 */
    private function refresh(array $config): ?array
    {
        $refresh  = trim((string) ($config['refresh_token'] ?? ''));
        $clientId = trim((string) ($config['client_id'] ?? ''));
        if ($refresh === '' || $clientId === '') {
            return null;
        }

        $headers = [];
        $secret  = trim((string) ($config['client_secret'] ?? ''));
        if ($secret !== '') {
            $headers[] = 'Authorization: Basic ' . base64_encode($clientId . ':' . $secret);
        }

        $res = Http::post(self::DEFAULT_TOKEN, [
            'form' => [
                'grant_type'    => 'refresh_token',
                'refresh_token' => $refresh,
                'client_id'     => $clientId,
            ],
            'headers' => $headers,
        ]);

        if ($res['status'] !== 200 || !isset($res['json']['access_token'])) {
            return null;
        }

        return [
            'access_token'  => (string) $res['json']['access_token'],
            'refresh_token' => (string) ($res['json']['refresh_token'] ?? $refresh),
        ];
    }
}
