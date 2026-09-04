<?php
/**
 * コマンドラインから src/ のクラスを使うための下ごしらえ。
 */

declare(strict_types=1);

date_default_timezone_set(getenv('CANTER_TZ') ?: 'Asia/Tokyo');
mb_internal_encoding('UTF-8');

spl_autoload_register(static function (string $class): void {
    if (!str_starts_with($class, 'Canter\\')) {
        return;
    }
    $rel  = str_replace('\\', '/', substr($class, 7));
    $file = dirname(__DIR__) . '/src/' . $rel . '.php';
    if (is_file($file)) {
        require_once $file;
    }
});
