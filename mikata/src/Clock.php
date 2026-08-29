<?php
/**
 * 「いま」を1か所にまとめる。テストで時間を固定できるようにするため。
 */

declare(strict_types=1);

namespace Mikata;

final class Clock
{
    private static ?string $frozen = null;

    /** テスト用。'2026-08-29 10:00:00' のように固定する。 */
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

    /** today から days 日ずらした日付（YYYY-MM-DD）。 */
    public static function day(int $days): string
    {
        return date('Y-m-d', strtotime(self::today() . " {$days} day"));
    }

    /** 2つの日付の差（日数）。$to - $from。 */
    public static function diffDays(string $from, string $to): int
    {
        $a = strtotime($from . ' 00:00:00');
        $b = strtotime($to . ' 00:00:00');
        return (int) round(($b - $a) / 86400);
    }
}
