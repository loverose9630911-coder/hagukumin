<?php
/**
 * つなぎ先ひとつぶんの決まりごと。
 *
 * サービスごとに癖はあるが、canter から見た形は3つだけに揃えてある。
 *   fields()   … 接続に何を入れてもらうか（画面はこれを見てフォームを作る）
 *   verify()   … 入れてもらったもので本当につながるか
 *   publish()  … 1件出す
 *
 * こうしておくと、あとからサービスを足すときに触るのはこのフォルダだけで済む。
 */

declare(strict_types=1);

namespace Canter\Connector;

abstract class Connector
{
    /** 見分けるための名前（DB に入る）。 */
    abstract public static function service(): string;

    /** 画面に出す名前。 */
    abstract public static function label(): string;

    /** 何ができるか。画面の出し分けに使う。 */
    abstract public static function capabilities(): array;

    /**
     * 接続に必要な入力。
     * key / label / type(text|password|url|select) / required / help / default / options
     */
    abstract public static function fields(): array;

    /** つながるか確かめる。 @return array{ok:bool, message:string, info:array} */
    abstract public function verify(array $config): array;

    /**
     * 1件出す。
     *
     * @param array      $post   caption / options / …
     * @param array|null $image  書き出した PNG（Assets の形）。文字だけの投稿では null。
     * @return array{external_id:string, external_url:string, message:string, logs:array<string>}
     */
    abstract public function publish(array $config, array $post, ?array $image): array;

    /** 画像を「URL で」渡す作りかどうか（＝ canter が外から見える必要があるか）。 */
    public static function needsPublicImage(): bool
    {
        return false;
    }

    /** 画像が要るかどうか。 */
    public static function requiresImage(): bool
    {
        return true;
    }

    /** 説明文の最大文字数。0 なら上限なし。 */
    public static function captionLimit(): int
    {
        return 0;
    }

    // ---- 部品 ---------------------------------------------------------------

    protected static function need(array $config, string $key, string $label): string
    {
        $v = trim((string) ($config[$key] ?? ''));
        if ($v === '') {
            throw new \Canter\ApiError($label . ' が空です。接続の設定を見直してください', 422);
        }
        return $v;
    }

    protected static function base(array $config, string $key, string $fallback): string
    {
        $v = trim((string) ($config[$key] ?? ''));
        return rtrim($v !== '' ? $v : $fallback, '/');
    }

    protected static function ok(array $info = [], string $message = 'つながりました'): array
    {
        return ['ok' => true, 'message' => $message, 'info' => $info];
    }

    protected static function ng(string $message, array $info = []): array
    {
        return ['ok' => false, 'message' => $message, 'info' => $info];
    }
}
