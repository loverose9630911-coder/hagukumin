<?php
/**
 * 「いま」を1か所にまとめる。
 *
 * テストのときは freeze() で時間を止められる。
 * 予約投稿の判定が日付をまたいでも同じ結果になるようにするため。
 */

declare(strict_types=1);

namespace Canter;

final class Clock
{
    private static ?string $frozen = null;

    /** テスト用。'2026-09-04 10:00:00' の形で止める。 */
    public static function freeze(?string $at): void
    {
        self::$frozen = $at;
    }

    public static function now(): string
    {
        return self::$frozen ?? date('Y-m-d H:i:s');
    }

    public static function today(): string
    {
        return substr(self::now(), 0, 10);
    }

    public static function ts(): int
    {
        return self::$frozen === null ? time() : (int) strtotime(self::$frozen);
    }
}
