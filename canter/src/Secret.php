<?php
/**
 * 外部サービスの合言葉（アクセストークン）をしまうための暗号化。
 *
 * SQLite のファイルを見られても、そこからトークンが読めないようにする。
 * 鍵は環境変数 CANTER_SECRET があればそれを、無ければ data/secret.key を使う
 * （無ければ初回に作る。data/ ごとバックアップすれば持ち運べる）。
 *
 * 方式は AES-256-GCM。改ざんされていたら復号の時点で分かる。
 */

declare(strict_types=1);

namespace Canter;

final class Secret
{
    private const CIPHER = 'aes-256-gcm';

    private static ?string $key = null;

    public static function encrypt(array $data): string
    {
        $plain = json_encode($data, JSON_UNESCAPED_UNICODE);
        $iv    = random_bytes(12);
        $tag   = '';
        $enc   = openssl_encrypt($plain, self::CIPHER, self::key(), OPENSSL_RAW_DATA, $iv, $tag);
        if ($enc === false) {
            throw new ApiError('接続情報を保存できませんでした', 500);
        }
        return base64_encode($iv . $tag . $enc);
    }

    /** 読めなければ空の配列を返す（鍵を入れ替えたときに画面ごと落とさないため）。 */
    public static function decrypt(string $blob): array
    {
        if ($blob === '') {
            return [];
        }
        $raw = base64_decode($blob, true);
        if ($raw === false || strlen($raw) < 29) {
            return [];
        }
        $iv  = substr($raw, 0, 12);
        $tag = substr($raw, 12, 16);
        $enc = substr($raw, 28);

        $plain = openssl_decrypt($enc, self::CIPHER, self::key(), OPENSSL_RAW_DATA, $iv, $tag);
        if ($plain === false) {
            return [];
        }
        $data = json_decode($plain, true);
        return is_array($data) ? $data : [];
    }

    /** テストで鍵を入れ替えたいときに使う。 */
    public static function reset(): void
    {
        self::$key = null;
    }

    private static function key(): string
    {
        if (self::$key !== null) {
            return self::$key;
        }

        $env = getenv('CANTER_SECRET');
        if (is_string($env) && $env !== '') {
            return self::$key = hash('sha256', $env, true);
        }

        $file = Db::dataDir() . '/secret.key';
        if (!is_file($file)) {
            $new = bin2hex(random_bytes(32));
            file_put_contents($file, $new, LOCK_EX);
            @chmod($file, 0600);
        }
        return self::$key = hash('sha256', (string) file_get_contents($file), true);
    }
}
