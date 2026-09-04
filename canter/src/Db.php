<?php
/**
 * データの置き場所（SQLite）。テーブルの作成もここでやる。
 *
 * ファイルは canter/data/canter.sqlite に置かれる。
 * 画像の実体だけは data/uploads/ に別ファイルで置く（DB を軽く保つため）。
 */

declare(strict_types=1);

namespace Canter;

use PDO;

final class Db
{
    private static ?PDO $pdo = null;

    public static function conn(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        $path = getenv('CANTER_DB') ?: self::dataDir() . '/canter.sqlite';
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

    /** データの置き場所（画像もここの下に入る）。 */
    public static function dataDir(): string
    {
        $dir = getenv('CANTER_DATA') ?: dirname(__DIR__) . '/data';
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        return rtrim($dir, '/');
    }

    /** テストから使う（毎回まっさらな DB を作る）。 */
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
                color         TEXT    NOT NULL DEFAULT '#f0508c',
                created_at    TEXT    NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token      TEXT    PRIMARY KEY,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TEXT    NOT NULL,
                seen_at    TEXT    NOT NULL
            );

            -- ワークスペース＝いっしょに作る人のまとまり。
            CREATE TABLE IF NOT EXISTS workspaces (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT    NOT NULL,
                join_code  TEXT    NOT NULL UNIQUE,
                created_at TEXT    NOT NULL
            );

            CREATE TABLE IF NOT EXISTS members (
                workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                role         TEXT    NOT NULL DEFAULT 'member',  -- owner | member
                joined_at    TEXT    NOT NULL,
                PRIMARY KEY (workspace_id, user_id)
            );

            -- ブランドキット。色とフォントを決めておくと、
            -- どのテンプレートを選んでも見た目がそろう（ここが「カジュアル」の要）。
            CREATE TABLE IF NOT EXISTS brands (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                name         TEXT    NOT NULL DEFAULT 'ブランド',
                colors       TEXT    NOT NULL DEFAULT '[]',   -- JSON の配列
                font_head    TEXT    NOT NULL DEFAULT 'sans',
                font_body    TEXT    NOT NULL DEFAULT 'sans',
                logo_asset   INTEGER,
                created_at   TEXT    NOT NULL
            );

            -- デザイン1枚。中身（図形の並び）は doc に JSON でまるごと入る。
            CREATE TABLE IF NOT EXISTS designs (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                title        TEXT    NOT NULL DEFAULT '無題のデザイン',
                preset       TEXT    NOT NULL DEFAULT 'ig_square',
                w            INTEGER NOT NULL DEFAULT 1080,
                h            INTEGER NOT NULL DEFAULT 1080,
                doc          TEXT    NOT NULL,
                thumb_asset  INTEGER,
                creator_id   INTEGER NOT NULL,
                updated_by   INTEGER,
                archived     INTEGER NOT NULL DEFAULT 0,
                created_at   TEXT    NOT NULL,
                updated_at   TEXT    NOT NULL
            );

            -- 保存のたびに1つ残す。取り返しがつくようにしておく。
            CREATE TABLE IF NOT EXISTS versions (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                design_id  INTEGER NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
                user_id    INTEGER NOT NULL,
                label      TEXT    NOT NULL DEFAULT '',
                doc        TEXT    NOT NULL,
                created_at TEXT    NOT NULL
            );

            -- 画像（取りこんだ素材と、書き出した PNG の両方）。
            CREATE TABLE IF NOT EXISTS assets (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                token        TEXT    NOT NULL UNIQUE,     -- 配信 URL に使う推測できない文字列
                kind         TEXT    NOT NULL DEFAULT 'upload',  -- upload | render
                name         TEXT    NOT NULL DEFAULT '',
                mime         TEXT    NOT NULL,
                bytes        INTEGER NOT NULL DEFAULT 0,
                width        INTEGER NOT NULL DEFAULT 0,
                height       INTEGER NOT NULL DEFAULT 0,
                path         TEXT    NOT NULL,
                user_id      INTEGER NOT NULL,
                created_at   TEXT    NOT NULL
            );

            -- 外部サービスへの接続。合言葉（トークン）は暗号化して config に入れる。
            CREATE TABLE IF NOT EXISTS connections (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                service      TEXT    NOT NULL,   -- instagram | x | threads | notion | note | mikata
                label        TEXT    NOT NULL DEFAULT '',
                config       TEXT    NOT NULL DEFAULT '',  -- 暗号化した JSON
                status       TEXT    NOT NULL DEFAULT 'unchecked', -- unchecked | ok | ng
                message      TEXT    NOT NULL DEFAULT '',
                checked_at   TEXT,
                created_at   TEXT    NOT NULL,
                UNIQUE (workspace_id, service, label)
            );

            -- 「このデザインをここへ出す」1件。予約もここに入る。
            CREATE TABLE IF NOT EXISTS posts (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id  INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                design_id     INTEGER REFERENCES designs(id) ON DELETE SET NULL,
                connection_id INTEGER REFERENCES connections(id) ON DELETE SET NULL,
                service       TEXT    NOT NULL,
                status        TEXT    NOT NULL DEFAULT 'draft', -- draft | scheduled | sending | done | failed
                caption       TEXT    NOT NULL DEFAULT '',
                image_asset   INTEGER REFERENCES assets(id) ON DELETE SET NULL,
                options       TEXT    NOT NULL DEFAULT '{}',
                scheduled_at  TEXT,
                external_id   TEXT    NOT NULL DEFAULT '',
                external_url  TEXT    NOT NULL DEFAULT '',
                error         TEXT    NOT NULL DEFAULT '',
                user_id       INTEGER NOT NULL,
                created_at    TEXT    NOT NULL,
                updated_at    TEXT    NOT NULL
            );

            -- 投稿1件に何が起きたか。うまくいかなかったとき、ここだけ見れば分かるようにする。
            CREATE TABLE IF NOT EXISTS post_logs (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
                level      TEXT    NOT NULL DEFAULT 'info',  -- info | error
                message    TEXT    NOT NULL,
                created_at TEXT    NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_designs_ws  ON designs(workspace_id, archived, updated_at);
            CREATE INDEX IF NOT EXISTS idx_versions    ON versions(design_id, id);
            CREATE INDEX IF NOT EXISTS idx_assets_ws   ON assets(workspace_id, kind, id);
            CREATE INDEX IF NOT EXISTS idx_posts_ws    ON posts(workspace_id, status, id);
            CREATE INDEX IF NOT EXISTS idx_posts_sched ON posts(status, scheduled_at);
            CREATE INDEX IF NOT EXISTS idx_logs_post   ON post_logs(post_id, id);
        SQL);
    }
}
