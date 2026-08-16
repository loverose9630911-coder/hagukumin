<?php
/**
 * プレイヤーのデータ置き場（SQLite）。
 *
 * 所持キャラ・コイン・キャラ経験値・ランキングをここで管理する。
 * 書き込むのはエンジンが返した結果だけで、ブラウザの申告は受け取らない。
 */

declare(strict_types=1);

namespace Zousan;

use PDO;

final class Store
{
    private PDO $db;

    public function __construct(?string $path = null)
    {
        $path ??= dirname(__DIR__) . '/data/zousan.sqlite';
        $dir = dirname($path);
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        $this->db = new PDO('sqlite:' . $path);
        $this->db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $this->db->exec('PRAGMA journal_mode = WAL');
        $this->migrate();
    }

    private function migrate(): void
    {
        $this->db->exec(<<<'SQL'
            CREATE TABLE IF NOT EXISTS players (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                token       TEXT UNIQUE NOT NULL,
                name        TEXT NOT NULL DEFAULT 'ななしさん',
                coins       INTEGER NOT NULL DEFAULT 0,
                plays       INTEGER NOT NULL DEFAULT 0,
                high_score  INTEGER NOT NULL DEFAULT 0,
                max_combo   INTEGER NOT NULL DEFAULT 0,
                total_score INTEGER NOT NULL DEFAULT 0,
                selected    TEXT NOT NULL DEFAULT 'zou',
                created_at  TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS owned (
                player_id INTEGER NOT NULL,
                char_id   TEXT NOT NULL,
                PRIMARY KEY (player_id, char_id)
            );
            CREATE TABLE IF NOT EXISTS char_exp (
                player_id INTEGER NOT NULL,
                char_id   TEXT NOT NULL,
                exp       INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (player_id, char_id)
            );
            CREATE TABLE IF NOT EXISTS scores (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                player_id  INTEGER NOT NULL,
                name       TEXT NOT NULL,
                char_id    TEXT NOT NULL,
                score      INTEGER NOT NULL,
                max_combo  INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_scores_score ON scores (score DESC);
        SQL);
    }

    /* ------------------------------------------------------------ プレイヤー */

    public function playerByToken(string $token, array $freeIds): array
    {
        $stmt = $this->db->prepare('SELECT * FROM players WHERE token = ?');
        $stmt->execute([$token]);
        $player = $stmt->fetch();
        if ($player) {
            return $player;
        }
        $this->db->prepare(
            'INSERT INTO players (token, created_at) VALUES (?, ?)'
        )->execute([$token, date('c')]);
        $id = (int)$this->db->lastInsertId();
        foreach ($freeIds as $charId) {
            $this->grant($id, $charId);
        }
        $stmt->execute([$token]);
        return $stmt->fetch();
    }

    public function rename(int $playerId, string $name): void
    {
        $name = trim(mb_substr($name, 0, 12));
        if ($name === '') {
            return;
        }
        $this->db->prepare('UPDATE players SET name = ? WHERE id = ?')
            ->execute([$name, $playerId]);
    }

    public function select(int $playerId, string $charId): void
    {
        $this->db->prepare('UPDATE players SET selected = ? WHERE id = ?')
            ->execute([$charId, $playerId]);
    }

    /* ------------------------------------------------------------ 所持キャラ */

    public function grant(int $playerId, string $charId): void
    {
        $this->db->prepare(
            'INSERT OR IGNORE INTO owned (player_id, char_id) VALUES (?, ?)'
        )->execute([$playerId, $charId]);
    }

    public function ownedIds(int $playerId): array
    {
        $stmt = $this->db->prepare('SELECT char_id FROM owned WHERE player_id = ?');
        $stmt->execute([$playerId]);
        return array_column($stmt->fetchAll(), 'char_id');
    }

    public function owns(int $playerId, string $charId): bool
    {
        return in_array($charId, $this->ownedIds($playerId), true);
    }

    /**
     * キャラを買う。コインが足りなければ false。
     * 在庫確認と引き落としをひとつのトランザクションでやる。
     */
    public function buy(int $playerId, string $charId, int $price): bool
    {
        $this->db->beginTransaction();
        try {
            $stmt = $this->db->prepare('SELECT coins FROM players WHERE id = ?');
            $stmt->execute([$playerId]);
            $coins = (int)($stmt->fetchColumn() ?: 0);
            if ($coins < $price || $this->owns($playerId, $charId)) {
                $this->db->rollBack();
                return false;
            }
            $this->db->prepare('UPDATE players SET coins = coins - ? WHERE id = ?')
                ->execute([$price, $playerId]);
            $this->grant($playerId, $charId);
            $this->db->commit();
            return true;
        } catch (\Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }
    }

    /* ------------------------------------------------------------ 経験値 */

    public function expMap(int $playerId): array
    {
        $stmt = $this->db->prepare('SELECT char_id, exp FROM char_exp WHERE player_id = ?');
        $stmt->execute([$playerId]);
        $out = [];
        foreach ($stmt->fetchAll() as $row) {
            $out[$row['char_id']] = (int)$row['exp'];
        }
        return $out;
    }

    public function exp(int $playerId, string $charId): int
    {
        return $this->expMap($playerId)[$charId] ?? 0;
    }

    public function addExp(int $playerId, string $charId, int $amount): int
    {
        $this->db->prepare(
            'INSERT INTO char_exp (player_id, char_id, exp) VALUES (?, ?, ?)
             ON CONFLICT (player_id, char_id) DO UPDATE SET exp = exp + ?'
        )->execute([$playerId, $charId, $amount, $amount]);
        return $this->exp($playerId, $charId);
    }

    /* ------------------------------------------------------------ 成績 */

    /** エンジンが出した結果を記録する */
    public function recordResult(array $player, array $result): array
    {
        $playerId = (int)$player['id'];
        $score = (int)$result['score'];
        $combo = (int)$result['max_combo'];
        $coins = (int)$result['coins'];

        $this->db->prepare(
            'UPDATE players SET
                coins = coins + ?,
                plays = plays + 1,
                total_score = total_score + ?,
                high_score = MAX(high_score, ?),
                max_combo = MAX(max_combo, ?)
             WHERE id = ?'
        )->execute([$coins, $score, $score, $combo, $playerId]);

        if ($score > 0) {
            $this->db->prepare(
                'INSERT INTO scores (player_id, name, char_id, score, max_combo, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)'
            )->execute([$playerId, $player['name'], $result['char_id'],
                $score, $combo, date('c')]);
        }

        $stmt = $this->db->prepare('SELECT * FROM players WHERE id = ?');
        $stmt->execute([$playerId]);
        return $stmt->fetch();
    }

    public function ranking(int $limit = 20): array
    {
        $stmt = $this->db->prepare(
            'SELECT name, char_id, score, max_combo, created_at
             FROM scores ORDER BY score DESC, id ASC LIMIT ?'
        );
        $stmt->bindValue(1, $limit, PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll();
    }

    public function rankOf(int $score): int
    {
        $stmt = $this->db->prepare('SELECT COUNT(*) FROM scores WHERE score > ?');
        $stmt->execute([$score]);
        return (int)$stmt->fetchColumn() + 1;
    }
}
