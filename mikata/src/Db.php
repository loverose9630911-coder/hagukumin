<?php
/**
 * データの置き場所（SQLite）。
 *
 * テーブルの作成（マイグレーション）もここでやる。
 * ファイルは mikata/data/mikata.sqlite に置かれる。
 */

declare(strict_types=1);

namespace Mikata;

use PDO;

final class Db
{
    private static ?PDO $pdo = null;

    public static function conn(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        $path = getenv('MIKATA_DB') ?: dirname(__DIR__) . '/data/mikata.sqlite';
        $dir  = dirname($path);
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }

        $db = new PDO('sqlite:' . $path);
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $db->exec('PRAGMA journal_mode = WAL');
        $db->exec('PRAGMA foreign_keys = ON');
        $db->exec('PRAGMA busy_timeout = 4000');

        self::$pdo = $db;
        self::migrate($db);

        return $db;
    }

    /** テストから使う（毎回空の DB を作る）。 */
    public static function reset(): void
    {
        self::$pdo = null;
    }

    private static function migrate(PDO $db): void
    {
        $db->exec(<<<'SQL'
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                login         TEXT    NOT NULL UNIQUE,
                name          TEXT    NOT NULL,
                password_hash TEXT    NOT NULL,
                color         TEXT    NOT NULL DEFAULT '#6366f1',
                created_at    TEXT    NOT NULL
            );

            CREATE TABLE IF NOT EXISTS teams (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT    NOT NULL,
                join_code  TEXT    NOT NULL UNIQUE,
                created_at TEXT    NOT NULL
            );

            CREATE TABLE IF NOT EXISTS members (
                team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                role       TEXT    NOT NULL DEFAULT 'member',
                capacity_h REAL    NOT NULL DEFAULT 30,
                joined_at  TEXT    NOT NULL,
                PRIMARY KEY (team_id, user_id)
            );

            -- プロジェクト＝Notion のデータベース かつ Slack のチャンネル。
            -- 「タスクの入れ物」と「会話の場所」を同じものにしたのがこのアプリの肝。
            CREATE TABLE IF NOT EXISTS projects (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
                name       TEXT    NOT NULL,
                emoji      TEXT    NOT NULL DEFAULT '📁',
                color      TEXT    NOT NULL DEFAULT '#6366f1',
                sort_order REAL    NOT NULL DEFAULT 0,
                archived   INTEGER NOT NULL DEFAULT 0,
                created_at TEXT    NOT NULL
            );

            CREATE TABLE IF NOT EXISTS goals (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                team_id      INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
                title        TEXT    NOT NULL,
                scope        TEXT    NOT NULL DEFAULT 'team',   -- team | personal
                owner_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
                unit         TEXT    NOT NULL DEFAULT '件',
                target_value REAL    NOT NULL DEFAULT 0,
                manual_value REAL    NOT NULL DEFAULT 0,
                rollup       TEXT    NOT NULL DEFAULT 'tasks',  -- tasks | done_count | manual | children
                -- チーム目標を「個人目標の合計」で積み上げるための親子関係。
                -- 親は必ずチーム目標、子は必ず個人目標。1段だけ。
                parent_id    INTEGER REFERENCES goals(id) ON DELETE SET NULL,
                due_date     TEXT,
                created_at   TEXT    NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tasks (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                team_id      INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
                project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                title        TEXT    NOT NULL,
                body         TEXT    NOT NULL DEFAULT '',
                status       TEXT    NOT NULL DEFAULT 'todo',   -- todo | doing | review | done
                priority     TEXT    NOT NULL DEFAULT 'mid',    -- high | mid | low
                assignee_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
                creator_id   INTEGER NOT NULL,
                due_date     TEXT,
                estimate_h   REAL    NOT NULL DEFAULT 0,
                target_value REAL,
                actual_value REAL    NOT NULL DEFAULT 0,
                unit         TEXT    NOT NULL DEFAULT '',
                goal_id      INTEGER REFERENCES goals(id) ON DELETE SET NULL,
                sort_order   REAL    NOT NULL DEFAULT 0,
                created_at   TEXT    NOT NULL,
                updated_at   TEXT    NOT NULL,
                done_at      TEXT
            );

            CREATE TABLE IF NOT EXISTS messages (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
                project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                task_id    INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
                user_id    INTEGER NOT NULL,
                body       TEXT    NOT NULL,
                kind       TEXT    NOT NULL DEFAULT 'chat',     -- chat | system
                created_at TEXT    NOT NULL
            );

            CREATE TABLE IF NOT EXISTS reads (
                user_id         INTEGER NOT NULL,
                project_id      INTEGER NOT NULL,
                last_message_id INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, project_id)
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token      TEXT    PRIMARY KEY,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TEXT    NOT NULL,
                seen_at    TEXT    NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_tasks_team     ON tasks(team_id, status);
            CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
            CREATE INDEX IF NOT EXISTS idx_msg_project    ON messages(project_id, id);
            CREATE INDEX IF NOT EXISTS idx_msg_task       ON messages(task_id, id);
        SQL);

        // 前のバージョンで作った DB にも、後から足した列を入れておく。
        self::addColumn($db, 'goals', 'parent_id', 'INTEGER');
    }

    /** 列がまだ無ければ足す（あれば何もしない）。 */
    private static function addColumn(PDO $db, string $table, string $column, string $type): void
    {
        $cols = $db->query("PRAGMA table_info({$table})")->fetchAll();
        foreach ($cols as $c) {
            if ($c['name'] === $column) {
                return;
            }
        }
        $db->exec("ALTER TABLE {$table} ADD COLUMN {$column} {$type}");
    }
}
