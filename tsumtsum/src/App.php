<?php
/**
 * アプリ共通のもの。
 *
 * ・キャラのマスタは Python が書き出した config.json をそのまま読む
 *   （キャラを増やすときに直す場所を 1 か所にするため）
 * ・プレイヤーは Cookie に入れたトークンで見分ける
 */

declare(strict_types=1);

namespace Zousan;

require_once __DIR__ . '/Engine.php';
require_once __DIR__ . '/Store.php';

final class App
{
    public array $config;
    public Store $store;
    public Engine $engine;
    public array $player;

    private static ?App $instance = null;

    public static function boot(): App
    {
        if (self::$instance === null) {
            self::$instance = new App();
        }
        return self::$instance;
    }

    private function __construct()
    {
        $configPath = dirname(__DIR__) . '/public/assets/config.json';
        $raw = is_file($configPath) ? (string)file_get_contents($configPath) : '';
        $config = json_decode($raw, true);
        if (!is_array($config)) {
            http_response_code(500);
            exit('config.json がありません。`python3 engine/export_config.py` を実行してください。');
        }
        $this->config = $config;
        $this->store = new Store();
        $this->engine = new Engine();

        if (session_status() !== PHP_SESSION_ACTIVE) {
            session_start();
        }
        if (empty($_SESSION['token'])) {
            $_SESSION['token'] = bin2hex(random_bytes(16));
        }
        $this->player = $this->store->playerByToken(
            $_SESSION['token'], $this->config['free_ids']);
    }

    public function reloadPlayer(): void
    {
        $this->player = $this->store->playerByToken(
            $_SESSION['token'], $this->config['free_ids']);
    }

    /* ------------------------------------------------------------ キャラ */

    public function characters(): array
    {
        return $this->config['characters'];
    }

    public function character(string $id): ?array
    {
        foreach ($this->config['characters'] as $c) {
            if ($c['id'] === $id) {
                return $c;
            }
        }
        return null;
    }

    /** 内部レベル（0〜4）。表示は +1 する。 */
    public function levelOf(string $charId): int
    {
        $exp = $this->store->exp((int)$this->player['id'], $charId);
        $level = 0;
        foreach ($this->config['exp_table'] as $i => $need) {
            if ($exp >= $need) {
                $level = $i;
            }
        }
        return $level;
    }

    public function expProgress(string $charId): ?array
    {
        $exp = $this->store->exp((int)$this->player['id'], $charId);
        $level = $this->levelOf($charId);
        $table = $this->config['exp_table'];
        if ($level >= count($table) - 1) {
            return null;
        }
        return [
            'cur' => $exp - $table[$level],
            'need' => $table[$level + 1] - $table[$level],
        ];
    }

    /** いま選んでいるキャラ（持っていなければ無料キャラに戻す） */
    public function selectedId(): string
    {
        $id = (string)$this->player['selected'];
        if (!$this->store->owns((int)$this->player['id'], $id)) {
            $id = $this->config['free_ids'][0];
            $this->store->select((int)$this->player['id'], $id);
            $this->reloadPlayer();
        }
        return $id;
    }

    /* ------------------------------------------------------------ 表示 */

    public static function esc(?string $value): string
    {
        return htmlspecialchars((string)$value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    public static function num(int|float $value): string
    {
        return number_format((float)$value);
    }

    public function spriteUrl(string $charId): string
    {
        return 'assets/img/tsum_' . rawurlencode($charId) . '.png';
    }

    /* ------------------------------------------------------------ JSON API */

    public static function json(array $payload, int $status = 200): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo json_encode($payload, JSON_UNESCAPED_UNICODE);
        exit;
    }

    public static function input(): array
    {
        $raw = file_get_contents('php://input') ?: '';
        $data = json_decode($raw, true);
        return is_array($data) ? $data : [];
    }

    public static function requirePost(): void
    {
        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
            self::json(['ok' => false, 'error' => 'POST でお願いします'], 405);
        }
    }
}
