<?php
/**
 * Python ゲームエンジンへの接続。
 *
 * ゲームのルール（物理・チェーン判定・スコア）はすべてエンジン側にあり、
 * PHP はここを通して結果を受け取るだけ。スコアの計算は一切していないので、
 * ブラウザから細工したリクエストが来ても点数を偽装できない。
 */

declare(strict_types=1);

namespace Doubutsu;

use RuntimeException;

final class Engine
{
    private string $base;
    private float $timeout;

    public function __construct(?string $base = null, float $timeout = 8.0)
    {
        $this->base = rtrim($base ?? (getenv('ENGINE_URL') ?: 'http://127.0.0.1:8765'), '/');
        $this->timeout = $timeout;
    }

    public function isUp(): bool
    {
        try {
            $health = $this->request('GET', '/health');
            return !empty($health['ok']);
        } catch (RuntimeException) {
            return false;
        }
    }

    public function newSession(string $charId, int $level, float $height): array
    {
        return $this->request('POST', '/session/new', [
            'char_id' => $charId,
            'level' => $level,
            'height' => $height,
        ]);
    }

    public function start(string $sessionId): array
    {
        return $this->post('/session/start', $sessionId);
    }

    public function state(string $sessionId): array
    {
        return $this->post('/session/state', $sessionId);
    }

    public function chain(string $sessionId, array $ids): array
    {
        return $this->post('/session/chain', $sessionId, ['ids' => array_values($ids)]);
    }

    public function bomb(string $sessionId, int $id): array
    {
        return $this->post('/session/bomb', $sessionId, ['id' => $id]);
    }

    public function skill(string $sessionId): array
    {
        return $this->post('/session/skill', $sessionId);
    }

    public function finish(string $sessionId): array
    {
        return $this->post('/session/finish', $sessionId);
    }

    private function post(string $path, string $sessionId, array $extra = []): array
    {
        return $this->request('POST', $path, ['session_id' => $sessionId] + $extra);
    }

    private function request(string $method, string $path, ?array $body = null): array
    {
        $ch = curl_init($this->base . $path);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => (int)ceil($this->timeout),
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS,
                json_encode($body, JSON_UNESCAPED_UNICODE));
        }
        $raw = curl_exec($ch);
        $error = curl_error($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);

        if ($raw === false) {
            throw new RuntimeException("エンジンに接続できません: {$error}");
        }
        $data = json_decode((string)$raw, true);
        if (!is_array($data)) {
            throw new RuntimeException("エンジンの応答が読めません (HTTP {$status})");
        }
        return $data;
    }
}
