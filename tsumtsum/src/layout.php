<?php
/** 画面の共通わく */

declare(strict_types=1);

use Zousan\App;

function layout_head(string $title, string $bodyClass = ''): void
{
    $t = App::esc($title);
    $c = App::esc($bodyClass);
    echo <<<HTML
    <!DOCTYPE html>
    <html lang="ja">
    <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
    <meta name="theme-color" content="#8FD3F4">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-title" content="ぞうさんとなかまたち">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <title>{$t}</title>
    <link rel="manifest" href="manifest.webmanifest">
    <link rel="icon" href="assets/img/favicon-32.png" sizes="32x32">
    <link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png">
    <link rel="stylesheet" href="assets/css/app.css">
    </head>
    <body class="{$c}">
    <div id="stage">
    HTML;
}

function layout_foot(): void
{
    echo '</div></body></html>';
}

/** キャラの絵（PHP-GD が描いた PNG） */
function tsum_img(array $char, int $height = 76, string $class = ''): string
{
    $src = 'assets/img/tsum_' . rawurlencode($char['id']) . '.png';
    $cls = $class !== '' ? ' class="' . App::esc($class) . '"' : '';
    return sprintf(
        '<img src="%s" alt="%s"%s style="height:%dpx" loading="lazy">',
        App::esc($src), App::esc($char['name']), $cls, $height
    );
}
