<?php
/**
 * コマンドラインから src/ のクラスを使うための下ごしらえ。
 */

declare(strict_types=1);

date_default_timezone_set(getenv('MIKATA_TZ') ?: 'Asia/Tokyo');
mb_internal_encoding('UTF-8');

spl_autoload_register(static function (string $class): void {
    if (!str_starts_with($class, 'Mikata\\')) {
        return;
    }
    $file = dirname(__DIR__) . '/src/' . substr($class, 7) . '.php';
    if (is_file($file)) {
        require_once $file;
    }
});
